#!/bin/sh
# Download LCDB v6.0 Mainland (LRIS layer 123148, CC BY 4.0, Manaaki Whenua) via WFS
# as paged GeoJSON in EPSG:4326, class codes for all six epochs only.
# Needs a free LRIS API key with WFS access:  LRIS_KEY=... sh data/fetch_lcdb.sh [outdir]
set -e
OUT=${1:-cache/lcdb}
: "${LRIS_KEY:?set LRIS_KEY}"
mkdir -p "$OUT"
PAGE=10000
TOTAL=${TOTAL:-542789}
seq 0 $PAGE $TOTAL | xargs -P 4 -I{} sh -c '
  f="'"$OUT"'/p_$(printf %07d {}).json"
  [ -s "$f" ] && exit 0
  for try in 1 2 3 4; do
    curl -sS -f -o "$f.part" "https://lris.scinfo.org.nz/services;key='"$LRIS_KEY"'/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=layer-123148&propertyName=Class_1996,Class_2001,Class_2008,Class_2012,Class_2018,Class_2023,GEOMETRY&srsName=EPSG:4326&outputFormat=json&sortBy=LCDB_UID&count='"$PAGE"'&startIndex={}" && mv "$f.part" "$f" && exit 0
    sleep $((try * 3))
  done
  echo "failed page {}" >&2; exit 1'
ls "$OUT"/p_*.json | wc -l
