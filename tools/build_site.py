#!/usr/bin/env python3
"""Build the Launchbench website into site/dist/.

Every fact on the site (prices, centres, availability) is read from the same
files the AI answers from: data/*.csv and kb/*.md. Marketing copy that is not
in the knowledge base lives in site/content.yaml.

  python3 -I tools/build_site.py            # build
  python3 -I tools/build_site.py --serve    # build, then serve on http://localhost:8080
"""
import csv
import datetime as dt
import re
import shutil
import subprocess
import sys
from pathlib import Path

import yaml
from jinja2 import Environment, FileSystemLoader, StrictUndefined

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
DIST = SITE / "dist"
TAILWIND = "tailwindcss@3.4.17"


# ---------- formatting ----------
def inr(n) -> str:
    """Indian digit grouping: 144000 -> ₹1,44,000."""
    n = int(round(float(n)))
    s = str(n)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        head = re.sub(r"(\d)(?=(\d\d)+$)", r"\1,", head)
        s = head + "," + tail
    return "₹" + s


def nice_date(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%b %Y')}"


def md_inline(text: str) -> str:
    """KB markdown -> public HTML: drop references to KB files, keep bold."""
    text = re.sub(r"\s*\((?:see )?\[[^\]]+\]\([^)]+\.md\)\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    return text.strip()


def plain(text: str) -> str:
    return re.sub(r"<[^>]+>", "", md_inline(text))


# ---------- data ----------
def load_prices() -> dict:
    with open(ROOT / "data/pricing.csv", newline="") as f:
        return {r["sku"]: int(float(r["value"])) for r in csv.DictReader(f)}


def load_availability() -> list:
    with open(ROOT / "data/availability.csv", newline="") as f:
        return list(csv.DictReader(f))


def load_centres(prices: dict, avail: list, content: dict) -> list:
    text = (ROOT / "kb/01-centres.md").read_text()
    centres = []
    for block in re.split(r"\n(?=## )", text):
        m = re.match(r"## (.+?) \(([A-Z]{3})\)(?::\s*(.+))?\n", block)
        if not m:
            continue
        code = m.group(2)
        facts = {}
        for key, val in re.findall(r"^- \*\*(.+?):\*\* (.+)$", block, re.M):
            facts[key.lower()] = val
        extra = content["centres"][code]
        cabins = [(int(n), int(s)) for n, s in re.findall(r"(\d+) × (\d+)-seat", facts["cabins"])]
        seats = int(re.match(r"(\d+)", facts["capacity"]).group(1))
        openings = sorted(
            (r for r in avail if r["centre"] == code),
            key=lambda r: (["Hot desk", "Dedicated desk", "Private cabin"].index(r["space_type"]),
                           r["available_from"], -int(r["cabin_size"] or 0)),
        )
        c = {
            "code": code,
            "name": extra["name"],
            "slug": extra["slug"],
            "tag": (m.group(3) or "").strip(),
            "blurb": extra["blurb"],
            "image": extra["image"],
            "lat": extra["lat"],
            "lon": extra["lon"],
            "address": plain(facts["address"]),
            "manager": facts["centre manager"],
            "capacity": md_inline(facts["capacity"]),
            "seats": seats,
            "cabin_sizes": sorted({s for _, s in cabins}),
            "cabins_html": md_inline(facts["cabins"]),
            "meeting_rooms": md_inline(facts["meeting rooms"]),
            "event_hall": md_inline(facts["event hall"]),
            "has_event_hall": facts["event hall"].lower().startswith("yes"),
            "hall_size": int(m2.group(1)) if (m2 := re.search(r"(\d+) people", facts["event hall"])) else None,
            "parking": md_inline(facts["parking"]),
            "metro": md_inline(facts["metro"]),
            "metro_walk": facts["metro"].startswith("**"),
            "metro_short": extra["metro_short"],
            "highlights": md_inline(facts["highlights"]),
            "pet_friendly": "pet-friendly" in facts["highlights"].lower(),
            "price_hot": prices[f"HOT-{code}"],
            "price_ded": prices[f"DED-{code}"],
            "price_cab": prices[f"CAB-{code}"],
            "price_fnd": prices.get(f"FND-{code}"),
            "openings": [
                {
                    "type": r["space_type"],
                    "size": r["cabin_size"],
                    "units": int(r["units_available"]),
                    "from": r["available_from"],
                    "from_nice": nice_date(r["available_from"]),
                    "ref": r["space_ref"],
                }
                for r in openings
            ],
        }
        centres.append(c)
    order = list(content["centres"])
    centres.sort(key=lambda c: order.index(c["code"]))
    return centres


FIXED_HOLIDAYS = {(1, 26), (8, 15), (10, 2), (11, 1), (12, 25)}  # kb/01-centres.md


def upcoming(today: dt.date, rule: str, n: int = 3) -> list:
    """Next n community dates: 'demo' = last Friday, 'office' = 2nd Wednesday."""
    out, y, m = [], today.year, today.month
    while len(out) < n:
        first = dt.date(y, m, 1)
        if rule == "demo":
            nxt = dt.date(y + (m == 12), m % 12 + 1, 1)
            d = nxt - dt.timedelta(days=1)
            d -= dt.timedelta(days=(d.weekday() - 4) % 7)
        else:
            d = first + dt.timedelta(days=(2 - first.weekday()) % 7 + 7)
        if d >= today and (d.month, d.day) not in FIXED_HOLIDAYS:
            out.append({"iso": d.isoformat(), "day": d.day, "mon": d.strftime("%b"), "dow": d.strftime("%A"), "nice": nice_date(d.isoformat())})
        y, m = y + (m == 12), m % 12 + 1
    return out


def featured_opening(centres: list, today: dt.date) -> dict:
    """The soonest private cabin opening, for the hero card."""
    best = None
    for c in centres:
        for o in c["openings"]:
            if o["type"] != "Private cabin":
                continue
            if best is None or (o["from"], -int(o["size"])) < (best["from"], -int(best["size"])):
                best = dict(o, centre=c["name"])
    return best


# ---------- build ----------
def build() -> None:
    content = yaml.safe_load((SITE / "content.yaml").read_text())
    prices = load_prices()
    avail = load_availability()
    centres = load_centres(prices, avail, content)
    today = dt.date.today()
    for c in centres:
        for o in c["openings"]:
            o["now"] = o["from"] <= today.isoformat()

    ctx = {
        "c": content,
        "prices": prices,
        "centres": centres,
        "centre_by_code": {c["code"]: c for c in centres},
        "from_hot": min(c["price_hot"] for c in centres),
        "from_ded": min(c["price_ded"] for c in centres),
        "from_cab": min(c["price_cab"] for c in centres),
        "from_fnd": min(c["price_fnd"] for c in centres if c["price_fnd"]),
        "total_seats": sum(c["seats"] for c in centres),
        "featured": featured_opening(centres, today),
        "year": today.year,
        "demo_nights": upcoming(today, "demo"),
        "office_hours": upcoming(today, "office"),
    }

    env = Environment(
        loader=FileSystemLoader(SITE / "templates"),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["inr"] = inr
    env.filters["md"] = md_inline
    env.filters["cap"] = lambda s: re.sub(r"^((?:<[^>]+>)*)(\w)", lambda m: m.group(1) + m.group(2).upper(), s, count=1)

    if DIST.exists():
        shutil.rmtree(DIST)
    (DIST / "assets").mkdir(parents=True)

    pages = [(p.name, p.stem) for p in sorted((SITE / "templates/pages").glob("*.html"))]
    for name, stem in pages:
        out = DIST / ("index.html" if stem == "index" else f"{stem}/index.html")
        if stem == "404":
            out = DIST / "404.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(env.get_template(f"pages/{name}").render(ctx, page=stem))

    centre_tpl = SITE / "templates/centre.html"
    if centre_tpl.exists():
        for c in centres:
            out = DIST / "locations" / c["slug"] / "index.html"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(env.get_template("centre.html").render(ctx, page="locations", centre=c))

    shutil.copytree(SITE / "assets/img", DIST / "assets/img", ignore=shutil.ignore_patterns("*.md"))
    for f in ("logo.svg", "favicon.svg", "site.js"):
        shutil.copy(SITE / "assets" / f, DIST / "assets" / f)
    for f in (SITE / "root").iterdir():  # _headers (noindex on every file) and robots.txt
        shutil.copy(f, DIST / f.name)

    subprocess.run(
        ["npx", "-y", TAILWIND, "-c", str(SITE / "tailwind.config.js"),
         "-i", str(SITE / "assets/input.css"), "-o", str(DIST / "assets/site.css"), "--minify"],
        check=True, cwd=SITE, capture_output=True,
    )
    print(f"Built {len(list(DIST.rglob('*.html')))} pages into {DIST.relative_to(ROOT)}")


if __name__ == "__main__":
    build()
    if "--serve" in sys.argv:
        subprocess.run([sys.executable, "-m", "http.server", "8080", "-d", str(DIST)])
