#!/bin/sh
# Download the NZDEM-HGT-30 1-arcsec tiles (LINZ-contour-derived, CC BY 4.0, data (c) LINZ).
# https://github.com/JohnLeber/NZDEM-HGT-30   Usage: sh data/fetch_hgt.sh [outdir]
OUT=${1:-cache/hgt}
mkdir -p "$OUT"
for la in $(seq 34 48); do for lo in $(seq 166 178); do echo "S${la}E${lo}"; done; done |
  xargs -P 8 -I{} sh -c '[ -s "'"$OUT"'/{}.zip" ] || { curl -sS -f -o "'"$OUT"'/{}.zip.part" "https://raw.githubusercontent.com/JohnLeber/NZDEM-HGT-30/master/HGT/{}.zip" && mv "'"$OUT"'/{}.zip.part" "'"$OUT"'/{}.zip"; rm -f "'"$OUT"'/{}.zip.part"; }' 2>/dev/null
ls "$OUT"/*.zip | wc -l   # expect 65
