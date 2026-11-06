#!/bin/sh
# Download the LINZ Crown Aerial Film Library photo footprints (layer 51002, CC BY 4.0) as paged
# GeoJSON in NZTM2000.   LINZ_KEY=... sh data/fetch_footprints.sh [outdir]
set -e
OUT=${1:-cache/footprints}
: "${LINZ_KEY:?set LINZ_KEY}"
mkdir -p "$OUT"
PAGE=20000
seq 0 $PAGE ${TOTAL:-706828} | xargs -P 4 -I{} sh -c '
  f="'"$OUT"'/p_$(printf %07d {}).json"; [ -s "$f" ] && exit 0
  for try in 1 2 3 4; do
    curl -sS -f -o "$f.part" "https://data.linz.govt.nz/services;key='"$LINZ_KEY"'/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=layer-51002&propertyName=survey,date,scale,shape&srsName=EPSG:2193&outputFormat=json&sortBy=sufi&count='"$PAGE"'&startIndex={}" && mv "$f.part" "$f" && exit 0
    sleep $((try * 3))
  done; echo "failed page {}" >&2; exit 1'
ls "$OUT"/p_*.json | wc -l
