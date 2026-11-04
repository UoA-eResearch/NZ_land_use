"""Aggregate the LINZ-contour-derived 1-arcsec HGT DEM to the model grid.

Usage: python3 data/dem.py [hgt_dir] [grid.json]

Source tiles: https://github.com/JohnLeber/NZDEM-HGT-30 (CC BY 4.0, data (c) LINZ).
Each SxxEyyy.hgt is 3601x3601 big-endian int16 with its SW corner at (-xx, yyy);
-32768 is void and the sea is 0.

Steps
  1. Mosaic all tiles at 10 arcsec (~300 m N-S, ~230 m E-W) by block-averaging
     10x10 native pixels (voids ignored).
  2. Slope (degrees) on the 10-arcsec mosaic with true metric spacing per row.
  3. Bin every mosaic pixel into the model's equirectangular grid and take the
     mean elevation, mean slope and max elevation of each grid cell.
  4. Write them into grid.json as base64 arrays over the land cells, in the same
     row-major order the model uses (NZModel.build):
        elev  uint16 LE, metres (0..65535)
        slope uint8, degrees x 4 (0..63.75)
"""
import base64, glob, json, os, sys, zipfile
import numpy as np

HGT = sys.argv[1] if len(sys.argv) > 1 else 'cache/hgt'
GRID = sys.argv[2] if len(sys.argv) > 2 else 'grid.json'
F = 10                        # native pixels per mosaic pixel
NAT = 3600                    # native pixels per degree (tile size minus overlap)
P = NAT // F                  # mosaic pixels per degree
LAT_N, LAT_S, LON_W, LON_E = -34, -48, 166, 179

g = json.load(open(GRID))
W, H, CELL, LON0, LATTOP, K, KY = g['W'], g['H'], g['CELL'], g['LON0'], g['LATTOP'], g['K'], g['KY']
raw = np.frombuffer(base64.b64decode(g['mask']), dtype=np.uint8)
mask = np.unpackbits(raw, bitorder='little')[:W * H].astype(bool)
cells = np.flatnonzero(mask)
n = cells.size
print(f'grid {W}x{H} cell {CELL} km, {n} land cells')

rows, cols = (LAT_N - LAT_S) * P, (LON_E - LON_W) * P
elev = np.full((rows, cols), np.nan, np.float32)
files = sorted(glob.glob(os.path.join(HGT, '*.zip')) + glob.glob(os.path.join(HGT, '*.hgt')))
for fn in files:
    name = os.path.basename(fn)[:7]
    la, lo = int(name[1:3]), int(name[4:7])
    if fn.endswith('.zip'):
        z = zipfile.ZipFile(fn); b = z.read(z.namelist()[0])
    else:
        b = open(fn, 'rb').read()
    a = np.frombuffer(b, dtype='>i2').reshape(NAT + 1, NAT + 1)[:NAT, :NAT].astype(np.float32)
    a[a < -1000] = np.nan
    blk = a.reshape(P, F, P, F)
    with np.errstate(invalid='ignore'):
        m = np.nanmean(blk, axis=(1, 3))
    r0 = (LAT_N - (-la + 1)) * P            # tile's north edge is -la+1
    c0 = (lo - LON_W) * P
    elev[r0:r0 + P, c0:c0 + P] = m
print(f'mosaic {rows}x{cols} from {len(files)} tiles, max {np.nanmax(elev):.0f} m')

# slope on the mosaic (sea stays 0 so coastal cliffs register)
lat_c = LAT_N - (np.arange(rows) + 0.5) / P
dy = 110570.0 / P
dx = 111320.0 * np.cos(np.radians(lat_c)) / P
z = np.nan_to_num(elev, nan=0.0)
gy, gx = np.gradient(z)
slope = np.degrees(np.arctan(np.hypot(gx / dx[:, None], gy / dy)))

# bin to model grid
lon_c = LON_W + (np.arange(cols) + 0.5) / P
GX = np.floor((lon_c - LON0) * K / CELL).astype(np.int64)
GY = np.floor((LATTOP - lat_c) * KY / CELL).astype(np.int64)
ok = np.isfinite(elev) & (GY[:, None] >= 0) & (GY[:, None] < H) & (GX[None, :] >= 0) & (GX[None, :] < W)
key = (GY[:, None] * W + GX[None, :])[ok]
ev, sv = elev[ok], slope[ok]
land_px = ev > 0                               # ignore sea pixels inside coastal cells
cnt = np.bincount(key[land_px], minlength=W * H)
se = np.bincount(key[land_px], weights=ev[land_px], minlength=W * H)
ss = np.bincount(key[land_px], weights=sv[land_px], minlength=W * H)
emax = np.zeros(W * H, np.float32); np.maximum.at(emax, key[land_px], ev[land_px])

mean_e = np.where(cnt > 0, se / np.maximum(cnt, 1), np.nan)
mean_s = np.where(cnt > 0, ss / np.maximum(cnt, 1), np.nan)

# fill land cells the DEM misses (tiny islets, coastline mismatch) from neighbours
grid_e = mean_e.reshape(H, W); grid_s = mean_s.reshape(H, W); grid_m = emax.reshape(H, W)
need = mask.reshape(H, W) & ~np.isfinite(grid_e)
print(f'land cells without DEM: {need.sum()}')
for _ in range(20):
    if not need.any(): break
    pe = np.pad(grid_e, 1, constant_values=np.nan); ps = np.pad(grid_s, 1, constant_values=np.nan)
    stack_e = np.stack([pe[1 + dy_:H + 1 + dy_, 1 + dx_:W + 1 + dx_] for dy_ in (-1, 0, 1) for dx_ in (-1, 0, 1)])
    stack_s = np.stack([ps[1 + dy_:H + 1 + dy_, 1 + dx_:W + 1 + dx_] for dy_ in (-1, 0, 1) for dx_ in (-1, 0, 1)])
    with np.errstate(all='ignore'), __import__('warnings').catch_warnings():
        __import__('warnings').simplefilter('ignore')
        fe = np.nanmean(stack_e, axis=0); fs = np.nanmean(stack_s, axis=0)
    fill = need & np.isfinite(fe)
    grid_e[fill] = fe[fill]; grid_s[fill] = fs[fill]; grid_m[fill] = fe[fill]
    need &= ~fill
grid_e[need] = 2; grid_s[need] = 0; grid_m[need] = 2

e_land = np.clip(np.round(grid_e.ravel()[cells]), 0, 65535).astype('<u2')
s_land = np.clip(np.round(grid_s.ravel()[cells] * 4), 0, 255).astype(np.uint8)
m_land = np.clip(np.round(grid_m.ravel()[cells]), 0, 65535).astype('<u2')
g['elev'] = base64.b64encode(e_land.tobytes()).decode()
g['slope'] = base64.b64encode(s_land.tobytes()).decode()
g['demSource'] = 'NZDEM-HGT-30 (LINZ contours, CC BY 4.0), 10-arcsec mosaic'
json.dump(g, open(GRID, 'w'), separators=(',', ':'))

pct = lambda a, q: np.percentile(a, q)
print(f'elev mean {e_land.mean():.0f} m, p50 {pct(e_land, 50):.0f}, p92 {pct(e_land, 92):.0f}, max {e_land.max()} (cell max {m_land.max()})')
print(f'slope mean {s_land.mean() / 4:.1f} deg, p50 {pct(s_land, 50) / 4:.1f}, p90 {pct(s_land, 90) / 4:.1f}')
print(f'grid.json {os.path.getsize(GRID) / 1e3:.0f} kB')
