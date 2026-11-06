"""Fetch LINZ Topo50 landfill, quarry and mine features for the location report.

Usage: LINZ_KEY=... python3 data/report_features.py out.json

Layers (Toitu Te Whenua LINZ, CC BY 4.0): 50294 landfill polygons, 50314 quarry polygons,
50301 mine polygons, 50300 mine points. Geometry in NZTM2000, simplified to 2 m, rounded to 1 m.
"""
import json, os, sys, urllib.request
from shapely.geometry import shape, mapping

KEY = os.environ['LINZ_KEY']
LAYERS = {'landfill': 50294, 'quarry': 50314, 'mine': 50301, 'mine_pt': 50300}
out = {}
for name, lid in LAYERS.items():
    url = (f'https://data.linz.govt.nz/services;key={KEY}/wfs?service=WFS&version=2.0.0&request=GetFeature'
           f'&typeNames=layer-{lid}&srsName=EPSG:2193&outputFormat=json')
    fc = json.load(urllib.request.urlopen(url, timeout=120))
    feats = []
    for f in fc['features']:
        p, g = f['properties'], shape(f['geometry'])
        if g.geom_type != 'Point':
            g = g.simplify(2, preserve_topology=True)
        gj = mapping(g)

        def rnd(c):
            return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0]), round(c[1])]
        rec = {'n': p.get('name') or '', 'g': {'type': gj['type'], 'coordinates': rnd(gj['coordinates'])}}
        if p.get('status'): rec['s'] = p['status']
        if p.get('substance'): rec['u'] = p['substance']
        feats.append(rec)
    out[name] = feats
    print(name, len(feats))
json.dump(out, open(sys.argv[1], 'w'), separators=(',', ':'))
print(os.path.getsize(sys.argv[1]) // 1000, 'kB')
