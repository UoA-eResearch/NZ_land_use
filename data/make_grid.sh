#!/bin/sh
# Rebuild grid.json from scratch (about 10 minutes, ~2.5 GB of downloads in cache/).
#   LINZ_KEY=... LRIS_KEY=... sh data/make_grid.sh [cell_km]
set -e
CELL=${1:-1.0}
sh data/fetch_linz.sh cache/coast.json
sh data/fetch_hgt.sh cache/hgt
sh data/fetch_lcdb.sh cache/lcdb
python3 data/coast.py cache/coast.json "$CELL" grid.json
python3 data/dem.py cache/hgt grid.json
python3 data/lcdb.py cache/lcdb grid.json
