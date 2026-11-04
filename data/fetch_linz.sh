#!/bin/sh
# Download the LINZ 1:50k coastline polygons (layer 51153, CC BY 4.0) as GeoJSON in EPSG:4326.
# Needs a free LINZ Data Service API key:  LINZ_KEY=... sh data/fetch_linz.sh [out.json]
set -e
OUT=${1:-cache/coast.json}
: "${LINZ_KEY:?set LINZ_KEY}"
mkdir -p "$(dirname "$OUT")"
curl -sS -f -o "$OUT" "https://data.linz.govt.nz/services;key=$LINZ_KEY/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=layer-51153&srsName=EPSG:4326&outputFormat=json&propertyName=name,GEOMETRY"
