// Launchbench site: mobile menu, header shadow, pricing centre switcher.
document.addEventListener("DOMContentLoaded", () => {
  // Email links: the address is assembled here, so it is not in the page source.
  // On the Book a tour page, ?interest=event&centre=KOR (from the buttons that link
  // there) sets the subject, e.g. "Event enquiry: Koramangala".
  const q = new URLSearchParams(location.search);
  const topics = { founders: "Founders Plan enquiry", event: "Event enquiry", meeting: "Meeting room enquiry", virtual: "Virtual office enquiry" };
  document.querySelectorAll("[data-mail-u]").forEach((a) => {
    let subject = a.dataset.mailS || "";
    if (a.hasAttribute("data-mail-tour")) {
      const centres = JSON.parse(a.dataset.mailTour || "{}");
      subject = (topics[q.get("interest")] || "Tour request") + (centres[q.get("centre")] ? ": " + centres[q.get("centre")] : "");
    }
    const params = [subject && "subject=" + encodeURIComponent(subject), a.dataset.mailB && "body=" + encodeURIComponent(a.dataset.mailB)].filter(Boolean);
    a.href = "mailto:" + a.dataset.mailU + "@" + a.dataset.mailD + (params.length ? "?" + params.join("&") : "");
  });


  const header = document.querySelector("[data-header]");
  if (header) {
    const onScroll = () => header.classList.toggle("shadow-soft", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  document.querySelectorAll("[data-centre-tabs]").forEach((tabs) => {
    const scope = tabs.closest("[data-centre-scope]") || document;
    const buttons = tabs.querySelectorAll("[data-centre]");
    const select = (code) => {
      buttons.forEach((b) => {
        const on = b.dataset.centre === code;
        b.setAttribute("aria-selected", String(on));
        b.classList.toggle("bg-ink", on);
        b.classList.toggle("text-white", on);
        b.classList.toggle("text-ink-600", !on);
      });
      scope.querySelectorAll("[data-price]").forEach((el) => {
        const v = el.getAttribute("data-price-" + code.toLowerCase());
        el.textContent = v || "—";
        const row = el.closest("[data-optional]");
        if (row) row.classList.toggle("opacity-40", !v);
      });
      scope.querySelectorAll("[data-centre-panel]").forEach((p) => p.classList.toggle("hidden", p.dataset.centrePanel !== code));
    };
    buttons.forEach((b) => b.addEventListener("click", () => select(b.dataset.centre)));
    const want = new URLSearchParams(location.search).get("centre");
    const first = [...buttons].find((b) => b.dataset.centre === want) || buttons[0];
    if (first) select(first.dataset.centre);
  });
});
