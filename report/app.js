/* Land-use history report for a place in Aotearoa New Zealand.
   Runs entirely in the browser on static open data:
   - LCDB v6.0 land cover 1996-2023 at 25 m (Manaaki Whenua, CC BY 4.0)
   - orthorectified historical and recent aerial photos read directly from LINZ's public nz-imagery bucket (CC BY 4.0)
   - Crown Aerial Film Library photo footprints 1936-2008 (LINZ, CC BY 4.0)
   - LINZ Topo50 landfill, quarry and mine features (CC BY 4.0)
   - the 1 km land-use reconstruction 1840-1995 from this repository (modelled)
   Addresses are geocoded with OpenStreetMap Nominatim; nothing is stored. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  proj4.defs('EPSG:2193', '+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
  var toNZTM = function (lon, lat) { return proj4('EPSG:4326', 'EPSG:2193', [lon, lat]); };
  var toLL = function (x, y) { return proj4('EPSG:2193', 'EPSG:4326', [x, y]); };

  // ---------- reference data ----------
  var LY = [1996, 2001, 2008, 2012, 2018, 2023];
  var LCDB = {
    0: ['Not land', '#d3e0e3'], 1: ['Built-up area (settlement)', '#c23b2a'], 2: ['Urban parkland/open space', '#e3a59c'], 5: ['Transport infrastructure', '#7d6f6a'],
    6: ['Surface mine or dump', '#5b2a6e'], 10: ['Sand and gravel', '#e8dcc0'], 12: ['Landslide', '#c9b79c'], 14: ['Permanent snow and ice', '#eef3f6'],
    15: ['Alpine grass/herbfield', '#d9dccb'], 16: ['Gravel and rock', '#bdbdb5'], 20: ['Lake or pond', '#7fa6c2'], 21: ['River', '#7fa6c2'], 22: ['Estuarine open water', '#9dbccc'],
    30: ['Short-rotation cropland', '#e3b860'], 33: ['Orchard, vineyard or other perennial crop', '#c97a1e'], 40: ['High producing exotic grassland', '#b3cf78'],
    41: ['Low producing grassland', '#d2dea6'], 43: ['Tall tussock grassland', '#d6bf78'], 44: ['Depleted grassland', '#e2d29e'], 45: ['Herbaceous freshwater vegetation', '#3f9c9a'],
    46: ['Herbaceous saline vegetation', '#6fb7a7'], 47: ['Flaxland', '#5c8f6a'], 50: ['Fernland', '#a3a35c'], 51: ['Gorse and/or broom', '#b5a832'], 52: ['Mānuka and/or kānuka', '#8d904c'],
    54: ['Broadleaved indigenous hardwoods', '#6c8a4c'], 55: ['Sub alpine shrubland', '#9aa58a'], 56: ['Mixed exotic shrubland', '#a8a070'], 58: ['Matagouri or grey scrub', '#a29b78'],
    64: ['Forest – harvested', '#8aa0ac'], 68: ['Deciduous hardwoods', '#6f9a7a'], 69: ['Indigenous forest', '#2f5d3a'], 70: ['Mangrove', '#4d7d5e'], 71: ['Exotic forest', '#1f4a5e']
  };
  var MODEL = { 1: ['Native forest', '#2f5d3a'], 2: ['Scrub & fernland', '#8d904c'], 3: ['Tussock grassland', '#d6bf78'], 4: ['Wetland', '#3f9c9a'], 5: ['Alpine & bare ground', '#dfe3e6'],
    6: ['Sheep & beef pasture', '#b3cf78'], 7: ['Dairy pasture', '#45ad46'], 8: ['Plantation forest', '#1f4a5e'], 9: ['Crops & horticulture', '#d8952f'], 10: ['Urban', '#c23b2a'], 11: ['Lake or river', '#7fa6c2'] };
  var HAIL = {
    A5: 'A5 Dry-cleaning plants', A8: 'A8 Livestock dip or spray race operations',
    A10: 'A10 Persistent pesticide bulk storage or use including sport turfs, market gardens, orchards, glass houses or spray sheds',
    E7: 'E7 Mining industries (excluding gravel extraction)', F1: 'F1 Airports', F4: 'F4 Motor vehicle workshops', F6: 'F6 Railway yards', F7: 'F7 Service stations',
    F8: 'F8 Transport depots or yards', G3: 'G3 Landfill sites', G5: 'G5 Waste disposal to land',
    H: 'H Land subject to the migration of hazardous substances from adjacent land'
  };
  var E0 = 1000000, N1 = 6250000, RES = 25, TS = 256, TILE = RES * TS;

  // ---------- small helpers ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function season(y) { return y + '/' + String((y + 1) % 100).padStart(2, '0'); }
  function fmtDist(m) { return m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km'; }
  function yearsText(ys) {
    if (!ys.length) return '';
    var runs = [], s = ys[0], p = ys[0];
    for (var i = 1; i < ys.length; i++) { var a = LY.indexOf(p), b = LY.indexOf(ys[i]); if (b === a + 1) p = ys[i]; else { runs.push([s, p]); s = p = ys[i]; } }
    runs.push([s, p]);
    return runs.map(function (r) { return r[0] === r[1] ? season(r[0]) : season(r[0]) + '–' + season(r[1]); }).join(', ');
  }
  async function inflate(buf) {
    var s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  var memo = {};
  function once(key, fn) { return memo[key] || (memo[key] = fn().catch(function (e) { delete memo[key]; throw e; })); }
  function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }); }

  // ---------- LCDB 25 m tiles ----------
  var tileCache = new Map();
  function lcdbTile(tx, ty) {
    var k = tx + '_' + ty;
    if (!tileCache.has(k)) tileCache.set(k, fetch('data/lcdb/' + k + '.bin').then(function (r) {
      if (!r.ok) return null;
      return r.arrayBuffer().then(inflate).then(function (u8) {
        var dv = new DataView(u8.buffer), n = dv.getUint16(0, true), pal = new Uint16Array(n);
        for (var i = 0; i < n; i++) pal[i] = dv.getUint16(2 + 2 * i, true);
        var off = 2 + 2 * n, idx = n > 255 ? new Uint16Array(u8.buffer.slice(off, off + 2 * TS * TS)) : u8.subarray(off, off + TS * TS);
        return { pal: pal, idx: idx };
      });
    }).catch(function () { return null; }));
    return tileCache.get(k);
  }
  function tileOf(x, y) { return [Math.floor((x - E0) / TILE), Math.floor((N1 - y) / TILE)]; }
  function histAtSync(tiles, x, y) {
    var t = tileOf(x, y), T = tiles[t[0] + '_' + t[1]];
    if (!T) return 0;
    var px = Math.floor((x - E0 - t[0] * TILE) / RES), py = Math.floor((N1 - t[1] * TILE - y) / RES);
    if (px < 0 || py < 0 || px >= TS || py >= TS) return 0;
    return T.pal[T.idx[py * TS + px]];
  }
  async function tilesAround(x, y, r) {
    var a = tileOf(x - r, y + r), b = tileOf(x + r, y - r), out = {}, jobs = [];
    for (var tx = a[0]; tx <= b[0]; tx++) for (var ty = a[1]; ty <= b[1]; ty++) (function (tx, ty) { jobs.push(lcdbTile(tx, ty).then(function (T) { out[tx + '_' + ty] = T; })); })(tx, ty);
    await Promise.all(jobs);
    return out;
  }

  // ---------- Topo50 tile names (LINZ imagery grid) ----------
  var LET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  function tileId(x, y, scale) {
    var row = Math.floor((6234000 - y) / 36000), col = Math.floor((x - 988000) / 24000), r = row + 16;
    var sheet = LET[Math.floor(r / 24)] + LET[r % 24] + String(col).padStart(2, '0');
    var n = 50000 / scale, tw = 24000 / n, th = 36000 / n, x0 = 988000 + col * 24000, y0 = 6234000 - row * 36000;
    var tx = Math.floor((x - x0) / tw) + 1, ty = Math.floor((y0 - y) / th) + 1, d = Math.max(2, String(n).length);
    var id = String(ty).padStart(d, '0') + String(tx).padStart(d, '0');
    return { key: sheet + id, file: sheet + '_' + scale + '_' + id };
  }
  function loadImagery() {
    return once('img', function () {
      return getJSON('data/imagery.json').then(function (d) {
        d.collections.forEach(function (c) { c.sets = {}; Object.keys(c.k).forEach(function (s) { c.sets[s] = new Set(c.k[s].split(' ')); }); delete c.k; });
        return d;
      });
    });
  }
  function imageryAt(img, x, y, half) {
    var out = [];
    img.collections.forEach(function (c) {
      var files = {};
      Object.keys(c.sets).forEach(function (s) {
        [[x, y], [x - half, y - half], [x + half, y - half], [x - half, y + half], [x + half, y + half]].forEach(function (p, k) {
          var t = tileId(p[0], p[1], +s); if (c.sets[s].has(t.key)) files[t.file] = files[t.file] || (k === 0);
        });
      });
      var names = Object.keys(files);
      if (names.some(function (f) { return files[f]; })) out.push({ c: c, files: names });
    });
    return out;
  }

  // ---------- minimal COG reader (LINZ COGs: tiled, WebP, with overviews) ----------
  var cogs = new Map();
  async function rangeBytes(url, off, len) {
    var r = await fetch(url, { headers: { Range: 'bytes=' + off + '-' + (off + len - 1) } });
    if (!(r.status === 206 || r.status === 200)) throw new Error('fetch ' + r.status);
    var b = new Uint8Array(await r.arrayBuffer());
    return r.status === 200 ? b.subarray(off, off + len) : b;
  }
  function cogOpen(url) {
    if (!cogs.has(url)) cogs.set(url, (async function () {
      var head = await rangeBytes(url, 0, 65536), dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
      var le = head[0] === 0x49; if (dv.getUint16(2, le) !== 42) throw new Error('not a classic TIFF');
      var SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };
      async function vals(type, count, voff) {
        var n = SZ[type] * count, src, o;
        if (n <= 4) { src = dv; o = voff; }
        else { var off = dv.getUint32(voff, le); if (off + n <= head.byteLength) { src = dv; o = off; } else { var b = await rangeBytes(url, off, n); src = new DataView(b.buffer, b.byteOffset, b.byteLength); o = 0; } }
        var a = new Array(count);
        for (var i = 0; i < count; i++) a[i] = type === 3 ? src.getUint16(o + 2 * i, le) : type === 4 ? src.getUint32(o + 4 * i, le) : type === 12 ? src.getFloat64(o + 8 * i, le) : src.getUint8(o + i);
        return a;
      }
      var ifds = [], geo = {}, off = dv.getUint32(4, le);
      while (off && off + 2 < head.byteLength) {
        var cnt = dv.getUint16(off, le), I = {};
        for (var i = 0; i < cnt; i++) {
          var e = off + 2 + 12 * i, tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), count = dv.getUint32(e + 4, le);
          if (tag === 256 || tag === 257 || tag === 322 || tag === 323) I[tag] = (await vals(type, 1, e + 8))[0];
          else if (tag === 324) I.off = await vals(type, count, e + 8);
          else if (tag === 325) I.len = await vals(type, count, e + 8);
          else if (!ifds.length && (tag === 33550 || tag === 33922)) geo[tag] = await vals(type, count, e + 8);
        }
        ifds.push({ w: I[256], h: I[257], tw: I[322], th: I[323], off: I.off, len: I.len });
        off = dv.getUint32(off + 2 + 12 * cnt, le);
      }
      var sc = geo[33550], tp = geo[33922];
      return { ifds: ifds, sx: sc[0], ox: tp[3] - tp[0] * sc[0], oy: tp[4] + tp[1] * sc[1] };
    })());
    return cogs.get(url);
  }
  // draw the NZTM window [wx0, wy1 - size] .. [wx0 + size, wy1] of a COG onto ctx (outPx square)
  async function cogDraw(url, ctx, wx0, wy1, size, outPx) {
    var C = await cogOpen(url), target = size / outPx, L = 0;
    for (var k = C.ifds.length - 1; k >= 0; k--) { if (C.sx * C.ifds[0].w / C.ifds[k].w <= target * 1.05) { L = k; break; } }
    var I = C.ifds[L], res = C.sx * C.ifds[0].w / I.w, px0 = (wx0 - C.ox) / res, py0 = (C.oy - wy1) / res, pw = size / res, s = outPx / pw;
    var across = Math.ceil(I.w / I.tw), down = Math.ceil(I.h / I.th);
    var tx0 = Math.max(0, Math.floor(px0 / I.tw)), tx1 = Math.min(across - 1, Math.floor((px0 + pw) / I.tw));
    var ty0 = Math.max(0, Math.floor(py0 / I.th)), ty1 = Math.min(down - 1, Math.floor((py0 + pw) / I.th));
    var jobs = [];
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) (function (tx, ty) {
      var j = ty * across + tx; if (!I.len[j]) return;
      jobs.push(rangeBytes(url, I.off[j], I.len[j]).then(function (b) { return createImageBitmap(new Blob([b], { type: 'image/webp' })); })
        .then(function (bm) { ctx.drawImage(bm, (tx * I.tw - px0) * s, (ty * I.th - py0) * s, I.tw * s, I.th * s); bm.close && bm.close(); }));
    })(tx, ty);
    await Promise.all(jobs);
  }
  async function drawPhoto(cand, base, canvas, x, y, size) {
    var ctx = canvas.getContext('2d'), n = canvas.width;
    ctx.clearRect(0, 0, n, n); ctx.imageSmoothingQuality = 'high';
    await Promise.all(cand.files.map(function (f) { return cogDraw(base + cand.c.p + f + '.tiff', ctx, x - size / 2, y + size / 2, size, n).catch(function () { }); }));
    // does the photo actually cover the point? (scanned photos have transparent margins)
    var k = Math.max(4, Math.round(n / 45)), px = ctx.getImageData(Math.round(n / 2 - k), Math.round(n / 2 - k), 2 * k, 2 * k).data, covered = false;
    for (var i = 3; i < px.length; i += 4) if (px[i] > 0) { covered = true; break; }
    if (!covered) return false;
    // crosshair and scale bar
    var c = n / 2; ctx.lineWidth = Math.max(2, n / 180);
    ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.arc(c, c, n * 0.035, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(178,63,42,.95)'; ctx.lineWidth = Math.max(1.2, n / 300); ctx.beginPath(); ctx.arc(c, c, n * 0.035, 0, 7); ctx.stroke();
    var bar = 100 / size * n; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(n * 0.04 - 4, n * 0.92 - 14, bar + 8, 22);
    ctx.fillStyle = '#fff'; ctx.fillRect(n * 0.04, n * 0.92, bar, Math.max(3, n / 150));
    ctx.font = Math.round(n / 26) + 'px "JetBrains Mono", monospace'; ctx.fillText('100 m', n * 0.04, n * 0.92 - 3);
    return true;
  }

  // ---------- other data ----------
  function loadHist() { return once('hist', function () { return getJSON('data/lcdb_hist.json'); }); }
  function loadFeatures() { return once('feat', function () { return getJSON('data/features.json'); }); }
  function loadModel() {
    return once('model', function () {
      return fetch('data/model.bin').then(function (r) { return r.arrayBuffer(); }).then(inflate).then(function (u8) {
        var dv = new DataView(u8.buffer), hl = dv.getUint32(0, true), h = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + hl)));
        h.data = u8.subarray(4 + hl); return h;
      });
    });
  }
  function loadSurveys() { return once('surveys', function () { return getJSON('data/foot_surveys.json'); }); }
  function footCell(x, y) {
    var cx = Math.floor((x - E0) / 1000), cy = Math.floor((N1 - y) / 1000), bx = Math.floor(cx / 32), by = Math.floor(cy / 32);
    return once('foot' + bx + '_' + by, function () { return getJSON('data/foot/' + bx + '_' + by + '.json').catch(function () { return null; }); })
      .then(function (B) { if (!B) return []; var k = B.c[(cy - by * 32) * 32 + (cx - bx * 32)]; return k ? B.l[k - 1] : []; });
  }

  // ---------- geometry ----------
  function ringsOf(g) { return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
  function inRing(x, y, r) { var c = false; for (var i = 0, j = r.length - 1; i < r.length; j = i++) { var a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
  function segDist(x, y, a, b) { var dx = b[0] - a[0], dy = b[1] - a[1], t = ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1); t = Math.max(0, Math.min(1, t)); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); }
  function featDist(f, x, y) {
    var g = f.g;
    if (g.type === 'Point') return Math.hypot(x - g.coordinates[0], y - g.coordinates[1]);
    var polys = ringsOf(g), d = Infinity;
    for (var p = 0; p < polys.length; p++) {
      var rings = polys[p], inside = inRing(x, y, rings[0]);
      for (var h = 1; h < rings.length && inside; h++) if (inRing(x, y, rings[h])) inside = false;
      if (inside) return 0;
      for (var r = 0; r < rings.length; r++) for (var i = 1; i < rings[r].length; i++) d = Math.min(d, segDist(x, y, rings[r][i - 1], rings[r][i]));
    }
    return d;
  }

  // ---------- map ----------
  var map = L.map('map', { zoomControl: true, worldCopyJump: false }).setView([-41.0, 173.5], 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  var marker = null, rings = L.layerGroup().addTo(map), featLayer = L.layerGroup();
  var FEAT_STYLE = { landfill: { color: '#a3471f', label: 'Landfill' }, quarry: { color: '#7a5c2e', label: 'Quarry' }, mine: { color: '#5b2a6e', label: 'Mine' }, mine_pt: { color: '#5b2a6e', label: 'Mine' } };
  function featLabel(k, f) { return FEAT_STYLE[k].label + (f.n ? ': ' + f.n : '') + (f.u ? ' (' + f.u + (f.s ? ', ' + f.s : '') + ')' : f.s ? ' (' + f.s + ')' : ''); }
  loadFeatures().then(function (F) {
    Object.keys(F).forEach(function (k) {
      F[k].forEach(function (f) {
        var st = FEAT_STYLE[k], lyr;
        if (f.g.type === 'Point') { var ll = toLL(f.g.coordinates[0], f.g.coordinates[1]); lyr = L.circleMarker([ll[1], ll[0]], { radius: 5, color: st.color, weight: 2, fillOpacity: 0.5 }); }
        else lyr = L.polygon(ringsOf(f.g).map(function (p) { return p.map(function (r) { return r.map(function (c) { var ll = toLL(c[0], c[1]); return [ll[1], ll[0]]; }); }); }), { color: st.color, weight: 2, fillOpacity: 0.18 });
        lyr.bindTooltip(esc(featLabel(k, f)), { className: 'feat' }); featLayer.addLayer(lyr);
      });
    });
    if ($('featOn').checked) featLayer.addTo(map);
  }).catch(function () { });
  $('featOn').addEventListener('change', function () { if (this.checked) featLayer.addTo(map); else map.removeLayer(featLayer); });

  // LCDB overlay: each map tile is filled by mapping its pixels into NZTM (affine per tile)
  var LcdbLayer = L.GridLayer.extend({
    createTile: function (coords, done) {
      var tile = document.createElement('canvas'), sz = this.getTileSize(); tile.width = sz.x; tile.height = sz.y;
      if (coords.z < 12) { setTimeout(function () { done(null, tile); }, 0); return tile; }
      var m = this._map, p0 = coords.scaleBy(sz);
      var cn = function (dx, dy) { var ll = m.unproject(p0.add([dx, dy]), coords.z); return toNZTM(ll.lng, ll.lat); };
      var A = cn(0, 0), B = cn(sz.x, 0), Cc = cn(0, sz.y), D = cn(sz.x, sz.y), ep = +$('lcdbYear').value;
      var xs = [A[0], B[0], Cc[0], D[0]], ys = [A[1], B[1], Cc[1], D[1]];
      var t0 = tileOf(Math.min.apply(null, xs), Math.max.apply(null, ys)), t1 = tileOf(Math.max.apply(null, xs), Math.min.apply(null, ys)), jobs = [], tiles = {};
      for (var tx = t0[0]; tx <= t1[0]; tx++) for (var ty = t0[1]; ty <= t1[1]; ty++) (function (tx, ty) { jobs.push(lcdbTile(tx, ty).then(function (T) { tiles[tx + '_' + ty] = T; })); })(tx, ty);
      Promise.all(jobs.concat([loadHist()])).then(function (r) {
        var hist = r[r.length - 1], ctx = tile.getContext('2d'), im = ctx.createImageData(sz.x, sz.y), d = im.data, cache = {};
        for (var py = 0; py < sz.y; py++) for (var px = 0; px < sz.x; px++) {
          var u = (px + 0.5) / sz.x, v = (py + 0.5) / sz.y;
          var x = A[0] + u * (B[0] - A[0]) + v * (Cc[0] - A[0]), y = A[1] + u * (B[1] - A[1]) + v * (Cc[1] - A[1]);
          var h = histAtSync(tiles, x, y); if (!h) continue;
          var code = hist[h - 1][ep], col = cache[code] || (cache[code] = hexRGB((LCDB[code] || ['', '#888888'])[1])), o = (py * sz.x + px) * 4;
          d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = code === 0 ? 0 : 200;
        }
        ctx.putImageData(im, 0, 0); done(null, tile);
      }).catch(function (e) { done(e, tile); });
      return tile;
    }
  });
  function hexRGB(h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
  var lcdbLayer = new LcdbLayer({ opacity: 0.7, minZoom: 12, maxNativeZoom: 18 });
  $('lcdbOn').addEventListener('change', function () { if (this.checked) { lcdbLayer.addTo(map); if (map.getZoom() < 12 && cur) map.setView([cur.lat, cur.lon], 15); } else map.removeLayer(lcdbLayer); });
  $('lcdbYear').addEventListener('change', function () { if (map.hasLayer(lcdbLayer)) lcdbLayer.redraw(); });

  map.on('click', function (e) { choose(e.latlng.lat, e.latlng.lng, null, false); });

  // ---------- search ----------
  function parseCoords(q) {
    var m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    var a = +m[1], b = +m[2];
    if (a < -33 && a > -48 && b > 165 && b < 179) return [a, b];
    if (b < -33 && b > -48 && a > 165 && a < 179) return [b, a];
    if (a > 1000000 && a < 2200000 && b > 4700000 && b < 6300000) { var ll = toLL(a, b); return [ll[1], ll[0]]; }
    return null;
  }
  $('search').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('q').value.trim(), res = $('results'); if (!q) return;
    var c = parseCoords(q); if (c) { res.hidden = true; choose(c[0], c[1], null, true); return; }
    res.hidden = false; res.innerHTML = '<li><button type="button" disabled>Searching…</button></li>';
    fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=nz&limit=6&q=' + encodeURIComponent(q), { headers: { 'Accept-Language': 'en' } })
      .then(function (r) { return r.json(); }).then(function (list) {
        if (!list.length) { res.innerHTML = '<li><button type="button" disabled>No match in New Zealand. Try adding the suburb or town, or click the map.</button></li>'; return; }
        if (list.length === 1) { res.hidden = true; choose(+list[0].lat, +list[0].lon, list[0].display_name, true); return; }
        res.innerHTML = list.map(function (p, i) { return '<li><button type="button" data-i="' + i + '">' + esc(p.display_name) + '</button></li>'; }).join('');
        Array.prototype.forEach.call(res.querySelectorAll('button[data-i]'), function (b) { b.addEventListener('click', function () { var p = list[+b.dataset.i]; res.hidden = true; choose(+p.lat, +p.lon, p.display_name, true); }); });
      }).catch(function () { res.innerHTML = '<li><button type="button" disabled>Address search is unavailable right now. Enter coordinates or click the map.</button></li>'; });
  });
  $('locate').addEventListener('click', function () {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (p) { choose(p.coords.latitude, p.coords.longitude, 'Your location', true); }, function () { alert('Your location is not available.'); }, { enableHighAccuracy: true, timeout: 10000 });
  });

  // ---------- report ----------
  var cur = null, runId = 0;
  function choose(lat, lon, label, fly) {
    $('results').hidden = true;
    var xy = toNZTM(lon, lat);
    cur = { lat: lat, lon: lon, x: xy[0], y: xy[1], label: label };
    if (marker) marker.setLatLng([lat, lon]); else marker = L.marker([lat, lon], { draggable: true, keyboard: false }).addTo(map).on('dragend', function () { var p = marker.getLatLng(); choose(p.lat, p.lng, null, false); });
    rings.clearLayers();
    [250, 500].forEach(function (r) { rings.addLayer(L.circle([lat, lon], { radius: r, color: '#b23f2a', weight: 1, dashArray: '4 4', fill: false, interactive: false })); });
    if (fly) map.setView([lat, lon], Math.max(map.getZoom(), 15));
    history.replaceState(null, '', '#' + lat.toFixed(5) + ',' + lon.toFixed(5));
    buildReport(++runId);
  }

  async function buildReport(id) {
    var P = cur, rep = $('report');
    var inNZ = P.x > 1000000 && P.x < 2150000 && P.y > 4700000 && P.y < 6250000;
    rep.innerHTML = placeHTML(P) + '<p class="loadline" id="loadline">Gathering data…</p>';
    wireActions();
    if (!inNZ) { $('loadline').textContent = 'This point is outside mainland New Zealand, so there is no data for it.'; return; }
    var tiles, hist, model, F;
    try {
      var r = await Promise.all([tilesAround(P.x, P.y, 1000), loadHist(), loadModel(), loadFeatures()]);
      tiles = r[0]; hist = r[1]; model = r[2]; F = r[3];
    } catch (e) { if (id === runId) $('loadline').textContent = 'Could not load the data (' + e.message + '). Please try again.'; return; }
    if (id !== runId) return;

    // LCDB at the point (allow one pixel of slack if the point falls on "not land" edge)
    var h = histAtSync(tiles, P.x, P.y), at = h ? hist[h - 1] : null;
    var near = nearStats(tiles, hist, P.x, P.y);
    // model 1 km cell
    var mx = Math.floor((P.lon - model.LON0) * model.K / model.CELL), my = Math.floor((model.LATTOP - P.lat) * model.KY / model.CELL), WH = model.W * model.H;
    var mod = null;
    if (mx >= 0 && my >= 0 && mx < model.W && my < model.H && model.data[my * model.W + mx] !== 255) {
      mod = { years: model.years, cls: model.years.map(function (y, k) { return model.data[k * WH + my * model.W + mx]; }), clear: model.data[model.years.length * WH + my * model.W + mx] };
    }
    // Topo50 features within 2 km
    var feats = [];
    Object.keys(F).forEach(function (k) { F[k].forEach(function (f) { var d = featDist(f, P.x, P.y); if (d <= 2000) feats.push({ k: k, f: f, d: d }); }); });
    feats.sort(function (a, b) { return a.d - b.d; });

    if (!at && !mod) { $('loadline').textContent = 'No land-cover data at this point. It may be at sea or on an offshore island.'; return; }
    var flags = buildFlags(at, near, feats, mod);
    rep.innerHTML = placeHTML(P) + flagsHTML(flags) + photosShell() + timelineHTML(at, mod) + nearHTML(near, feats) + stepsHTML() + aboutHTML();
    wireActions();
    fillPhotos(id, P);
  }

  function placeHTML(P) {
    var ll = Math.abs(P.lat).toFixed(5) + '° S, ' + P.lon.toFixed(5) + '° E', nz = 'NZTM ' + Math.round(P.x) + ' E, ' + Math.round(P.y) + ' N';
    return '<section class="place"><div><div class="addr">' + esc(P.label || 'Selected location') + '</div><div class="coords">' + ll + ' · ' + nz + '</div>' +
      '<div class="coords">Report generated ' + new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }) + '</div></div>' +
      '<div class="acts"><button class="btn ghost" type="button" id="share">Copy link</button><button class="btn" type="button" id="print">Print or save PDF</button></div></section>';
  }
  function wireActions() {
    var s = $('share'), p = $('print');
    if (s) s.onclick = function () { var u = location.href; (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { s.textContent = 'Link copied'; setTimeout(function () { s.textContent = 'Copy link'; }, 1600); }, function () { prompt('Copy this link', u); }); };
    if (p) p.onclick = function () { window.print(); };
  }

  // land cover within 100/250/500/1000 m, per epoch, and nearest distance to classes of interest
  function nearStats(tiles, hist, x, y) {
    var R = [100, 250, 500], counts = R.map(function () { return LY.map(function () { return {}; }); }), tot = R.map(function () { return 0; });
    var nearest = {}, KEY = [1, 2, 5, 6, 30, 33];
    for (var dy = -1000; dy <= 1000; dy += RES) for (var dx = -1000; dx <= 1000; dx += RES) {
      var d = Math.hypot(dx, dy); if (d > 1000) continue;
      var h = histAtSync(tiles, x + dx, y + dy); if (!h) continue;
      var H = hist[h - 1];
      for (var r = 0; r < R.length; r++) if (d <= R[r]) { tot[r]++; for (var e = 0; e < 6; e++) counts[r][e][H[e]] = (counts[r][e][H[e]] || 0) + 1; }
      for (e = 0; e < 6; e++) if (KEY.indexOf(H[e]) >= 0) { var n = nearest[H[e]] || (nearest[H[e]] = { d: Infinity, years: [] }); if (d < n.d) n.d = d; if (n.years.indexOf(LY[e]) < 0) n.years.push(LY[e]); }
    }
    Object.keys(nearest).forEach(function (k) { nearest[k].years.sort(); });
    return { R: R, counts: counts, tot: tot, nearest: nearest };
  }

  function buildFlags(at, near, feats, mod) {
    var F = [];
    function yearsWith(c) { return at ? LY.filter(function (y, e) { return at[e] === c; }) : []; }
    var last = at ? at[5] : null;
    var dump = yearsWith(6);
    if (dump.length) F.push({ l: 'hi', w: 'here', t: 'Mapped as a surface mine or dump', x: 'LCDB maps this spot as a surface mine or dump in ' + yearsText(dump) + '.' +
      (last !== 6 ? ' By ' + season(2023) + ' it is mapped as ' + LCDB[last][0].toLowerCase() + ', so the land use has changed since.' : ''), h: ['E7', 'G3', 'G5'] });
    feats.forEach(function (o) {
      var lab = featLabel(o.k, o.f);
      if (o.k === 'landfill') F.push(o.d === 0 ? { l: 'hi', w: 'here', t: 'Inside a mapped landfill', x: 'LINZ topographic maps show a landfill here (' + esc(lab) + ').', h: ['G3'] }
        : o.d <= 500 ? { l: 'md', w: 'near', t: 'Mapped landfill ' + fmtDist(o.d) + ' away', x: esc(lab) + ' (LINZ Topo50).', h: ['G3', 'H'] } : null);
      if (o.k === 'mine' || o.k === 'mine_pt') F.push(o.d <= 30 ? { l: 'hi', w: 'here', t: 'At a mapped mine', x: esc(lab) + ' (LINZ Topo50).', h: ['E7'] }
        : o.d <= 500 ? { l: 'md', w: 'near', t: 'Mapped mine ' + fmtDist(o.d) + ' away', x: esc(lab) + ' (LINZ Topo50).', h: ['E7', 'H'] } : null);
      if (o.k === 'quarry') F.push(o.d === 0 ? { l: 'md', w: 'here', t: 'Inside a mapped quarry', x: esc(lab) + '. Gravel extraction is excluded from the HAIL, but other quarrying is not, and old quarries are sometimes filled with waste.', h: ['E7', 'G5'] }
        : o.d <= 250 ? { l: 'lo', w: 'near', t: 'Mapped quarry ' + fmtDist(o.d) + ' away', x: esc(lab) + ' (LINZ Topo50).', h: [] } : null);
    });
    var nd = near.nearest[6];
    if (!dump.length && nd && nd.d <= 250) F.push({ l: 'md', w: 'near', t: 'Surface mine or dump about ' + fmtDist(Math.max(25, nd.d)) + ' away', x: 'LCDB maps a surface mine or dump within ' + fmtDist(Math.max(25, nd.d)) + ' of this spot in ' + yearsText(nd.years) + '.', h: ['E7', 'G3', 'H'] });
    var orch = yearsWith(33);
    if (orch.length) F.push({ l: 'md', w: 'here', t: 'Orchard, vineyard or perennial crop', x: 'LCDB maps this spot as an orchard, vineyard or other perennial crop in ' + yearsText(orch) + '. Older orchards often used persistent pesticides; orchards before 1996 are not in LCDB, so check the aerial photos below.', h: ['A10'] });
    else if (near.nearest[33] && near.nearest[33].d <= 100) F.push({ l: 'lo', w: 'near', t: 'Orchard or vineyard next door', x: 'LCDB maps an orchard, vineyard or perennial crop within ' + fmtDist(Math.max(25, near.nearest[33].d)) + ' in ' + yearsText(near.nearest[33].years) + '.', h: ['A10'] });
    var crop = yearsWith(30);
    if (crop.length) F.push({ l: 'lo', w: 'here', t: 'Short-rotation cropping', x: 'LCDB maps cropping here in ' + yearsText(crop) + '. Market gardens are on the HAIL; most arable cropping is not.', h: ['A10'] });
    var tr = yearsWith(5);
    if (tr.length) F.push({ l: 'lo', w: 'here', t: 'Transport infrastructure', x: 'LCDB maps transport land here in ' + yearsText(tr) + '. Airports, railway yards and transport depots are on the HAIL; roads generally are not.', h: ['F1', 'F6', 'F8'] });
    var park = yearsWith(2);
    if (park.length) F.push({ l: 'lo', w: 'here', t: 'Urban parkland or open space', x: 'LCDB maps parkland or open space here in ' + yearsText(park) + '. Sports turf can involve persistent pesticides, and some parks and reserves were built on former tips; the aerial photos below can help.', h: ['A10'] });
    var built = yearsWith(1);
    if (built.length) F.push({ l: 'lo', w: 'here', t: 'Built-up area: house age and lead paint', x: 'LCDB maps this spot as built-up in ' + yearsText(built) + '. Ministry of Health advice is that if a house was built or repainted before about 1970, the paintwork should be assumed lead-based unless tested; flaking paint can raise lead in garden soil near buildings. Small commercial or industrial uses (service stations, workshops, dry cleaners) are not visible in national land-cover maps.', h: ['A5', 'F4', 'F7'] });
    var farmDecades = mod ? mod.cls.filter(function (c, k) { return mod.years[k] <= 1990 && (c === 6 || c === 7 || c === 9); }).length : 0;
    var farm = (at && at.some(function (c) { return c === 40 || c === 41 || c === 30; })) || (farmDecades >= 3 && !(at && at[0] === 1));
    if (farm) F.push({ l: 'lo', w: 'info', t: 'Farmland history', x: 'This area has been farmed (LCDB grassland or cropland' + (mod ? ', or modelled farmland' : '') + '). Sheep dip and spray race sites were common on New Zealand farms, and older ones used arsenic and organochlorine chemicals. They are small and not mapped nationally.', h: ['A8'] });
    var order = { hi: 0, md: 1, lo: 2 }, wo = { here: 0, near: 1, info: 2 };
    return F.filter(Boolean).sort(function (a, b) { return order[a.l] - order[b.l] || wo[a.w] - wo[b.w]; });
  }
  function flagsHTML(F) {
    var LV = { here: 'Recorded at this location', near: 'Recorded nearby', info: 'Worth knowing' };
    var body = F.length ? '<ul class="flags">' + F.map(function (f) {
      return '<li class="flag ' + f.l + '"><div class="lvl">' + LV[f.w] + '</div><b>' + esc(f.t) + '.</b> ' + f.x +
        (f.h.length ? '<div class="hail">HAIL: ' + f.h.map(function (k) { return esc(HAIL[k]); }).join(' · ') + '</div>' : '') + '</li>';
    }).join('') + '</ul>' : '<p>None of these national datasets records a past use from the Hazardous Activities and Industries List at or near this point. That does not rule one out: most small sites, such as service stations, workshops, sheep dips and pre-1996 orchards, are not mapped nationally.</p>';
    return '<section><h2>Worth a closer look</h2>' + body +
      '<p class="note">The Hazardous Activities and Industries List (HAIL, Ministry for the Environment, October 2011) lists land uses that can leave contaminants in soil. A past HAIL use does not mean land is contaminated, and contamination can occur where no use is recorded. Only soil testing can tell.</p></section>';
  }

  function photosShell() {
    return '<section id="photos"><h2>Aerial photos through time</h2><p class="loadline" id="photoStatus">Finding historical aerial photos…</p><div class="chips" id="chips"></div>' +
      '<div id="more"></div><h3>Unrectified photos in the Crown Aerial Film Library</h3><div class="surveys" id="surveys"><span class="loadline">Looking up survey footprints…</span></div>' +
      '<p class="note">Orthorectified photos are read directly from LINZ’s open imagery archive; each shows about 400 m around the point (red circle). Many more unrectified photos, back to 1936, can be viewed and downloaded on <a href="https://retrolens.co.nz/" target="_blank" rel="noopener">Retrolens</a> by searching for this location or survey number.</p></section>';
  }
  var SIZE = 400, LB_SIZE = 700;
  async function fillPhotos(id, P) {
    var img;
    try { img = await loadImagery(); } catch (e) { $('photoStatus').textContent = 'The imagery index could not be loaded.'; return; }
    if (id !== runId) return;
    var cands = imageryAt(img, P.x, P.y, SIZE / 2);
    // one chip per decade: finest photo set that actually covers the point; the others on request
    var byDec = {};
    cands.forEach(function (c) { var d = Math.floor(c.c.y0 / 10) * 10; (byDec[d] = byDec[d] || []).push(c); });
    var decs = Object.keys(byDec).sort().map(function (d) { return byDec[d].sort(function (a, b) { return a.c.g - b.c.g || b.c.h - a.c.h; }); });
    var status = $('photoStatus'), chips = $('chips'), rest = [], shown = 0;
    status.textContent = cands.length ? 'Loading photos from ' + cands.length + ' photo set' + (cands.length > 1 ? 's' : '') + ' that cover this area…' : 'No orthorectified aerial photos from LINZ’s archive cover this point yet. See the survey list below and Retrolens.';
    async function tryChip(list) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'chip';
      b.innerHTML = '<canvas width="360" height="360"></canvas><div class="cap"><b>…</b><span>&nbsp;</span></div>';
      chips.appendChild(b);
      for (var i = 0; i < list.length && id === runId; i++) {
        var c = list[i], yr = c.c.y0 === c.c.y1 ? String(c.c.y0) : c.c.y0 + '–' + c.c.y1, sn = (c.c.t.match(/SN\s?\w+/) || [''])[0];
        b.querySelector('.cap').innerHTML = '<b>' + yr + '</b><span>' + esc(sn ? sn + ' · ' : '') + c.c.g + ' m</span>';
        var ok = await drawPhoto(c, img.base, b.querySelector('canvas'), P.x, P.y, SIZE).catch(function () { return false; });
        if (ok) {
          b.setAttribute('aria-label', 'Aerial photo ' + yr + ', ' + c.c.t + '. Open larger.');
          b.addEventListener('click', function () { openLightbox(c, img.base, P, yr); });
          shown++; return list.slice(i + 1);
        }
      }
      b.remove(); return [];
    }
    var q = decs.slice();
    async function worker() { while (q.length && id === runId) { var left = await tryChip(q.shift()); rest = rest.concat(left); } }
    await Promise.all([worker(), worker(), worker()]);
    if (id !== runId) return;
    var yrs = [].slice.call(chips.querySelectorAll('.cap b')).map(function (e) { return e.textContent; });
    status.textContent = shown ? 'Photos from ' + shown + ' decade' + (shown > 1 ? 's' : '') + ' show this point. Select a photo to enlarge it.' : cands.length ? 'The photo sets for this area do not reach this exact point. See the survey list below and Retrolens.' : status.textContent;
    // keep chips in date order (workers finish out of order)
    [].slice.call(chips.children).sort(function (a, b) { return parseInt(a.textContent, 10) - parseInt(b.textContent, 10); }).forEach(function (e) { chips.appendChild(e); });
    if (rest.length) {
      $('more').innerHTML = '<p><button class="btn ghost noprint" type="button" id="moreBtn">Show up to ' + rest.length + ' more photo set' + (rest.length > 1 ? 's' : '') + '</button></p>';
      $('moreBtn').onclick = function () { this.parentNode.remove(); rest.sort(function (a, b) { return a.c.y0 - b.c.y0; }); q = rest.map(function (c) { return [c]; }); rest = []; worker(); worker(); worker(); };
    }
    fillSurveys(id, P);
  }
  async function fillSurveys(id, P) {
    var el = $('surveys');
    try {
      var r = await Promise.all([footCell(P.x, P.y), loadSurveys()]);
      if (id !== runId) return;
      var list = r[0].map(function (i) { return r[1][i]; }).filter(Boolean).sort(function (a, b) { return (a[1] || 0) - (b[1] || 0); });
      if (!list.length) { el.innerHTML = '<span class="muted">No photo footprints recorded for this 1 km square.</span>'; return; }
      var dec = {};
      list.forEach(function (s) { var d = s[1] ? Math.floor(s[1] / 10) * 10 + 's' : 'Undated'; (dec[d] = dec[d] || []).push(s); });
      el.innerHTML = Object.keys(dec).map(function (d) {
        return '<div><span class="dec">' + d + '</span>' + dec[d].map(function (s) { return esc((s[1] || '') + ' ' + s[0]) + (s[2] ? ' (1:' + Number(s[2]).toLocaleString('en-NZ') + ')' : ''); }).join(', ') + '</div>';
      }).join('') + '<p class="note">' + list.length + ' surveys photographed this 1 km square (footprints are approximate).</p>';
    } catch (e) { el.innerHTML = '<span class="muted">The survey footprint index could not be loaded.</span>'; }
  }
  var lbRun = 0;
  function openLightbox(c, base, P, yr) {
    var lb = $('lightbox'), cv = $('lbCanvas'), my = ++lbRun;
    lb.hidden = false; $('lbCap').textContent = yr + ' · ' + c.c.t + ' · about ' + LB_SIZE + ' m across · Toitū Te Whenua LINZ, CC BY 4.0';
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    drawPhoto(c, base, cv, P.x, P.y, LB_SIZE).then(function () { if (my !== lbRun) return; });
    $('lbClose').focus();
  }
  function closeLightbox() { $('lightbox').hidden = true; lbRun++; }
  $('lbClose').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', function (e) { if (e.target === this) closeLightbox(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('lightbox').hidden) closeLightbox(); });

  function sw(col) { return '<span class="sw" style="background:' + col + '"></span>'; }
  function timelineHTML(at, mod) {
    var rows = [];
    if (mod) {
      var spans = [];
      mod.years.forEach(function (y, k) { if (y > 1990) return; var c = mod.cls[k], L = spans[spans.length - 1]; if (L && L.c === c) L.y1 = y; else spans.push({ y0: y, y1: y, c: c }); });
      spans.forEach(function (s, i) {
        var nm = MODEL[s.c] || ['Unknown', '#999'], yr = s.y0 === s.y1 ? s.y0 + 's' : s.y0 + 's–' + s.y1 + 's';
        rows.push('<tr' + (i ? ' class="chg"' : '') + '><td class="yr">' + yr + '</td><td class="cls">' + sw(nm[1]) + esc(nm[0]) + '</td><td class="src">Modelled · 1 km</td></tr>');
      });
    }
    if (at) {
      var sp = [];
      LY.forEach(function (y, e) { var c = at[e], L = sp[sp.length - 1]; if (L && L.c === c) L.y1 = y; else sp.push({ y0: y, y1: y, c: c }); });
      sp.forEach(function (s, i) {
        var nm = LCDB[s.c] || ['Unknown', '#999'], yr = s.y0 === s.y1 ? season(s.y0) : season(s.y0) + '–' + season(s.y1);
        rows.push('<tr class="obs' + (i ? ' chg' : '') + '"><td class="yr">' + yr + '</td><td class="cls">' + sw(nm[1]) + esc(nm[0]) + '</td><td class="src">Observed · LCDB</td></tr>');
      });
    }
    var clear = mod && mod.clear && (mod.cls[0] === 1 || mod.cls[0] === 4) ? '<p class="note">The model has the native ' + (mod.cls[0] === 1 ? 'forest' : 'wetland') + ' in this 1 km square cleared around ' + (1800 + mod.clear) + '. ' : '<p class="note">';
    return '<section><h2>Land use decade by decade</h2><div class="tblwrap"><table class="tl"><thead><tr><th>When</th><th>Land use or cover</th><th>Source</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' +
      clear + 'Rows before 1996 come from a cellular-automaton reconstruction of the 1 km square around this point (low confidence: it shows the likely sequence for the area, not this property). From 1996 they are the Land Cover Database class mapped at this point, with a minimum mapping unit of about 1 ha. Compare with the aerial photos above.</p></section>';
  }
  function nearHTML(near, feats) {
    var R = 1, tot = near.tot[R] || 1, rows = [];
    var codes = {}; [0, 5].forEach(function (e) { Object.keys(near.counts[R][e]).forEach(function (c) { codes[c] = 1; }); });
    Object.keys(codes).map(Number).filter(function (c) { return c !== 0; }).map(function (c) {
      return { c: c, a: (near.counts[R][0][c] || 0) / tot * 100, b: (near.counts[R][5][c] || 0) / tot * 100 };
    }).filter(function (o) { return o.a >= 1 || o.b >= 1 || [6, 33].indexOf(o.c) >= 0; }).sort(function (p, q) { return q.b - p.b || q.a - p.a; }).forEach(function (o) {
      rows.push('<tr><td>' + sw(LCDB[o.c][1]) + esc(LCDB[o.c][0]) + '</td><td class="n">' + o.a.toFixed(0) + '%</td><td class="n">' + o.b.toFixed(0) + '%</td></tr>');
    });
    var ft = feats.filter(function (o) { return o.d <= 2000; }).slice(0, 12).map(function (o) {
      return '<tr><td>' + esc(featLabel(o.k, o.f)) + '</td><td class="n">' + (o.d === 0 ? 'here' : fmtDist(o.d)) + '</td></tr>';
    });
    return '<section><h2>Around this point</h2><h3>Land cover within 250 m (LCDB)</h3>' +
      (rows.length ? '<div class="tblwrap"><table class="near"><thead><tr><th>Class</th><th class="n">' + season(1996) + '</th><th class="n">' + season(2023) + '</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>' : '<p class="muted">No LCDB land cover within 250 m.</p>') +
      '<h3>Mapped landfills, quarries and mines within 2 km (LINZ Topo50)</h3>' +
      (ft.length ? '<div class="tblwrap"><table class="near"><tbody>' + ft.join('') + '</tbody></table></div>' : '<p class="muted">None mapped within 2 km. Topo50 shows only larger, named features; many closed tips are not on it.</p>') + '</section>';
  }
  function stepsHTML() {
    return '<section><h2>Next steps</h2><ul class="steps">' +
      '<li>Look through the aerial photos above, and on <a href="https://retrolens.co.nz/" target="_blank" rel="noopener">Retrolens</a> for other dates, for signs of earlier uses: sheds, tanks, fill, pits or bare ground.</li>' +
      '<li>Ask the district or city council for a Land Information Memorandum (LIM). It includes information the council holds about past hazardous activities on the property.</li>' +
      '<li>Ask the regional council whether the site is on its register of HAIL or potentially contaminated sites (names vary, for example Selected or Listed Land Use Register).</li>' +
      '<li>Read the <a href="https://environment.govt.nz/facts-and-science/land/contaminated-land/" target="_blank" rel="noopener">Ministry for the Environment guidance on contaminated land</a>, including the HAIL and the national standard for assessing contaminants in soil.</li>' +
      '<li>If soil quality matters, for example for food growing or children’s play, have the soil tested.</li></ul></section>';
  }
  function aboutHTML() {
    return '<section class="about"><h2>About this report</h2>' +
      '<p>It combines open national datasets and a model, each with limits. Land cover from 1996 is the <a href="https://lris.scinfo.org.nz/layer/123148-lcdb-v60-land-cover-database-version-60-mainland-new-zealand/" target="_blank" rel="noopener">Land Cover Database v6.0</a> (Manaaki Whenua – Landcare Research, CC BY 4.0), mapped at about 1:50,000 and summarised here at 25 m. Aerial photos come from <a href="https://registry.opendata.aws/nz-imagery/" target="_blank" rel="noopener">LINZ’s open imagery archive</a> and the photo footprints from the <a href="https://data.linz.govt.nz/layer/51002-nz-aerial-photo-footprints-mainland-nz-1936-2008-polygons/" target="_blank" rel="noopener">Crown Aerial Film Library</a> (Toitū Te Whenua LINZ, CC BY 4.0). Landfills, quarries and mines are LINZ Topo50 features (CC BY 4.0). Years before 1996 come from the <a href="../" target="_blank" rel="noopener">land-use model</a> in this project, which reconstructs plausible patterns at 1 km, not property histories.</p>' +
      '<p>Everything runs in your browser. Addresses you search are sent to <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noopener">OpenStreetMap Nominatim</a> to find coordinates; the map uses OpenStreetMap tiles. This site stores nothing. The shareable link contains only the coordinates.</p>' +
      '<p class="muted">A prototype from the University of Auckland Centre for eResearch. It is not a substitute for a preliminary site investigation by a suitably qualified practitioner.</p></section>';
  }

  // ---------- start ----------
  var m = location.hash.match(/^#(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) choose(+m[1], +m[2], null, true);
  window.NZReport = { choose: choose, tileId: tileId };
})();
