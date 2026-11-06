"""LCDB v6.0 class history at 25 m for point queries in the location report.

Usage: python3 data/report_lcdb.py lcdb_dir out_dir

lcdb_dir: paged GeoJSON from data/fetch_lcdb.sh (EPSG:4326).
Writes, in NZTM2000 (EPSG:2193):
  out_dir/lcdb_hist.json   [[c1996, c2001, c2008, c2012, c2018, c2023], ...]  (history id = index + 1)
  out_dir/lcdb/{tx}_{ty}.bin  256 x 256 tiles of 25 m pixels; tile (tx, ty) covers
      E = 1,000,000 + tx * 6400 ... + 6400,  N = 6,250,000 - ty * 6400 ... - 6400
      file = zlib( u16 n | u16[n] history ids | n <= 255 ? u8[65536] : u16[65536] palette indices ), little-endian,
      row-major from the north-west corner; palette index 0 with history id 0 means no LCDB polygon.
LCDB v6.0 (c) Manaaki Whenua - Landcare Research, CC BY 4.0.
"""
import glob, json, os, sys, time, zlib
import numpy as np
import shapely
from shapely.geometry import shape, box
from shapely.strtree import STRtree
from rasterio import features
from rasterio.transform import Affine
from pyproj import Transformer

SRC, OUT = sys.argv[1], sys.argv[2]
YEARS = (1996, 2001, 2008, 2012, 2018, 2023)
RES, TS = 25, 256                     # metres per pixel, pixels per tile
TILE = RES * TS                       # 6400 m
E0, N1 = 1_000_000, 6_250_000         # grid origin (north-west corner)
BLOCK = 16                            # tiles per block side (102.4 km)
T = Transformer.from_crs(4326, 2193, always_xy=True)

t0 = time.time()
hist, geoms, ids = {}, [], []
for fn in sorted(glob.glob(os.path.join(SRC, 'p_*.json'))):
    for f in json.load(open(fn))['features']:
        if not f['geometry']:
            continue
        p = f['properties']
        key = tuple(p.get(f'Class_{y}') or 0 for y in YEARS)
        ids.append(hist.setdefault(key, len(hist) + 1))
        geoms.append(shape(f['geometry']))
    print(f'{os.path.basename(fn)}: {len(geoms)} polygons, {len(hist)} histories, {time.time() - t0:.0f}s', flush=True)
assert len(hist) < 65535
geoms = shapely.transform(np.array(geoms, dtype=object), lambda xy: np.column_stack(T.transform(xy[:, 0], xy[:, 1])))
ids = np.array(ids, dtype=np.uint32)
tree = STRtree(geoms)
print(f'reprojected and indexed in {time.time() - t0:.0f}s', flush=True)

os.makedirs(os.path.join(OUT, 'lcdb'), exist_ok=True)
json.dump([list(k) for k, _ in sorted(hist.items(), key=lambda kv: kv[1])], open(os.path.join(OUT, 'lcdb_hist.json'), 'w'), separators=(',', ':'))

minx, miny, maxx, maxy = shapely.total_bounds(geoms)
bx0, bx1 = int((minx - E0) // (TILE * BLOCK)), int((maxx - E0) // (TILE * BLOCK))
by0, by1 = int((N1 - maxy) // (TILE * BLOCK)), int((N1 - miny) // (TILE * BLOCK))
ntiles = nbytes = 0
for by in range(by0, by1 + 1):
    for bx in range(bx0, bx1 + 1):
        x0, y1 = E0 + bx * TILE * BLOCK, N1 - by * TILE * BLOCK
        win = box(x0, y1 - TILE * BLOCK, x0 + TILE * BLOCK, y1)
        sel = tree.query(win, predicate='intersects')
        if not len(sel):
            continue
        n = TS * BLOCK
        a = features.rasterize(zip(geoms[sel], ids[sel]), out_shape=(n, n), transform=Affine(RES, 0, x0, 0, -RES, y1), dtype=np.uint32)
        for ty in range(BLOCK):
            for tx in range(BLOCK):
                t = a[ty * TS:(ty + 1) * TS, tx * TS:(tx + 1) * TS]
                if not t.any():
                    continue
                u, inv = np.unique(t, return_inverse=True)
                idx = inv.reshape(t.shape).astype('<u2' if len(u) > 255 else np.uint8)
                blob = zlib.compress(np.array([len(u)], '<u2').tobytes() + u.astype('<u2').tobytes() + idx.tobytes(), 9)
                with open(os.path.join(OUT, 'lcdb', f'{bx * BLOCK + tx}_{by * BLOCK + ty}.bin'), 'wb') as fh:
                    fh.write(blob)
                ntiles += 1; nbytes += len(blob)
        print(f'block {bx},{by}: {len(sel)} polygons; total {ntiles} tiles {nbytes / 1e6:.1f} MB, {time.time() - t0:.0f}s', flush=True)
print(f'done: {ntiles} tiles, {nbytes / 1e6:.1f} MB, {len(hist)} histories')
