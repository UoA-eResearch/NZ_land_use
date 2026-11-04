/* Aotearoa land-use cellular automaton, 1840–2025.
   Demand-constrained CA: national class totals follow keyframe curves,
   the CA decides WHERE change happens (suitability + neighbourhood + access + noise). */
var NZModel = (function () {
  'use strict';
  var C = { SEA: 0, NAT: 1, SCRUB: 2, TUSS: 3, WET: 4, ALP: 5, SHEEP: 6, DAIRY: 7, PINE: 8, CROP: 9, URB: 10, LAKE: 11 };
  var Y0 = 1840, Y1 = 2025;

  // ---------- helpers ----------
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hash2(x, y, s) { var h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y, s) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, s) { var t = 0, amp = 0.5, f = 1; for (var o = 0; o < 4; o++) { t += amp * (vnoise(x * f, y * f, s + o) - 0.5); amp *= 0.5; f *= 2.1; } return t; }
  function sstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function interp(keys, year) { // keys: [[year,value],...]
    if (year <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) if (year <= keys[i][0]) { var a = keys[i - 1], b = keys[i]; return a[1] + (b[1] - a[1]) * (year - a[0]) / (b[0] - a[0]); }
    return keys[keys.length - 1][1];
  }

  // ---------- geography inputs (approximate, hand-placed) ----------
  // ridges: [peak m, width km, [lon,lat]...]
  var RIDGES = [
    [2300, 22, [168.25, -44.55], [168.9, -44.1], [169.6, -43.8], [170.15, -43.6], [170.7, -43.3], [171.4, -42.95], [172.1, -42.55], [172.7, -42.1], [173.1, -41.7]],
    [3400, 9, [170.0, -43.7], [170.25, -43.5]],
    [2000, 16, [170.45, -43.75], [170.9, -43.45], [171.3, -43.25]],
    [1500, 14, [171.35, -43.35], [171.9, -43.0], [172.4, -42.75], [172.8, -42.6]],
    [2200, 13, [172.95, -42.45], [173.5, -42.15], [173.95, -41.85]],
    [1600, 14, [172.95, -41.75], [173.35, -41.5], [173.7, -41.35]],
    [1600, 22, [172.3, -40.9], [172.55, -41.3], [172.4, -41.65], [172.15, -41.95]],
    [1200, 9, [171.4, -42.0], [171.55, -42.35]],
    [1600, 26, [167.15, -46.0], [167.5, -45.5], [167.95, -45.0], [168.3, -44.6]],
    [1300, 18, [166.9, -45.7], [167.35, -45.15]],
    [1500, 14, [168.05, -45.75], [168.35, -45.35]],
    [1700, 30, [168.9, -44.55], [169.3, -44.9], [169.55, -45.3]],
    [1500, 28, [169.7, -44.75], [170.2, -44.95]],
    [1300, 25, [169.0, -45.2], [169.6, -45.6], [170.0, -45.6]],
    [1600, 20, [168.6, -45.0], [168.85, -44.75]],
    [650, 20, [169.0, -46.45], [169.5, -46.4]],
    [500, 12, [168.6, -46.05], [168.9, -45.95]],
    [850, 11, [172.8, -43.75], [173.0, -43.78]],
    [600, 10, [170.4, -45.85], [170.7, -45.82]],
    [850, 14, [167.8, -46.95], [168.05, -47.05]],
    // North Island
    [1450, 13, [175.05, -41.35], [175.35, -40.9], [175.55, -40.6]],
    [1600, 12, [175.7, -40.25], [176.0, -39.9], [176.25, -39.55]],
    [1600, 18, [176.05, -39.45], [176.35, -39.15], [176.5, -38.9]],
    [1250, 20, [176.65, -38.95], [177.0, -38.65], [177.25, -38.35]],
    [1500, 15, [177.6, -38.1], [177.9, -37.75], [178.05, -37.55]],
    [650, 30, [177.0, -39.05], [177.6, -38.6], [178.1, -38.3]],
    [500, 18, [176.0, -40.85], [176.4, -40.35], [176.65, -40.0]],
    [550, 38, [174.9, -39.4], [175.1, -39.8]],
    [700, 30, [175.3, -38.5], [175.45, -38.85]],
    [800, 8, [175.5, -37.2], [175.65, -36.85], [175.8, -36.55]],
    [850, 7, [175.75, -37.95], [175.9, -37.6]],
    [600, 9, [175.15, -37.05], [175.25, -37.15]],
    [420, 7, [174.5, -36.85], [174.55, -37.0]],
    [550, 22, [173.4, -35.4], [173.75, -35.65]],
    [450, 18, [174.0, -35.2], [174.25, -35.6]],
    [300, 15, [174.4, -36.2], [174.6, -36.5]]
  ];
  // blobs: [lon,lat,height,width km,shape exponent]
  var BLOBS = [
    [175.75, -38.95, 750, 55, 4], [176.5, -38.45, 450, 40, 4], [176.25, -38.15, 350, 25, 4],
    [175.57, -39.28, 2050, 9, 2], [175.65, -39.14, 1400, 7, 2], [174.06, -39.30, 2200, 9, 2], [174.15, -39.3, 250, 25, 3],
    [170.25, -44.1, 650, 40, 4], [169.4, -45.15, 250, 30, 4]
  ];
  // lakes: [lon,lat,rx km,ry km]
  var LAKES = [[175.9, -38.8, 14, 11], [176.27, -38.08, 5, 5], [168.66, -45.08, 3, 3], [168.52, -45.3, 3, 4], [168.75, -44.98, 4, 2.5], [167.7, -45.2, 4, 11], [167.6, -45.5, 4, 4],
    [169.12, -44.6, 3, 9], [169.27, -44.55, 3, 8], [170.17, -44.1, 3, 8], [170.52, -43.95, 3, 7], [172.3, -43.8, 9, 4], [176.4, -39.35, 0, 0]];
  var WETZONES = [[175.55, -37.25, 18], [175.3, -37.55, 18], [175.3, -37.85, 14], [173.3, -35.05, 12], [175.3, -40.45, 18], [168.5, -46.25, 18], [168.95, -46.35, 12],
    [176.85, -37.95, 14], [176.85, -39.55, 10], [174.2, -36.25, 12], [171.3, -42.6, 15], [170.6, -43.1, 12], [172.45, -43.65, 12], [172.95, -41.15, 6], [173.9, -41.48, 8]];
  // Māori population centres c.1840: [lon,lat,weight]
  var MAORI = [[174.1, -35.3, 1.2], [173.5, -35.4, 1], [173.27, -35.1, 0.9], [174.76, -36.86, 1], [175.2, -37.6, 1.1], [175.55, -37.15, 0.8], [176.17, -37.68, 1], [176.99, -37.95, 1],
    [176.25, -38.13, 0.9], [176.07, -38.69, 0.6], [178.3, -37.88, 1], [178.0, -38.66, 1], [176.9, -39.5, 0.9], [175.6, -41.2, 0.6], [174.78, -41.29, 0.6], [175.1, -40.75, 0.8],
    [175.05, -39.93, 0.8], [174.1, -39.05, 0.9], [174.3, -39.6, 0.8], [173.7, -36.1, 0.6], [177.4, -39.05, 0.6], [172.65, -43.38, 0.6], [170.6, -45.8, 0.5], [173.2, -41.28, 0.4], [173.95, -41.5, 0.4], [168.35, -46.5, 0.4]];
  // settlements: name, lon, lat, founded, pop (thousands) at 1860,1900,1950,2020
  var TOWNS = [
    ['Russell', 174.12, -35.26, 1835, [0.5, 0.3, 0.5, 1]], ['Auckland', 174.76, -36.85, 1840, [8, 67, 330, 1700]], ['Wellington', 174.78, -41.29, 1840, [4, 50, 200, 420]],
    ['Whanganui', 175.05, -39.93, 1841, [1, 7, 27, 40]], ['New Plymouth', 174.08, -39.06, 1841, [1, 4, 20, 60]], ['Nelson', 173.28, -41.27, 1842, [3, 7, 20, 70]],
    ['Dunedin', 170.5, -45.87, 1848, [2, 52, 95, 130]], ['Christchurch', 172.64, -43.53, 1850, [1, 57, 175, 390]], ['Picton', 174.0, -41.29, 1850, [0.2, 1, 2, 3]],
    ['Masterton', 175.66, -40.95, 1854, [0.2, 4, 12, 22]], ['Napier', 176.92, -39.49, 1855, [0.5, 9, 25, 65]], ['Whangārei', 174.32, -35.73, 1855, [0.1, 1, 13, 55]],
    ['Balclutha', 169.73, -46.24, 1855, [0.1, 1, 3, 4]], ['Invercargill', 168.35, -46.41, 1856, [0.5, 10, 35, 50]], ['Blenheim', 173.96, -41.51, 1857, [0.2, 3, 10, 30]],
    ['Timaru', 171.25, -44.4, 1859, [0.1, 5, 20, 30]], ['Pukekohe', 174.9, -37.2, 1859, [0, 1, 5, 30]], ['Kaikōura', 173.68, -42.4, 1859, [0, 1, 1, 2]],
    ['Oamaru', 170.97, -45.1, 1860, [0, 5, 10, 14]], ['Westport', 171.6, -41.75, 1861, [0, 3, 5, 4]], ['Gore', 168.94, -46.1, 1862, [0, 2, 7, 8]],
    ['Alexandra', 169.38, -45.25, 1862, [0, 1, 2, 6]], ['Queenstown', 168.66, -45.03, 1863, [0, 0.5, 1, 30]], ['Hokitika', 170.97, -42.72, 1864, [0, 3, 3, 3]],
    ['Hamilton', 175.28, -37.79, 1864, [0, 2, 30, 180]], ['Cambridge', 175.47, -37.89, 1864, [0, 1, 4, 20]], ['Tauranga', 176.17, -37.69, 1864, [0, 1, 10, 160]],
    ['Ashburton', 171.75, -43.9, 1864, [0, 2, 8, 20]], ['Greymouth', 171.21, -42.45, 1865, [0, 5, 9, 9]], ['Wairoa', 177.42, -39.04, 1865, [0, 1, 4, 5]],
    ['Hāwera', 174.28, -39.59, 1866, [0, 2, 6, 10]], ['Thames', 175.54, -37.14, 1867, [0, 5, 5, 7]], ['Gisborne', 178.02, -38.66, 1868, [0, 3, 18, 37]],
    ['Taupō', 176.07, -38.69, 1869, [0, 0.3, 1, 25]], ['Palmerston North', 175.61, -40.35, 1870, [0, 6, 32, 90]], ['Whakatāne', 176.99, -37.95, 1870, [0, 0.5, 5, 20]],
    ['Kaitaia', 173.27, -35.11, 1870, [0, 0.5, 3, 6]], ['Dannevirke', 176.1, -40.21, 1872, [0, 2, 5, 6]], ['Dargaville', 173.87, -35.94, 1872, [0, 1, 3, 5]],
    ['Hastings', 176.84, -39.64, 1873, [0, 4, 20, 80]], ['Feilding', 175.57, -40.23, 1874, [0, 2, 7, 17]], ['Stratford', 174.28, -39.34, 1877, [0, 1, 4, 6]],
    ['Rotorua', 176.25, -38.14, 1881, [0, 1, 13, 60]], ['Te Kūiti', 175.16, -38.33, 1885, [0, 0.5, 4, 4]], ['Levin', 175.28, -40.62, 1889, [0, 1, 5, 20]],
    ['Taumarunui', 175.26, -38.88, 1900, [0, 0.2, 5, 5]], ['Tokoroa', 175.87, -38.22, 1948, [0, 0, 1, 13]], ['Murupara', 176.7, -38.46, 1950, [0, 0, 1, 2]],
    ['Kawerau', 176.7, -38.1, 1953, [0, 0, 1, 7]], ['Te Anau', 167.72, -45.42, 1955, [0, 0, 0.2, 3]], ['Twizel', 170.1, -44.26, 1968, [0, 0, 0, 1.5]],
    ['Wānaka', 169.13, -44.7, 1863, [0, 0.1, 0.5, 12]]
  ];
  // protected forest: [lon,lat,r km,year]
  var PROTECT = [[175.6, -39.2, 18, 1887], [174.06, -39.3, 10, 1881], [177.0, -38.75, 30, 1954], [171.6, -42.95, 20, 1929], [167.4, -45.4, 70, 1904], [170.1, -43.5, 25, 1953],
    [168.7, -44.4, 35, 1964], [172.4, -41.3, 35, 1970], [171.4, -42.1, 12, 1987], [175.3, -40.85, 20, 1954], [176.0, -39.9, 22, 1976], [176.2, -39.15, 20, 1969],
    [175.6, -38.5, 15, 1978], [176.65, -38.7, 12, 1984], [173.6, -35.65, 10, 1952], [175.65, -36.9, 15, 1971], [169.4, -46.45, 15, 1958], [167.95, -47.0, 25, 1907],
    [172.8, -41.9, 20, 1956], [176.4, -39.3, 15, 1974], [177.9, -37.8, 20, 1979], [174.53, -36.95, 8, 1895], [175.2, -37.1, 8, 1905], [173.2, -41.45, 15, 1977]];
  var CROPSPOTS = [[172.0, -43.75, 55, 1855, 1.0], [176.8, -39.6, 20, 1880, 1.0], [174.9, -37.2, 12, 1870, 1.0], [176.3, -37.8, 22, 1970, 1.2], [173.8, -41.5, 16, 1980, 1.3],
    [169.3, -45.1, 25, 1900, 0.8], [173.0, -41.12, 15, 1880, 0.9], [177.9, -38.65, 12, 1900, 0.8], [170.9, -45.0, 20, 1870, 0.7], [168.6, -46.15, 25, 1880, 0.4]];
  var PINESPOTS = [[176.4, -38.45, 38, 1922, 1.35], [175.85, -38.3, 30, 1945, 1.0], [178.0, -38.3, 45, 1985, 1.0], [173.7, -35.8, 50, 1965, 0.8], [172.95, -41.35, 30, 1960, 0.8],
    [172.2, -43.4, 15, 1925, 0.8], [169.6, -46.1, 40, 1960, 0.6], [176.6, -39.4, 35, 1970, 0.7], [175.2, -39.6, 40, 1975, 0.5], [174.6, -36.45, 20, 1930, 0.8]];

  // ---------- national demand curves (% of land) ----------
  var DEM = {
    NAT: [[1840, 1], [1860, 0.96], [1880, 0.85], [1900, 0.70], [1920, 0.58], [1940, 0.53], [1960, 0.50], [1980, 0.48], [2000, 0.465], [2025, 0.46]], // relative to 1840
    WET: [[1840, 1], [1860, 0.95], [1880, 0.84], [1900, 0.64], [1920, 0.45], [1940, 0.32], [1960, 0.22], [1980, 0.15], [2000, 0.12], [2025, 0.10]],
    TUSS: [[1840, 1], [1860, 0.98], [1880, 0.93], [1900, 0.86], [1920, 0.8], [1940, 0.75], [1960, 0.64], [1980, 0.54], [2000, 0.48], [2025, 0.45]],
    SHEEP: [[1840, 0], [1860, 0.6], [1880, 6], [1900, 17], [1920, 25], [1940, 28], [1960, 32], [1980, 36], [1990, 35], [2000, 33], [2010, 31], [2025, 30]],
    DAIRY: [[1840, 0], [1880, 0.1], [1900, 1.0], [1920, 3.0], [1940, 4.0], [1960, 4.6], [1980, 4.4], [1990, 4.8], [2000, 5.6], [2010, 6.4], [2025, 6.5]],
    PINE: [[1840, 0], [1900, 0], [1920, 0.1], [1930, 0.6], [1940, 1.2], [1960, 1.5], [1980, 3.5], [1990, 4.8], [2000, 6.6], [2010, 6.4], [2020, 6.6], [2025, 7.0]],
    CROP: [[1840, 0.25], [1860, 0.4], [1880, 1.0], [1900, 1.4], [1920, 1.3], [1940, 1.2], [1960, 1.3], [1980, 1.6], [2000, 1.7], [2025, 1.9]],
    URB: [[1840, 0.006], [1860, 0.03], [1880, 0.07], [1900, 0.13], [1920, 0.2], [1940, 0.3], [1960, 0.45], [1980, 0.65], [2000, 0.8], [2025, 0.95]]
  };

  // ---------- static build ----------
  function build(grid) {
    var W = grid.W, H = grid.H, CELL = grid.CELL, K = grid.K, KY = grid.KY;
    var raw = typeof atob === 'function' ? atob(grid.mask) : Buffer.from(grid.mask, 'base64').toString('binary');
    var mask = new Uint8Array(W * H);
    for (var i = 0; i < W * H; i++) mask[i] = (raw.charCodeAt(i >> 3) >> (i & 7)) & 1;
    var lonOf = function (gx) { return grid.LON0 + (gx + 0.5) * CELL / K; };
    var latOf = function (gy) { return grid.LATTOP - (gy + 0.5) * CELL / KY; };
    var gxOf = function (lon) { return (lon - grid.LON0) * K / CELL - 0.5; };
    var gyOf = function (lat) { return (grid.LATTOP - lat) * KY / CELL - 0.5; };

    // distance to sea (chamfer, km)
    var dc = new Float32Array(W * H);
    for (i = 0; i < W * H; i++) dc[i] = mask[i] ? 1e9 : 0;
    var x, y, k, d, a = 1, b = 1.414;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) { k = y * W + x; d = dc[k]; if (!d) continue;
      if (x > 0) d = Math.min(d, dc[k - 1] + a); if (y > 0) { d = Math.min(d, dc[k - W] + a); if (x > 0) d = Math.min(d, dc[k - W - 1] + b); if (x < W - 1) d = Math.min(d, dc[k - W + 1] + b); } dc[k] = d; }
    for (y = H - 1; y >= 0; y--) for (x = W - 1; x >= 0; x--) { k = y * W + x; d = dc[k]; if (!d) continue;
      if (x < W - 1) d = Math.min(d, dc[k + 1] + a); if (y < H - 1) { d = Math.min(d, dc[k + W] + a); if (x < W - 1) d = Math.min(d, dc[k + W + 1] + b); if (x > 0) d = Math.min(d, dc[k + W - 1] + b); } dc[k] = d; }

    // elevation on full grid (sea = 0)
    var elev = new Float32Array(W * H);
    var segs = [];
    RIDGES.forEach(function (r) { for (var s = 2; s < r.length - 1; s++) segs.push([r[0], r[1], gxOf(r[s][0]), gyOf(r[s][1]), gxOf(r[s + 1][0]), gyOf(r[s + 1][1])]); });
    var blobs = BLOBS.map(function (bb) { return [gxOf(bb[0]), gyOf(bb[1]), bb[2], bb[3], bb[4]]; });
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      k = y * W + x; if (!mask[k]) continue;
      var e = 0;
      var wx0 = x + 5 * fbm(x / 14, y / 14, 31), wy0 = y + 5 * fbm(x / 14, y / 14, 57);
      for (var s = 0; s < segs.length; s++) {
        var g = segs[s], vx = g[4] - g[2], vy = g[5] - g[3], wx = wx0 - g[2], wy = wy0 - g[3];
        var t = clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1), ddx = wx - t * vx, ddy = wy - t * vy;
        var dk = Math.sqrt(ddx * ddx + ddy * ddy) * CELL / g[1];
        if (dk < 5) { var h = g[0] * (0.72 + 0.6 * vnoise(x / 7, y / 7, 91)) * Math.exp(-Math.pow(dk, 1.15)); if (h > e) e = h; }
      }
      for (s = 0; s < blobs.length; s++) {
        var bl = blobs[s], db = Math.hypot(wx0 - bl[0], wy0 - bl[1]) * CELL / bl[3];
        if (db < 3) { var hb = bl[2] * Math.exp(-Math.pow(db, bl[4])); e = Math.max(e, hb); }
      }
      var inland = Math.min(1, dc[k] * CELL / 50);
      var rid = 0, am = 1, fr = 1; for (var o = 0; o < 3; o++) { rid += am * (1 - Math.abs(2 * vnoise(x / 6 * fr, y / 6 * fr, 200 + o) - 1)); am *= 0.5; fr *= 2.2; }
      e = e + 30 + 120 * inland + inland * 420 * Math.pow(rid / 1.75, 2.2) * (0.5 + vnoise(x / 30, y / 30, 5));
      e *= Math.min(1, 0.35 + dc[k] * CELL / 10);
      e += (0.12 * e + 40) * fbm(x / 5, y / 5, 7) * 1.6;
      elev[k] = Math.max(2, e);
    }

    // land cell list
    var idx = new Int32Array(W * H).fill(-1), cells = [];
    for (k = 0; k < W * H; k++) if (mask[k]) { idx[k] = cells.length; cells.push(k); }
    var n = cells.length;
    var gxA = new Int16Array(n), gyA = new Int16Array(n), lon = new Float32Array(n), lat = new Float32Array(n), el = new Float32Array(n), slope = new Float32Array(n),
      dry = new Float32Array(n), coast = new Float32Array(n), si = new Uint8Array(n), lake = new Uint8Array(n), nb = new Int32Array(n * 8).fill(-1);
    for (i = 0; i < n; i++) {
      k = cells[i]; x = k % W; y = (k / W) | 0; gxA[i] = x; gyA[i] = y; lon[i] = lonOf(x); lat[i] = latOf(y); el[i] = elev[k]; coast[i] = dc[k] * CELL;
      var ex = (elev[k + 1] || 0) - (elev[k - 1] || 0), ey = (elev[k + W] || 0) - (elev[k - W] || 0);
      slope[i] = Math.sqrt(ex * ex + ey * ey) / (2 * CELL * 1000); // m/m
      var sh = 0; for (var st = 1; st <= 36; st++) { if (x - st < 0) break; var up = elev[k - st] - elev[k]; if (up > 0) sh = Math.max(sh, up * Math.exp(-st * CELL / 70)); }
      dry[i] = clamp(sh / 900, 0, 1);
      var m = 0, dd = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
      for (var q = 0; q < 8; q++) { var nx = x + dd[q][0], ny = y + dd[q][1]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; var nk = ny * W + nx; if (mask[nk]) nb[i * 8 + (m++)] = idx[nk]; }
    }
    // islands: flood from Christchurch
    var start = idx[Math.round(gyOf(-43.53)) * W + Math.round(gxOf(172.64))];
    var stack = [start]; si[start] = 1;
    while (stack.length) { var c0 = stack.pop(); for (q = 0; q < 8; q++) { var c1 = nb[c0 * 8 + q]; if (c1 >= 0 && !si[c1]) { si[c1] = 1; stack.push(c1); } } }
    for (i = 0; i < n; i++) if (!si[i] && (lat[i] < -46.4 || (lat[i] < -40.75 && lon[i] < 174.45))) si[i] = 1;
    // lakes
    for (i = 0; i < n; i++) for (var l = 0; l < LAKES.length; l++) { var L = LAKES[l]; if (!L[2]) continue; var lx = (lon[i] - L[0]) * K / L[2], ly = (lat[i] - L[1]) * KY / L[3]; if (lx * lx + ly * ly < 1) lake[i] = 1; }

    function distTo(i, plon, plat) { var dx = (lon[i] - plon) * K, dy = (lat[i] - plat) * KY; return Math.sqrt(dx * dx + dy * dy); }
    function field(list, rad, wIdx) { var f = new Float32Array(n); for (var i = 0; i < n; i++) { var s = 0; for (var j = 0; j < list.length; j++) { var p = list[j], d = distTo(i, p[0], p[1]) / (rad || p[2]); if (d < 3) s += (wIdx != null ? p[wIdx] : 1) * Math.exp(-d * d); } f[i] = s; } return f; }
    var wetZ = field(WETZONES, null, null), maori = field(MAORI, 38, 2), gardens = field(MAORI, 7, 2);
    var plateau = field([[175.95, -39.15, 28], [176.6, -38.6, 22]], null, null);

    // static per-town distances, protection year per cell
    var tdist = TOWNS.map(function (t) { var a = new Float32Array(n); for (var i = 0; i < n; i++) a[i] = distTo(i, t[1], t[2]); return a; });
    var protY = new Int16Array(n).fill(9999);
    for (i = 0; i < n; i++) for (var p = 0; p < PROTECT.length; p++) { var P = PROTECT[p]; if (distTo(i, P[0], P[1]) < P[2]) protY[i] = Math.min(protY[i], P[3]); }
    function spots(list) { return list.map(function (s) { var a = new Float32Array(n); for (var i = 0; i < n; i++) { var d = distTo(i, s[0], s[1]) / s[2]; a[i] = d < 3 ? s[4] * Math.exp(-d * d) : 0; } return { y: s[3], f: a }; }); }

    var pn = [0, 1, 2, 3].map(function (o) { var f = new Float32Array(n); for (var i = 0; i < n; i++) f[i] = fbm(gxA[i] / 4.5, gyA[i] / 4.5, 300 + o * 17) * 2.4; return f; });
    // hillshade
    var shade = new Float32Array(W * H);
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) { k = y * W + x; if (!mask[k]) continue;
      var dzx = (elev[k + 1] - elev[k - 1]) / (2 * CELL * 1000) * 6, dzy = (elev[k + W] - elev[k - W]) / (2 * CELL * 1000) * 6;
      var nzv = 1 / Math.sqrt(dzx * dzx + dzy * dzy + 1); shade[k] = clamp((-dzx * -0.6 + -dzy * -0.6 + 0.53) * nzv / 1.0, 0, 1.2); }

    return { W: W, H: H, CELL: CELL, K: K, KY: KY, n: n, cells: cells, idx: idx, gx: gxA, gy: gyA, lon: lon, lat: lat, el: el, slope: slope, dry: dry, coast: coast,
      si: si, lake: lake, nb: nb, wetZ: wetZ, maori: maori, gardens: gardens, plateau: plateau, tdist: tdist, protY: protY, shade: shade, pn: pn,
      cropSpots: spots(CROPSPOTS), pineSpots: spots(PINESPOTS), gxOf: gxOf, gyOf: gyOf };
  }

  // ---------- selection: top-k by potential (bucketed, O(n)) ----------
  function pickTop(cand, pot, m, k) {
    if (k <= 0 || m === 0) return [];
    if (k >= m) return Array.prototype.slice.call(cand, 0, m);
    var lo = Infinity, hi = -Infinity, i;
    for (i = 0; i < m; i++) { if (pot[i] < lo) lo = pot[i]; if (pot[i] > hi) hi = pot[i]; }
    var NB = 1024, cnt = new Int32Array(NB), sc = (NB - 1) / (hi - lo || 1);
    for (i = 0; i < m; i++) cnt[((pot[i] - lo) * sc) | 0]++;
    var acc = 0, th = NB - 1; while (th > 0 && acc + cnt[th] < k) { acc += cnt[th]; th--; }
    var need = k - acc, out = [];
    for (i = 0; i < m; i++) { var bk = ((pot[i] - lo) * sc) | 0; if (bk > th) out.push(cand[i]); else if (bk === th && need > 0) { out.push(cand[i]); need--; } }
    return out;
  }

  // ---------- run ----------
  function run(S, params, onDone, onProgress) {
    params = params || {};
    var seed = params.seed || 1, cn = params.contagion == null ? 1 : params.contagion, sig = params.noise == null ? 0.35 : params.noise, acw = params.access == null ? 1 : params.access;
    var rnd = mulberry(seed * 9973 + 17);
    function gauss() { return (rnd() + rnd() + rnd() - 1.5) * 1.15; }
    var n = S.n, cls = new Uint8Array(n), nbA = S.nb, years = Y1 - Y0 + 1;
    var snaps = new Uint8Array(years * n), counts = [], clearY = new Int16Array(n), origin = new Uint8Array(n), townOf = new Int16Array(n).fill(-1);
    var cand = new Int32Array(n), pot = new Float32Array(n);
    function frac(i, test) { var c = 0, o = i * 8; for (var q = 0; q < 8; q++) { var j = nbA[o + q]; if (j >= 0 && test[cls[j]]) c++; else if (j < 0) c += 0.25; } return c / 8; }
    function setOf(arr) { var t = new Uint8Array(12); arr.forEach(function (v) { t[v] = 1; }); return t; }
    var DEV = setOf([C.SHEEP, C.DAIRY, C.CROP, C.URB, C.SCRUB, C.PINE]), IS = []; for (var c = 0; c < 12; c++) IS.push(setOf([c]));

    // ---- initial 1840 state ----
    var i, total = 0;
    for (i = 0; i < n; i++) { if (S.lake[i]) cls[i] = C.LAKE; else total++; }
    function initPick(frac0, from, score) {
      var m = 0; for (var i = 0; i < n; i++) if (cls[i] === from) { cand[m] = i; pot[m] = score(i); m++; }
      var got = pickTop(cand, pot, m, Math.round(frac0 * total)); return got;
    }
    var ir = mulberry(4242);
    initPick(0.08, 0, function (i) { return S.el[i] - (1550 - Math.max(0, -38 - S.lat[i]) * 50); }).forEach(function (i) { cls[i] = C.ALP; });
    initPick(0.025, 0, function (i) { return S.wetZ[i] * 1.5 - S.el[i] / 60 - S.slope[i] * 40 + (S.coast[i] < 3 ? -0.3 : 0) + ir() * 0.6; }).forEach(function (i) { cls[i] = C.WET; });
    initPick(0.215, 0, function (i) { return (S.si[i] ? S.dry[i] * 2 + 0.6 : -2) + S.plateau[i] * 1.8 - Math.abs(S.el[i] - 500) / 900 + ir() * 0.5 - (S.si[i] && S.lon[i] > 172.7 && S.lat[i] < -43.6 && S.lat[i] > -43.9 && S.el[i] > 200 ? 3 : 0); }).forEach(function (i) { cls[i] = C.TUSS; });
    initPick(0.0025, 0, function (i) { return S.gardens[i] - S.slope[i] * 20 - S.el[i] / 300 + ir() * 0.3; }).forEach(function (i) { cls[i] = C.CROP; origin[i] = 1; });
    initPick(0.15, 0, function (i) { return S.maori[i] * (S.si[i] ? 0.5 : 1) - Math.max(0, S.el[i] - 250) / 300 + S.plateau[i] * 0.6 + ir() * 0.45; }).forEach(function (i) { cls[i] = C.SCRUB; });
    for (i = 0; i < n; i++) if (cls[i] === 0) cls[i] = C.NAT;
    var base = { NAT: 0, WET: 0, TUSS: 0 };
    for (i = 0; i < n; i++) { if (cls[i] === C.NAT) base.NAT++; if (cls[i] === C.WET) base.WET++; if (cls[i] === C.TUSS) base.TUSS++; }
    // urban seeds
    var dmin = new Float32Array(n).fill(1e9), active = new Uint8Array(S.tdist.length);

    function target(name, yr) { var v = interp(DEM[name], yr); if (name === 'NAT' || name === 'WET' || name === 'TUSS') return Math.round(v * base[name]); return Math.round(v / 100 * total); }
    function countOf(c) { var s = 0; for (var i = 0; i < n; i++) if (cls[i] === c) s++; return s; }
    function convert(list, to, yr) { for (var j = 0; j < list.length; j++) { var i = list[j]; if ((cls[i] === C.NAT || cls[i] === C.WET) && !clearY[i]) clearY[i] = yr; cls[i] = to; } }
    function gather(test, score, pf) { var f = S.pn[pf || 0], pw = sig * 2.2; var m = 0; for (var i = 0; i < n; i++) if (test(cls[i], i)) { cand[m] = i; pot[m] = score(i) + gauss() * sig + f[i] * pw; m++; } return m; }
    function townPop(t, yr) { var p = t[4]; if (yr < t[3]) return 0; return Math.max(0.05, interp([[t[3], Math.min(p[0], 0.3) || 0.05], [1860, p[0]], [1900, p[1]], [1950, p[2]], [2020, p[3]], [2025, p[3] * 1.03]].filter(function (k, ix) { return ix === 0 || k[0] > t[3]; }), yr)); }

    var yr = Y0;
    function step() {
      // activate towns
      for (var t = 0; t < S.tdist.length; t++) if (!active[t] && yr >= TOWNS[t][3]) { active[t] = 1; var dd = S.tdist[t]; for (var i = 0; i < n; i++) if (dd[i] < dmin[i]) dmin[i] = dd[i]; }
      var Ls = 12 + 90 * sstep(1845, 1935, yr) + 40 * sstep(1950, 1990, yr);
      var A = function (i) { return acw * Math.exp(-dmin[i] / Ls) + (S.coast[i] < 8 ? 0.25 * (1 - sstep(1860, 1920, yr)) : 0); };
      var flat = function (i) { return clamp(1 - S.slope[i] / 0.12, 0, 1); };
      var low = function (i) { return clamp(1 - S.el[i] / 700, 0, 1); };
      var irr = sstep(1985, 2015, yr);
      var m, got, need;

      if (yr > Y0) {
        // 1. urban, per town
        var tot = target('URB', yr), pops = [], ps = 0;
        for (t = 0; t < TOWNS.length; t++) { var pp = active[t] ? Math.pow(townPop(TOWNS[t], yr), 0.9) : 0; pops.push(pp); ps += pp; }
        var have = new Int32Array(TOWNS.length); for (i = 0; i < n; i++) if (cls[i] === C.URB && townOf[i] >= 0) have[townOf[i]]++;
        for (t = 0; t < TOWNS.length; t++) {
          var want = Math.round(tot * pops[t] / ps) - have[t]; if (want <= 0) continue;
          var dd2 = S.tdist[t], rad = 4 + 2.2 * Math.sqrt(have[t] + want);
          m = 0; for (i = 0; i < n; i++) { if (dd2[i] > rad * 2.5 + 5 || cls[i] === C.URB || cls[i] === C.LAKE || cls[i] === C.ALP) continue; cand[m] = i; pot[m] = 2.2 * cn * frac(i, IS[C.URB]) - dd2[i] / rad + 0.6 * flat(i) - (cls[i] === C.NAT ? 0.3 : 0) + gauss() * sig * 0.8; m++; }
          got = pickTop(cand, pot, m, want); convert(got, C.URB, yr); got.forEach(function (i) { townOf[i] = t; });
        }
        // 2. native forest clearance
        need = countOf(C.NAT) - target('NAT', yr);
        if (need > 0) { m = gather(function (c, i) { return c === C.NAT && S.protY[i] > yr; }, function (i) { return 1.3 * A(i) + 1.1 * cn * frac(i, DEV) + 0.7 * flat(i) + 0.7 * low(i) + (S.si[i] ? -0.35 : 0.15) - (S.si[i] && S.dry[i] < 0.1 && S.lon[i] < 171.8 ? 0.6 : 0); });
          convert(pickTop(cand, pot, m, need), C.SHEEP, yr); }
        // 3. wetland drainage
        need = countOf(C.WET) - target('WET', yr);
        if (need > 0) { m = gather(function (c) { return c === C.WET; }, function (i) { return 1.4 * A(i) + 1.0 * cn * frac(i, DEV); }); convert(pickTop(cand, pot, m, need), C.SHEEP, yr); }
        // 4. tussock improvement
        need = countOf(C.TUSS) - target('TUSS', yr);
        if (need > 0) { m = gather(function (c) { return c === C.TUSS; }, function (i) { return A(i) + 0.8 * flat(i) + 1.2 * low(i) + 0.8 * cn * frac(i, IS[C.SHEEP]) + S.plateau[i] * 0.4; }); convert(pickTop(cand, pot, m, need), C.SHEEP, yr); }
        // 5. Māori gardens alienated
        if (yr >= 1850 && yr <= 1900) for (i = 0; i < n; i++) if (origin[i] === 1 && cls[i] === C.CROP && rnd() < 0.06) { cls[i] = C.SHEEP; origin[i] = 0; }
        // 6. dairy
        need = target('DAIRY', yr) - countOf(C.DAIRY);
        var dSuit = function (i) { var wetOK = 1 - S.dry[i] * (1 - irr); return 1.6 * flat(i) * low(i) * (0.4 + wetOK) + 1.2 * cn * frac(i, IS[C.DAIRY]) + 0.5 * A(i) - (S.si[i] ? 0.45 * (1 - irr) - 0.35 * irr : 0) + (S.el[i] > 500 ? -1 : 0) - (S.lat[i] > -36.2 ? 0.4 * sstep(1950, 1990, yr) : 0); };
        if (need > 0) { m = gather(function (c) { return c === C.SHEEP || c === C.SCRUB || c === C.CROP || (irr > 0.2 && c === C.TUSS) || (yr > 2003 && c === C.PINE); }, function (i) { return dSuit(i) + (cls[i] === C.PINE ? -0.2 : 0); }, 1); convert(pickTop(cand, pot, m, need), C.DAIRY, yr); }
        else if (need < 0) { m = gather(function (c) { return c === C.DAIRY; }, function (i) { return -dSuit(i); }); convert(pickTop(cand, pot, m, -need), C.SHEEP, yr); }
        // 7. cropping & horticulture
        need = target('CROP', yr) - countOf(C.CROP);
        var cSuit = function (i) { var s = 0; for (var q = 0; q < S.cropSpots.length; q++) { var sp = S.cropSpots[q]; if (yr >= sp.y) s += sp.f[i] * sstep(sp.y, sp.y + 25, yr); } return 1.2 * flat(i) * low(i) * (0.6 + 0.6 * S.dry[i]) + 1.3 * s + 1.0 * cn * frac(i, IS[C.CROP]) + 0.4 * A(i); };
        if (need > 0) { m = gather(function (c, i) { return (c === C.SHEEP || c === C.SCRUB || c === C.TUSS || c === C.DAIRY) && origin[i] !== 1; }, cSuit); convert(pickTop(cand, pot, m, need), C.CROP, yr); }
        else if (need < 0) { m = gather(function (c, i) { return c === C.CROP; }, function (i) { return -cSuit(i) + (origin[i] === 1 ? -2 : 0); }); var gl = pickTop(cand, pot, m, -need); convert(gl, C.SHEEP, yr); gl.forEach(function (i) { origin[i] = 0; }); }
        // 8. plantation forestry
        need = target('PINE', yr) - countOf(C.PINE);
        var pSuit = function (i) { var s = 0; for (var q = 0; q < S.pineSpots.length; q++) { var sp = S.pineSpots[q]; if (yr >= sp.y) s += sp.f[i] * sstep(sp.y, sp.y + 15, yr); } var hill = clamp(S.slope[i] / 0.08, 0, 1) * (S.el[i] < 900 ? 1 : 0); return 1.4 * s + 0.95 * hill * sstep(1960, 1990, yr) + 1.4 * cn * frac(i, IS[C.PINE]) - (S.el[i] > 1000 ? 2 : 0) - 0.4 * flat(i) * low(i); };
        if (need > 0) { m = gather(function (c, i) { return c === C.SHEEP || c === C.SCRUB || c === C.TUSS || (c === C.NAT && yr > 1955 && yr < 1985 && S.protY[i] > yr); }, function (i) { return pSuit(i) + (cls[i] === C.NAT ? -0.5 : 0) + (cls[i] === C.SCRUB ? 0.2 : 0); }, 2); convert(pickTop(cand, pot, m, need), C.PINE, yr); }
        else if (need < 0) { m = gather(function (c) { return c === C.PINE; }, function (i) { return -pSuit(i) + dSuit(i) * 0.5; }); convert(pickTop(cand, pot, m, -need), C.SHEEP, yr); }
        // 9. sheep & beef balance against scrub
        need = target('SHEEP', yr) - countOf(C.SHEEP);
        var keep = function (i) { return 1.2 * flat(i) + 1.0 * low(i) + A(i) + 0.8 * cn * frac(i, IS[C.SHEEP]) - (S.si[i] && S.dry[i] < 0.1 ? 0.3 : 0); };
        if (need > 0) { m = gather(function (c) { return c === C.SCRUB; }, keep, 3); convert(pickTop(cand, pot, m, need), C.SHEEP, yr); }
        else if (need < 0) { m = gather(function (c) { return c === C.SHEEP; }, function (i) { return -keep(i) + 0.6 * cn * frac(i, IS[C.SCRUB]); }, 3); convert(pickTop(cand, pot, m, -need), C.SCRUB, yr); }
      } else {
        // 1840 urban seeds
        [0, 2].forEach(function (t) { var dd = S.tdist[t], best = -1, bd = 1e9; for (var i = 0; i < n; i++) if (dd[i] < bd && cls[i] !== C.LAKE) { bd = dd[i]; best = i; } cls[best] = C.URB; townOf[best] = t; });
      }
      snaps.set(cls, (yr - Y0) * n);
      var cc = new Int32Array(12); for (i = 0; i < n; i++) cc[cls[i]]++; counts.push(cc);
    }
    function loop() {
      var stop = Math.min(Y1, yr + 12);
      for (; yr <= stop; yr++) step();
      if (onProgress) onProgress((yr - Y0) / years);
      if (yr <= Y1) { if (typeof setTimeout === 'function' && !params.sync) setTimeout(loop, 0); else loop(); }
      else onDone({ snaps: snaps, counts: counts, clearY: clearY, total: total, n: n });
    }
    loop();
  }

  return { C: C, Y0: Y0, Y1: Y1, build: build, run: run, TOWNS: TOWNS, DEM: DEM };
})();
if (typeof module !== 'undefined') module.exports = NZModel;
