#!/usr/bin/env bash
# Screenshot site pages with headless Chrome: tools/shoot_site.sh OUTDIR path1 [path2 ...]
# Serves site/dist on port 8765 for the duration.
set -e
OUT=$1; shift
mkdir -p "$OUT"
python3 -m http.server 8765 -d "$(dirname "$0")/../site/dist" >/dev/null 2>&1 &
SRV=$!; trap 'kill $SRV' EXIT; sleep 1
for p in "$@"; do
  name=$(echo "$p" | sed 's#^/##; s#/$##; s#/#_#g'); name=${name:-home}
  for w in 1440 390; do
    google-chrome --headless=new --disable-gpu --hide-scrollbars --no-sandbox --virtual-time-budget=6000 \
      --window-size=$w,$([ $w = 390 ] && echo 16000 || echo 9000) --screenshot="$OUT/$name-$w.png" "http://localhost:8765$p" >/dev/null 2>&1
  done
done
ls "$OUT"
