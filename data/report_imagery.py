"""Index LINZ aerial imagery collections in the public nz-imagery bucket for the location report.

Usage: python3 data/report_imagery.py out.json

Keeps every collection flown before 2000 (scanned historical surveys, orthorectified) and
later regional rural surveys at 0.2-1 m. For each: path, title, years, ground resolution,
and the Topo50-grid tiles it holds at each tile scale (e.g. 'BA31_1009' at 1:5000), so the
browser can work out which COG covers a point. Imagery (c) Toitu Te Whenua LINZ, CC BY 4.0.
"""
import json, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

B = 'https://nz-imagery.s3.ap-southeast-2.amazonaws.com/'
REGIONS = ['auckland', 'bay-of-plenty', 'canterbury', 'gisborne', 'hawkes-bay', 'manawatu-whanganui', 'marlborough', 'nelson',
           'northland', 'otago', 'southland', 'taranaki', 'tasman', 'waikato', 'wellington', 'west-coast']


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def prefixes(region):
    out, token = [], None
    while True:
        u = f'{B}?list-type=2&delimiter=/&prefix={region}/' + (f'&continuation-token={urllib.parse.quote(token)}' if token else '')
        x = get(u).decode()
        out += [p for p in re.findall(r'<Prefix>([^<]+)</Prefix>', x) if p != f'{region}/']
        m = re.search(r'<NextContinuationToken>([^<]+)</NextContinuationToken>', x)
        if not m:
            return out
        token = m.group(1)


import urllib.parse
cands = []
for r in REGIONS:
    for p in prefixes(r):
        m = re.search(r'_(\d{4})(?:-(\d{4}))?_([\d.]+)m/$', p)
        if not m:
            continue
        y0, y1, gsd = int(m.group(1)), int(m.group(2) or m.group(1)), float(m.group(3))
        if y0 < 2000 or 0.2 <= gsd <= 1.0:
            cands.append((p, y0, y1, gsd))
print(len(cands), 'candidate collections', flush=True)


def load(c):
    p, y0, y1, gsd = c
    try:
        coll = json.loads(get(B + p + 'rgb/2193/collection.json'))
    except Exception as e:  # some collections have no rgb/2193 (e.g. other bands); skip them
        return None
    tiles = {}
    for l in coll['links']:
        if l['rel'] != 'item':
            continue
        name = l['href'].rsplit('/', 1)[-1][:-5]          # BA31_5000_1009
        parts = name.split('_')
        if len(parts) != 3:
            continue
        tiles.setdefault(parts[1], []).append(parts[0] + parts[2])
    if not tiles:
        return None
    hist = coll.get('linz:geospatial_category') == 'scanned-aerial-photos'
    return {'p': p + 'rgb/2193/', 't': coll.get('title', p), 'y0': y0, 'y1': y1, 'g': gsd, 'h': 1 if hist else 0,
            'k': {s: ' '.join(sorted(v)) for s, v in tiles.items()}}


with ThreadPoolExecutor(16) as ex:
    out = [c for c in ex.map(load, cands) if c]
out.sort(key=lambda c: (c['y0'], c['p']))
json.dump({'base': B, 'collections': out}, open(sys.argv[1], 'w'), separators=(',', ':'))
n = sum(len(v.split()) for c in out for v in c['k'].values())
print(f'{len(out)} collections ({sum(c["y0"] < 2000 for c in out)} before 2000), {n} tiles')
