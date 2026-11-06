"""Index Crown Aerial Film Library photo footprints by 1 km square for the location report.

Usage: python3 data/report_footprints.py footprint_dir out_dir

footprint_dir: paged GeoJSON from data/fetch_footprints.sh (LINZ layer 51002, NZTM, CC BY 4.0).
Writes:
  out_dir/foot_surveys.json   [[survey, year, scale, photos], ...]   (survey index = position)
  out_dir/foot/{bx}_{by}.json  {"l": [[survey index, ...], ...], "c": [1024 ints]} for a 32 x 32 km block of
      1 km squares (row-major from the north-west); c = 1 + index into l, or 0 for none.
Squares use the same NZTM grid origin as the LCDB tiles (E 1,000,000, N 6,250,000).
"""
import glob, json, os, sys, collections
import numpy as np
from shapely.geometry import shape
from rasterio import features
from rasterio.transform import Affine

SRC, OUT = sys.argv[1], sys.argv[2]
E0, N1, C, B = 1_000_000, 6_250_000, 1000, 32
by_survey = collections.defaultdict(list)
meta = {}
for fn in sorted(glob.glob(os.path.join(SRC, 'p_*.json'))):
    for f in json.load(open(fn))['features']:
        p, g = f['properties'], f['geometry']
        s = (p.get('survey') or '').strip()
        if not s or not g:
            continue
        m = meta.setdefault(s, {'years': collections.Counter(), 'scales': collections.Counter(), 'n': 0})
        m['n'] += 1
        if p.get('date'): m['years'][int(p['date'][:4])] += 1
        if p.get('scale'): m['scales'][int(p['scale'])] += 1
        by_survey[s].append(shape(g))
print(len(meta), 'surveys,', sum(len(v) for v in by_survey.values()), 'footprints', flush=True)

surveys = sorted(meta, key=lambda s: (min(meta[s]['years']) if meta[s]['years'] else 9999, s))
sidx = {s: i for i, s in enumerate(surveys)}
cells = collections.defaultdict(set)
for s, geoms in by_survey.items():
    xs = [b for g in geoms for b in (g.bounds[0], g.bounds[2])]; ys = [b for g in geoms for b in (g.bounds[1], g.bounds[3])]
    cx0, cx1 = int((min(xs) - E0) // C), int((max(xs) - E0) // C)
    cy0, cy1 = int((N1 - max(ys)) // C), int((N1 - min(ys)) // C)
    if cx1 - cx0 > 2000 or cy1 - cy0 > 2000:   # bad geometry
        continue
    w, h = cx1 - cx0 + 1, cy1 - cy0 + 1
    a = features.rasterize(((g, 1) for g in geoms), out_shape=(h, w), transform=Affine(C, 0, E0 + cx0 * C, 0, -C, N1 - cy0 * C), all_touched=True, dtype=np.uint8)
    for yy, xx in zip(*np.nonzero(a)):
        cells[(cx0 + xx, cy0 + yy)].add(sidx[s])
print(len(cells), '1 km squares covered', flush=True)

os.makedirs(os.path.join(OUT, 'foot'), exist_ok=True)
blocks = collections.defaultdict(dict)
for (cx, cy), ss in cells.items():
    blocks[(cx // B, cy // B)][(cy % B) * B + (cx % B)] = tuple(sorted(ss))
size = 0
for (bx, by), d in blocks.items():
    lists, lid, c = [], {}, [0] * (B * B)
    for k, ss in d.items():
        if ss not in lid:
            lid[ss] = len(lists) + 1; lists.append(list(ss))
        c[k] = lid[ss]
    fn = os.path.join(OUT, 'foot', f'{bx}_{by}.json')
    json.dump({'l': lists, 'c': c}, open(fn, 'w'), separators=(',', ':'))
    size += os.path.getsize(fn)
table = []
for s in surveys:
    m = meta[s]
    yr = min(m['years']) if m['years'] else None
    sc = m['scales'].most_common(1)[0][0] if m['scales'] else None
    table.append([s if s.upper().startswith('SN') else 'SN' + s, yr, sc, m['n']])
json.dump(table, open(os.path.join(OUT, 'foot_surveys.json'), 'w'), separators=(',', ':'))
print(f'{len(blocks)} block files, {size / 1e6:.1f} MB; survey table {os.path.getsize(os.path.join(OUT, "foot_surveys.json")) / 1e3:.0f} kB')
