"""Build the model grid (land mask + coastline path) from the LINZ 1:50k coastline.

Usage: python3 data/coast.py coast.geojson CELL_KM out_grid.json

coast.geojson: LINZ "NZ Coastlines and Islands Polygons (Topo 1:50k)", layer 51153,
CC BY 4.0, fetched by data/fetch_linz.sh in EPSG:4326.

Grid: equirectangular, x = (lon - 166.3) * cos(41 deg) * 111.32 / CELL,
y = (-34.3 - lat) * 110.57 / CELL. A cell is land when at least half of it is
land at 125 m. The coastline is simplified to ~0.15 cells and stored as an SVG
path in grid units.
"""
import base64, json, math, sys
import numpy as np
from rasterio import features
from rasterio.transform import Affine
from shapely.geometry import shape, box, mapping
from shapely.ops import transform as stransform

src, CELL, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
LAT0, LON0, LATTOP, LONR, LATB = -41.0, 166.3, -34.3, 178.7, -47.4
K = math.cos(math.radians(LAT0)) * 111.32
KY = 110.57
W = math.ceil((LONR - LON0) * K / CELL)
H = math.ceil((LATTOP - LATB) * KY / CELL)
S = max(1, round(CELL / 0.125))                     # subpixels per cell edge

bbox = box(LON0, LATB, LONR, LATTOP)
geoms = []
for f in json.load(open(src))['features']:
    g = shape(f['geometry'])
    if g.intersects(bbox):
        geoms.append(g.intersection(bbox))
print(f'{len(geoms)} coastline polygons in bbox')

tr = Affine(CELL / K / S, 0, LON0, 0, -CELL / KY / S, LATTOP)
fine = features.rasterize(((g, 1) for g in geoms), out_shape=(H * S, W * S), transform=tr, dtype=np.uint8, all_touched=False)
frac = fine.reshape(H, S, W, S).mean(axis=(1, 3))
mask = (frac >= 0.5).ravel()
n = int(mask.sum())
bits = np.packbits(mask.astype(np.uint8), bitorder='little')

# coastline path in grid units
to_grid = lambda x, y, z=None: ((np.asarray(x) - LON0) * K / CELL, (LATTOP - np.asarray(y)) * KY / CELL)
parts, pts = [], 0
min_area = 0.6                                         # grid cells^2; drop specks
for g in geoms:
    gg = stransform(to_grid, g).simplify(0.15, preserve_topology=True)
    for poly in getattr(gg, 'geoms', [gg]):
        if poly.is_empty or poly.geom_type != 'Polygon' or poly.area < min_area:
            continue
        for ring in [poly.exterior]:                   # outer rings only; lakes come from LCDB
            c = np.asarray(ring.coords)
            q = np.round(c * 10) / 10
            s = 'M' + 'L'.join(f'{x:g} {y:g}' for x, y in q[:-1]) + 'Z'
            parts.append(s); pts += len(q)
path = ''.join(parts)

grid = dict(W=W, H=H, CELL=CELL, LAT0=LAT0, LON0=LON0, LATTOP=LATTOP, K=K, KY=KY,
            mask=base64.b64encode(bits.tobytes()).decode(), coast=path,
            coastSource='LINZ NZ Coastlines and Islands Polygons (Topo 1:50k), CC BY 4.0')
json.dump(grid, open(out, 'w'), separators=(',', ':'))
print(f'grid {W}x{H} @ {CELL} km: {n} land cells = {n * CELL * CELL:,.0f} km2; coast {pts} pts, {len(path) / 1e3:.0f} kB')
