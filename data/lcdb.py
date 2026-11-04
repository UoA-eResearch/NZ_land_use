"""Rasterise LCDB v6.0 (all six epochs) to the model grid by majority class.

Usage: python3 data/lcdb.py lcdb_dir grid.json

lcdb_dir: paged GeoJSON from data/fetch_lcdb.sh (LRIS layer 123148, EPSG:4326).
LCDB v6.0 (c) Manaaki Whenua - Landcare Research, CC BY 4.0.

Each polygon's index is burnt into a 125 m raster laid out in the grid's own
lon/lat frame, then each epoch's LCDB class is mapped to an observed code and
the majority code among a cell's 125 m pixels is taken (ignoring unmapped
pixels). Codes are the model's class ids (1..11) plus 12 = high-producing
exotic grassland, which the model later splits into dairy or sheep & beef.

Adds to grid.json:
  lcYears  [1996, 2001, 2008, 2012, 2018, 2023]  (summers 1996/97 ... 2023/24)
  lc       base64, 4-bit codes, epoch-major over land cells (two cells per byte, low nibble first)
  lcArea   national area share (%) per epoch per code from the 125 m pixels, for reporting
"""
import base64, glob, json, os, sys, time
import numpy as np
from rasterio import features
from rasterio.transform import Affine
from shapely.geometry import shape

LC_DIR, GRID = sys.argv[1], sys.argv[2]
YEARS = [1996, 2001, 2008, 2012, 2018, 2023]
NAT, SCRUB, TUSS, WET, ALP, SHEEP, DAIRY, PINE, CROP, URB, LAKE, HPG = range(1, 13)
MAP = {
    1: URB, 2: URB, 5: URB, 6: URB,                 # built-up, parkland, transport, mines & dumps
    10: ALP, 12: ALP, 14: ALP, 15: ALP, 16: ALP,     # sand/gravel, landslide, snow & ice, alpine herbfield, rock
    20: LAKE, 21: LAKE, 22: LAKE,                    # lakes, rivers, estuarine open water
    30: CROP, 33: CROP,                              # short-rotation cropland, orchards & vineyards
    40: HPG, 41: SHEEP,                              # high- / low-producing grassland
    43: TUSS, 44: TUSS,                              # tall tussock, depleted grassland
    45: WET, 46: WET, 47: WET, 70: WET,              # herbaceous fresh/saline, flaxland, mangrove
    50: SCRUB, 51: SCRUB, 52: SCRUB, 54: SCRUB, 56: SCRUB, 58: SCRUB, 68: SCRUB,
    55: ALP,                                          # sub-alpine shrubland: above the treeline, never cleared
    64: PINE, 71: PINE,                              # harvested and standing exotic forest
    69: NAT,                                          # indigenous forest
}
LUT = np.zeros(256, np.uint8)
for k, v in MAP.items(): LUT[k] = v

g = json.load(open(GRID))
W, H, CELL, LON0, LATTOP, K, KY = g['W'], g['H'], g['CELL'], g['LON0'], g['LATTOP'], g['K'], g['KY']
mask = np.unpackbits(np.frombuffer(base64.b64decode(g['mask']), np.uint8), bitorder='little')[:W * H].astype(bool)
cells = np.flatnonzero(mask); n = cells.size
S = max(1, round(CELL / 0.125))
tr = Affine(CELL / K / S, 0, LON0, 0, -CELL / KY / S, LATTOP)
idx = np.zeros((H * S, W * S), np.uint32)
classes = [np.zeros(6, np.uint8)]
t0 = time.time(); base = 1
for fn in sorted(glob.glob(os.path.join(LC_DIR, 'p_*.json'))):
    feats = json.load(open(fn))['features']
    shp = []
    for j, f in enumerate(feats):
        p = f['properties']
        classes.append(np.array([p.get(f'Class_{y}') or 0 for y in YEARS], np.uint8))
        if f['geometry']: shp.append((shape(f['geometry']), base + j))
    features.rasterize(shp, out=idx, transform=tr)
    base += len(feats)
    print(f'{os.path.basename(fn)} {base - 1} polys {time.time() - t0:.0f}s', flush=True)
classes = np.stack(classes)                           # (npoly+1, 6)
unmapped = set(np.unique(classes[1:])) - set(MAP) - {0}
if unmapped: print('WARNING unmapped LCDB classes:', sorted(unmapped))

cellkey = (np.arange(H * S)[:, None] // S) * W + (np.arange(W * S)[None, :] // S)
cellkey = cellkey.ravel()
flat = idx.ravel()
out = np.zeros((6, n), np.uint8)
area = []
for e in range(6):
    code = LUT[classes[flat, e]]
    cnt = np.bincount(cellkey * 13 + code, minlength=W * H * 13).reshape(W * H, 13)
    cnt[:, 0] = 0
    maj = cnt.argmax(axis=1).astype(np.uint8)
    maj[cnt.sum(axis=1) == 0] = 0
    out[e] = maj[cells]
    tot = np.bincount(code, minlength=13)[1:].astype(float)
    area.append([round(v, 3) for v in (100 * tot / tot.sum())])

# fill land cells with no LCDB pixels (coastline slivers) from neighbours
grid_xy = np.full(W * H, -1, np.int64); grid_xy[cells] = np.arange(n)
for e in range(6):
    for _ in range(10):
        miss = np.flatnonzero(out[e] == 0)
        if not miss.size: break
        k = cells[miss]; x, y = k % W, k // W
        best = np.zeros(miss.size, np.uint8)
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
            nx, ny = x + dx, y + dy
            ok = (nx >= 0) & (ny >= 0) & (nx < W) & (ny < H)
            j = np.where(ok, grid_xy[np.clip(ny, 0, H - 1) * W + np.clip(nx, 0, W - 1)], -1)
            v = np.where(j >= 0, out[e][np.maximum(j, 0)], 0)
            best = np.where((best == 0) & (v > 0), v, best)
        out[e][miss] = best
    out[e][out[e] == 0] = SHEEP
print('cells filled from neighbours or defaulted:', int((out == 0).sum()))

packed = out.ravel()
if packed.size % 2: packed = np.append(packed, 0)
nib = (packed[0::2] & 15) | ((packed[1::2] & 15) << 4)
g['lcYears'] = YEARS
g['lc'] = base64.b64encode(nib.astype(np.uint8).tobytes()).decode()
g['lcArea'] = area
g['lcSource'] = 'LCDB v6.0 Mainland (Manaaki Whenua, CC BY 4.0), majority class per cell from 125 m'
json.dump(g, open(GRID, 'w'), separators=(',', ':'))

names = ['NAT', 'SCRUB', 'TUSS', 'WET', 'ALP', 'SHEEP', 'DAIRY', 'PINE', 'CROP', 'URB', 'LAKE', 'HPG']
for e, y in enumerate(YEARS):
    cc = np.bincount(out[e], minlength=13)[1:] / n * 100
    print(y, 'cells%', ' '.join(f'{nm}:{v:.1f}' for nm, v in zip(names, cc)))
    print(y, 'area% ', ' '.join(f'{nm}:{v:.1f}' for nm, v in zip(names, area[e])))
print(f'grid.json {os.path.getsize(GRID) / 1e3:.0f} kB, {time.time() - t0:.0f}s')
