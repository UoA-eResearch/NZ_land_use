/* Aotearoa land-use cellular automaton, 1840–2025.
   Demand-constrained CA on a real DEM, anchored to LCDB v6 land cover (1996/97–2023/24).
   National class totals follow keyframe curves that are rescaled to meet the observed
   totals; the CA decides WHERE and WHEN change happens (suitability + neighbourhood +
   access to towns + noise).

   Anchored mode (default): every cell is forced to its observed LCDB class at each LCDB
   epoch. The 1840 map keeps the natural cover LCDB still shows in 1996 and reconstructs the
   rest; between 1840 and 1996 each cell may only move towards its observed 1996 class, so
   the CA chooses timing and route. Between LCDB epochs, observed changes are spread over
   the interval. Dairy vs sheep & beef is never observed: dairy is allocated inside LCDB
   high-producing grassland to match national dairy area.

   Free mode (anchor: false): the 1840 map comes from terrain rules only and the CA runs
   unconstrained (national totals still match LCDB); agreement with LCDB is reported. */
var NZModel = (function () {
  'use strict';
  var C = { SEA: 0, NAT: 1, SCRUB: 2, TUSS: 3, WET: 4, ALP: 5, SHEEP: 6, DAIRY: 7, PINE: 8, CROP: 9, URB: 10, LAKE: 11 };
  var HPG = 12;                                   // observed code: high-producing exotic grassland
  var Y0 = 1840, Y1 = 2025;
  var FOREST1840 = 0.53, TUSS1840 = 0.215, WET_REMAIN = 0.10, GARDENS1840 = 0.0025;

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
  function b64bytes(s) {
    if (typeof atob === 'function') { var r = atob(s), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }

  // ---------- geography inputs (approximate, hand-placed) ----------
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
  // protected forest (free mode): [lon,lat,r km,year]
  var PROTECT = [[175.6, -39.2, 18, 1887], [174.06, -39.3, 10, 1881], [177.0, -38.75, 30, 1954], [171.6, -42.95, 20, 1929], [167.4, -45.4, 70, 1904], [170.1, -43.5, 25, 1953],
    [168.7, -44.4, 35, 1964], [172.4, -41.3, 35, 1970], [171.4, -42.1, 12, 1987], [175.3, -40.85, 20, 1954], [176.0, -39.9, 22, 1976], [176.2, -39.15, 20, 1969],
    [175.6, -38.5, 15, 1978], [176.65, -38.7, 12, 1984], [173.6, -35.65, 10, 1952], [175.65, -36.9, 15, 1971], [169.4, -46.45, 15, 1958], [167.95, -47.0, 25, 1907],
    [172.8, -41.9, 20, 1956], [176.4, -39.3, 15, 1974], [177.9, -37.8, 20, 1979], [174.53, -36.95, 8, 1895], [175.2, -37.1, 8, 1905], [173.2, -41.45, 15, 1977]];
  var CROPSPOTS = [[172.0, -43.75, 55, 1855, 1.0], [176.8, -39.6, 20, 1880, 1.0], [174.9, -37.2, 12, 1870, 1.0], [176.3, -37.8, 22, 1970, 1.2], [173.8, -41.5, 16, 1980, 1.3],
    [169.3, -45.1, 25, 1900, 0.8], [173.0, -41.12, 15, 1880, 0.9], [177.9, -38.65, 12, 1900, 0.8], [170.9, -45.0, 20, 1870, 0.7], [168.6, -46.15, 25, 1880, 0.4]];
  var PINESPOTS = [[176.4, -38.45, 38, 1922, 1.35], [175.85, -38.3, 30, 1945, 1.0], [178.0, -38.3, 45, 1985, 1.0], [173.7, -35.8, 50, 1965, 0.8], [172.95, -41.35, 30, 1960, 0.8],
    [172.2, -43.4, 15, 1925, 0.8], [169.6, -46.1, 40, 1960, 0.6], [176.6, -39.4, 35, 1970, 0.7], [175.2, -39.6, 40, 1975, 0.5], [174.6, -36.45, 20, 1930, 0.8]];

  // ---------- historical curve shapes ----------
  // NAT/WET/TUSS relative to 1840; others % of land. Before the first LCDB epoch they are
  // rescaled so they meet the observed LCDB totals; afterwards LCDB totals are used directly.
  var DEM = {
    NAT: [[1840, 1], [1860, 0.96], [1880, 0.85], [1900, 0.70], [1920, 0.58], [1940, 0.53], [1960, 0.50], [1980, 0.48], [2000, 0.465], [2025, 0.46]],
    WET: [[1840, 1], [1860, 0.95], [1880, 0.84], [1900, 0.64], [1920, 0.45], [1940, 0.32], [1960, 0.22], [1980, 0.15], [2000, 0.12], [2025, 0.10]],
    TUSS: [[1840, 1], [1860, 0.98], [1880, 0.93], [1900, 0.86], [1920, 0.8], [1940, 0.75], [1960, 0.64], [1980, 0.54], [2000, 0.48], [2025, 0.45]],
    DAIRY: [[1840, 0], [1880, 0.1], [1900, 1.0], [1920, 3.0], [1940, 4.0], [1960, 4.6], [1980, 4.4], [1990, 4.8], [2000, 5.6], [2010, 6.4], [2025, 6.5]],
    PINE: [[1840, 0], [1900, 0], [1920, 0.1], [1930, 0.6], [1940, 1.2], [1960, 1.5], [1980, 3.5], [1990, 4.8], [2000, 6.6], [2010, 6.4], [2020, 6.6], [2025, 7.0]],
    CROP: [[1840, 0.25], [1860, 0.4], [1880, 1.0], [1900, 1.4], [1920, 1.3], [1940, 1.2], [1960, 1.3], [1980, 1.6], [2000, 1.7], [2025, 1.9]],
    URB: [[1840, 0.006], [1860, 0.03], [1880, 0.07], [1900, 0.13], [1920, 0.2], [1940, 0.3], [1960, 0.45], [1980, 0.65], [2000, 0.8], [2025, 0.95]],
    // scrub as a share of (scrub + sheep & beef) land
    SCRUBF: [[1840, 1], [1860, 0.97], [1880, 0.75], [1900, 0.48], [1920, 0.36], [1950, 0.28], [1980, 0.2]]
  };

  // population (thousands) of a town in a year, 0 before founding
  function townPop(t, yr) { var p = t[4]; if (yr < t[3]) return 0; return Math.max(0.05, interp([[t[3], Math.min(p[0], 0.3) || 0.05], [1860, p[0]], [1900, p[1]], [1950, p[2]], [2020, p[3]], [2025, p[3] * 1.03]].filter(function (k, ix) { return ix === 0 || k[0] > t[3]; }), yr)); }

  // ---------- static build ----------
  function build(grid) {
    var W = grid.W, H = grid.H, CELL = grid.CELL, K = grid.K, KY = grid.KY, WH = W * H;
    var mb = b64bytes(grid.mask), mask = new Uint8Array(WH), i, k, x, y;
    for (i = 0; i < WH; i++) mask[i] = (mb[i >> 3] >> (i & 7)) & 1;
    var lonOf = function (gx) { return grid.LON0 + (gx + 0.5) * CELL / K; };
    var latOf = function (gy) { return grid.LATTOP - (gy + 0.5) * CELL / KY; };
    var gxOf = function (lon) { return (lon - grid.LON0) * K / CELL - 0.5; };
    var gyOf = function (lat) { return (grid.LATTOP - lat) * KY / CELL - 0.5; };

    var idx = new Int32Array(WH).fill(-1), n = 0;
    for (k = 0; k < WH; k++) if (mask[k]) idx[k] = n++;
    var cells = new Int32Array(n); for (k = 0; k < WH; k++) if (mask[k]) cells[idx[k]] = k;

    // elevation (m) and slope (degrees, from the 300 m DEM)
    var eb = b64bytes(grid.elev), sb = b64bytes(grid.slope);
    var el = new Float32Array(n), sl = new Float32Array(n), elev = new Float32Array(WH);
    for (i = 0; i < n; i++) { el[i] = eb[2 * i] | (eb[2 * i + 1] << 8); sl[i] = sb[i] / 4; elev[cells[i]] = el[i]; }

    // distance to sea (chamfer, km)
    var dc = new Float32Array(WH), d, a = CELL, b = CELL * 1.414;
    for (i = 0; i < WH; i++) dc[i] = mask[i] ? 1e9 : 0;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) { k = y * W + x; d = dc[k]; if (!d) continue;
      if (x > 0) d = Math.min(d, dc[k - 1] + a); if (y > 0) { d = Math.min(d, dc[k - W] + a); if (x > 0) d = Math.min(d, dc[k - W - 1] + b); if (x < W - 1) d = Math.min(d, dc[k - W + 1] + b); } dc[k] = d; }
    for (y = H - 1; y >= 0; y--) for (x = W - 1; x >= 0; x--) { k = y * W + x; d = dc[k]; if (!d) continue;
      if (x < W - 1) d = Math.min(d, dc[k + 1] + a); if (y < H - 1) { d = Math.min(d, dc[k + W] + a); if (x < W - 1) d = Math.min(d, dc[k + W + 1] + b); if (x > 0) d = Math.min(d, dc[k + W - 1] + b); } dc[k] = d; }

    var gxA = new Int16Array(n), gyA = new Int16Array(n), lon = new Float32Array(n), lat = new Float32Array(n),
      dry = new Float32Array(n), coast = new Float32Array(n), si = new Uint8Array(n), nb = new Int32Array(n * 8).fill(-1);
    var maxSt = Math.ceil(90 / CELL), DD = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    var expT = new Float32Array(maxSt + 1); for (var st0 = 0; st0 <= maxSt; st0++) expT[st0] = Math.exp(-st0 * CELL / 70);
    for (i = 0; i < n; i++) {
      k = cells[i]; x = k % W; y = (k / W) | 0; gxA[i] = x; gyA[i] = y; lon[i] = lonOf(x); lat[i] = latOf(y); coast[i] = dc[k];
      // rain shadow: highest upwind (west) terrain within 90 km, discounted with distance
      var sh = 0, e0 = elev[k];
      for (var st = 1; st <= maxSt && x - st >= 0; st++) { var up = elev[k - st] - e0; if (up > 0) { var v = up * expT[st]; if (v > sh) sh = v; } }
      dry[i] = clamp(sh / 900, 0, 1);
      var m = 0;
      for (var q = 0; q < 8; q++) { var nx = x + DD[q][0], ny = y + DD[q][1]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; var nk = ny * W + nx; if (mask[nk]) nb[i * 8 + (m++)] = idx[nk]; }
    }
    // South Island: flood from Christchurch; offshore islands in the south/west join it
    var start = idx[Math.round(gyOf(-43.53)) * W + Math.round(gxOf(172.64))];
    if (start < 0) for (i = 0; i < n; i++) if (Math.abs(lat[i] + 43.53) < 0.05 && Math.abs(lon[i] - 172.5) < 0.2) { start = i; break; }
    var stack = [start]; si[start] = 1;
    while (stack.length) { var c0 = stack.pop(); for (q = 0; q < 8; q++) { var c1 = nb[c0 * 8 + q]; if (c1 >= 0 && !si[c1]) { si[c1] = 1; stack.push(c1); } } }
    for (i = 0; i < n; i++) if (!si[i] && (lat[i] < -46.4 || (lat[i] < -40.75 && lon[i] < 174.45))) si[i] = 1;

    // observed land cover (LCDB), 4-bit codes, epoch-major
    var obs = null, obsYears = grid.lcYears || null, lake = new Uint8Array(n);
    if (grid.lc) {
      var lb = b64bytes(grid.lc), ne = obsYears.length; obs = new Uint8Array(ne * n);
      for (i = 0; i < ne * n; i++) obs[i] = (lb[i >> 1] >> ((i & 1) << 2)) & 15;
      for (i = 0; i < n; i++) lake[i] = obs[i] === C.LAKE ? 1 : 0;
    }

    function distTo(i, plon, plat) { var dx = (lon[i] - plon) * K, dy = (lat[i] - plat) * KY; return Math.sqrt(dx * dx + dy * dy); }
    function field(list, rad, wIdx) { var f = new Float32Array(n); for (var i = 0; i < n; i++) { var s = 0; for (var j = 0; j < list.length; j++) { var p = list[j], d = distTo(i, p[0], p[1]) / (rad || p[2]); if (d < 3) s += (wIdx != null ? p[wIdx] : 1) * Math.exp(-d * d); } f[i] = s; } return f; }
    var wetZ = field(WETZONES, null, null), maori = field(MAORI, 38, 2), gardens = field(MAORI, 7, 2);
    var plateau = field([[175.95, -39.15, 28], [176.6, -38.6, 22]], null, null);

    // towns: sparse lists of cells within TR km
    var TR = 32, townCells = [], townDist = [];
    TOWNS.forEach(function (t) {
      var x0 = gxOf(t[1]), y0 = gyOf(t[2]), r = Math.ceil(TR / CELL) + 1, ci = [], cd = [];
      for (var yy = Math.max(0, Math.floor(y0 - r)); yy <= Math.min(H - 1, Math.ceil(y0 + r)); yy++)
        for (var xx = Math.max(0, Math.floor(x0 - r)); xx <= Math.min(W - 1, Math.ceil(x0 + r)); xx++) {
          var j = idx[yy * W + xx]; if (j < 0) continue; var dd = distTo(j, t[1], t[2]); if (dd <= TR) { ci.push(j); cd.push(dd); }
        }
      townCells.push(Int32Array.from(ci)); townDist.push(Float32Array.from(cd));
    });
    var protY = new Int16Array(n).fill(9999);
    for (i = 0; i < n; i++) for (var p = 0; p < PROTECT.length; p++) { var P = PROTECT[p]; if (distTo(i, P[0], P[1]) < P[2]) protY[i] = Math.min(protY[i], P[3]); }
    function spots(list) { return list.map(function (s) { var ci = [], cf = []; for (var i = 0; i < n; i++) { var d = distTo(i, s[0], s[1]) / s[2]; if (d < 2.6) { ci.push(i); cf.push(s[4] * Math.exp(-d * d)); } } return { y: s[3], i: Int32Array.from(ci), f: Float32Array.from(cf) }; }); }

    // spatially correlated noise, ~11 km features regardless of cell size
    var pn = [0, 1, 2, 3].map(function (o) { var f = new Float32Array(n); for (var i = 0; i < n; i++) f[i] = fbm(gxA[i] * CELL / 11, gyA[i] * CELL / 11, 300 + o * 17) * 2.4; return f; });

    // neighbourhood share of each observed natural class in the first LCDB epoch (~8 km box blur)
    var near = null;
    if (obs) {
      near = {};
      var r = Math.max(1, Math.round(8 / CELL)), tmp = new Float32Array(WH), cntm = new Float32Array(WH);
      for (i = 0; i < n; i++) cntm[cells[i]] = 1;
      boxBlur(cntm, tmp, W, H, r);
      [C.NAT, C.TUSS, C.WET, C.SCRUB].forEach(function (c) {
        var g = new Float32Array(WH);
        for (var i = 0; i < n; i++) g[cells[i]] = obs[i] === c ? 1 : 0;
        boxBlur(g, tmp, W, H, r);
        var f = new Float32Array(n); for (i = 0; i < n; i++) f[i] = g[cells[i]] / Math.max(1e-6, cntm[cells[i]]);
        near[c] = f;
      });
    }

    // static terrain terms used in suitability scores
    var flatA = new Float32Array(n), lowA = new Float32Array(n), hillA = new Float32Array(n);
    for (i = 0; i < n; i++) { flatA[i] = clamp(1 - (sl[i] - 2) / 12, 0, 1); lowA[i] = clamp(1 - el[i] / 700, 0, 1); hillA[i] = clamp((sl[i] - 5) / 12, 0, 1) * (el[i] < 900 ? 1 : 0); }

    // hillshade from the DEM (light from the north-west)
    var shade = new Float32Array(WH), ex = 2.2 + 1.6 * CELL;
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) { k = y * W + x; if (!mask[k]) continue;
      var dzx = (elev[k + 1] - elev[k - 1]) / (2 * CELL * 1000) * ex, dzy = (elev[k + W] - elev[k - W]) / (2 * CELL * 1000) * ex;
      var nzv = 1 / Math.sqrt(dzx * dzx + dzy * dzy + 1); shade[k] = clamp((dzx * 0.6 + dzy * 0.6 + 0.53) * nzv, 0, 1.2); }

    return { W: W, H: H, CELL: CELL, K: K, KY: KY, n: n, cells: cells, idx: idx, gx: gxA, gy: gyA, lon: lon, lat: lat, el: el, sl: sl, dry: dry, coast: coast,
      si: si, lake: lake, nb: nb, flat: flatA, low: lowA, hill: hillA, wetZ: wetZ, maori: maori, gardens: gardens, plateau: plateau, townCells: townCells, townDist: townDist, protY: protY, shade: shade, pn: pn,
      cropSpots: spots(CROPSPOTS), pineSpots: spots(PINESPOTS), gxOf: gxOf, gyOf: gyOf, obs: obs, obsYears: obsYears, near: near, distTo: distTo };
  }

  // separable box blur, two passes of each (approximates a Gaussian); g in place, t scratch
  function boxBlur(g, t, W, H, r) {
    for (var pass = 0; pass < 2; pass++) {
      var x, y, s, k;
      for (y = 0; y < H; y++) { s = 0; k = y * W;
        for (x = -r; x <= r; x++) if (x >= 0 && x < W) s += g[k + x];
        for (x = 0; x < W; x++) { t[k + x] = s; var xa = x + r + 1, xr = x - r; if (xa < W) s += g[k + xa]; if (xr >= 0) s -= g[k + xr]; } }
      for (x = 0; x < W; x++) { s = 0;
        for (y = -r; y <= r; y++) if (y >= 0 && y < H) s += t[y * W + x];
        for (y = 0; y < H; y++) { g[y * W + x] = s; var ya = y + r + 1, yr = y - r; if (ya < H) s += t[ya * W + x]; if (yr >= 0) s -= t[yr * W + x]; } }
    }
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

  // comparison classes for agreement: grassland is one class (LCDB cannot tell dairy from sheep & beef)
  function cmpClass(c) { return c === C.DAIRY || c === HPG ? C.SHEEP : c; }
  function agreement(a, b, n) {
    var M = new Float64Array(144), i, same = 0;
    for (i = 0; i < n; i++) { var p = cmpClass(a[i]), o = cmpClass(b[i]); M[p * 12 + o]++; if (p === o) same++; }
    var pe = 0; for (var c = 0; c < 12; c++) { var r = 0, s = 0; for (var j = 0; j < 12; j++) { r += M[c * 12 + j]; s += M[j * 12 + c]; } pe += r * s; }
    pe /= n * n; var po = same / n;
    return { pc: po * 100, kappa: (po - pe) / (1 - pe) };
  }

  // ---------- run ----------
  function run(S, params, onDone, onProgress) {
    params = params || {};
    if (!S.obs) throw new Error('grid has no LCDB land cover');
    var seed = params.seed || 1, cn = params.contagion == null ? 1 : params.contagion, sig = params.noise == null ? 0.35 : params.noise, acw = params.access == null ? 1 : params.access;
    var anchor = params.anchor !== false;
    var rnd = mulberry(seed * 9973 + 17);
    function gauss() { return (rnd() + rnd() + rnd() - 1.5) * 1.15; }
    var n = S.n, nbA = S.nb, years = Y1 - Y0 + 1, obs = S.obs, OY = S.obsYears, NE = OY.length, E0 = OY[0];
    var cls = new Uint8Array(n), cnt = new Int32Array(12);
    var snaps = new Uint8Array(years * n), counts = [], clearY = new Int16Array(n), origin = new Uint8Array(n);
    var cand = new Int32Array(n), pot = new Float32Array(n), i, c, t;
    var dest = obs.subarray(0, n), cur = new Uint8Array(n);            // cur: observed code currently in force (after E0)
    cnt[0] = n;
    var fernLeft = 0;                                                   // scrub cells whose 1996 class is not scrub
    function setC(i, c) { if (dest[i] !== C.SCRUB) { if (cls[i] === C.SCRUB) fernLeft--; if (c === C.SCRUB) fernLeft++; } cnt[cls[i]]--; cnt[c]++; cls[i] = c; }
    function frac(i, test) { var s = 0, o = i * 8; for (var q = 0; q < 8; q++) { var j = nbA[o + q]; if (j >= 0) { if (test[cls[j]]) s++; } else s += 0.25; } return s / 8; }
    function setOf(arr) { var t = new Uint8Array(13); arr.forEach(function (v) { t[v] = 1; }); return t; }
    var DEV = setOf([C.SHEEP, C.DAIRY, C.CROP, C.URB, C.SCRUB, C.PINE]), GRASS = setOf([C.SHEEP, C.DAIRY]), IS = []; for (c = 0; c < 13; c++) IS.push(setOf([c]));
    var T_PINE = setOf([C.SHEEP, C.SCRUB, C.TUSS]), T_PINEN = setOf([C.SHEEP, C.SCRUB, C.TUSS, C.NAT]), T_CROP = setOf([C.SHEEP, C.SCRUB, C.TUSS, C.DAIRY]);
    var T_DAIRYF = setOf([C.SHEEP, C.SCRUB, C.CROP]), T_DAIRYF2 = setOf([C.SHEEP, C.SCRUB, C.CROP, C.TUSS]), T_DAIRYF3 = setOf([C.SHEEP, C.SCRUB, C.CROP, C.TUSS, C.PINE]);
    function okDest(i, c) { if (!anchor) return true; var d = dest[i]; return c === C.SHEEP ? (d === C.SHEEP || d === HPG) : c === C.DAIRY ? d === HPG : d === c; }

    // observed totals per epoch, by code
    var oc = []; for (var e = 0; e < NE; e++) { var cc = new Int32Array(13); for (i = 0; i < n; i++) cc[obs[e * n + i]]++; oc.push(cc); }
    var total = n - oc[0][C.LAKE];
    var FL = S.flat, LO = S.low, HI = S.hill;
    var flat = function (i) { return FL[i]; }, low = function (i) { return LO[i]; }, hill = function (i) { return HI[i]; };

    // ---- initial 1840 state ----
    var nALP = oc[0][C.ALP], nNAT0 = Math.round(FOREST1840 * total);
    var nWET0 = Math.round(Math.min(0.035 * total, Math.max(oc[0][C.WET] * 1.5, oc[NE - 1][C.WET] / WET_REMAIN)));
    var nTUSS0 = Math.max(Math.round(TUSS1840 * total), oc[0][C.TUSS]);
    var nGard = Math.round(GARDENS1840 * total);
    var nSCRUB0 = total - nALP - nNAT0 - nWET0 - nTUSS0 - nGard;
    var ir = mulberry(4242 + seed);
    function initPick(k, test, score) {
      var m = 0; for (var i = 0; i < n; i++) if (cls[i] === 0 && test(i)) { cand[m] = i; pot[m] = score(i); m++; }
      return pickTop(cand, pot, m, Math.max(0, k));
    }
    var yes = function () { return true; };
    for (i = 0; i < n; i++) if (S.lake[i]) setC(i, C.LAKE);
    var nr = S.near;
    if (anchor) {
      // natural cover still present in the first LCDB epoch is assumed present in 1840
      for (i = 0; i < n; i++) { c = dest[i]; if (c === C.NAT || c === C.TUSS || c === C.WET || c === C.ALP) setC(i, c); }
      initPick(nWET0 - cnt[C.WET], yes, function (i) { return 2.2 * nr[C.WET][i] + 1.3 * S.wetZ[i] + 0.9 * flat(i) + 0.7 * low(i) - S.sl[i] / 6 + (dest[i] === HPG ? 0.25 : 0) + ir() * 0.5; }).forEach(function (i) { setC(i, C.WET); });
      initPick(nGard, yes, function (i) { return S.gardens[i] + 0.4 * flat(i) - S.el[i] / 300 + (dest[i] === C.CROP ? 0.3 : 0) + ir() * 0.3; }).forEach(function (i) { setC(i, C.CROP); origin[i] = 1; });
      initPick(nTUSS0 - cnt[C.TUSS], yes, function (i) { return 3.2 * nr[C.TUSS][i] - 1.6 * nr[C.NAT][i] + (S.si[i] ? 1.6 * S.dry[i] + 0.3 : -0.6) + 1.4 * S.plateau[i] - Math.abs(S.el[i] - 500) / 1400 + ir() * 0.5; }).forEach(function (i) { setC(i, C.TUSS); });
      initPick(nSCRUB0, yes, function (i) { return 1.1 * S.maori[i] * (S.si[i] ? 0.5 : 1) + 1.3 * nr[C.SCRUB][i] + (dest[i] === C.SCRUB ? 0.5 : 0) - 1.2 * nr[C.NAT][i] + 0.5 * S.plateau[i] - Math.max(0, S.el[i] - 300) / 500 + ir() * 0.5; }).forEach(function (i) { setC(i, C.SCRUB); });
    } else {
      initPick(nALP, yes, function (i) { return S.el[i] - (1550 - Math.max(0, -38 - S.lat[i]) * 50) + 4 * S.sl[i]; }).forEach(function (i) { setC(i, C.ALP); });
      initPick(nWET0, yes, function (i) { return 1.5 * S.wetZ[i] + flat(i) + 0.8 * low(i) - S.sl[i] / 5 - (S.coast[i] < 3 ? 0.3 : 0) + ir() * 0.6; }).forEach(function (i) { setC(i, C.WET); });
      initPick(nTUSS0, yes, function (i) { return (S.si[i] ? 2 * S.dry[i] + 0.6 : -2) + 1.8 * S.plateau[i] - Math.abs(S.el[i] - 600) / 900 + ir() * 0.5 - (S.si[i] && S.lon[i] > 172.7 && S.lat[i] < -43.6 && S.lat[i] > -43.9 && S.el[i] > 200 ? 3 : 0); }).forEach(function (i) { setC(i, C.TUSS); });
      initPick(nGard, yes, function (i) { return S.gardens[i] - S.sl[i] / 10 - S.el[i] / 300 + ir() * 0.3; }).forEach(function (i) { setC(i, C.CROP); origin[i] = 1; });
      initPick(nSCRUB0, yes, function (i) { return S.maori[i] * (S.si[i] ? 0.5 : 1) - Math.max(0, S.el[i] - 250) / 300 + 0.6 * S.plateau[i] + ir() * 0.45; }).forEach(function (i) { setC(i, C.SCRUB); });
    }
    for (i = 0; i < n; i++) if (cls[i] === 0) setC(i, C.NAT);
    var N0 = { 1: cnt[C.NAT], 4: cnt[C.WET], 3: cnt[C.TUSS] }, CURVE = { 1: 'NAT', 4: 'WET', 3: 'TUSS', 8: 'PINE', 9: 'CROP', 10: 'URB' };
    var fern0 = fernLeft;

    // ---- national targets ----
    function obsCount(c, y) {                     // LCDB totals, linear between epochs, held after the last
      var code = c === C.SHEEP ? -1 : c;
      function at(e) { return code < 0 ? oc[e][C.SHEEP] + oc[e][HPG] : oc[e][code]; }
      if (y >= OY[NE - 1]) return at(NE - 1);
      for (var e = 0; e < NE - 1; e++) if (y <= OY[e + 1]) return at(e) + (at(e + 1) - at(e)) * (y - OY[e]) / (OY[e + 1] - OY[e]);
      return at(0);
    }
    function tgt(c, y) {
      if (y >= E0) return Math.round(obsCount(c, y));
      var nm = CURVE[c];
      if (c === C.NAT || c === C.WET || c === C.TUSS) { var r = interp(DEM[nm], y), r0 = interp(DEM[nm], E0); return Math.round(N0[c] - (1 - r) / (1 - r0) * (N0[c] - oc[0][c])); }
      return Math.round(oc[0][c] * interp(DEM[nm], y) / interp(DEM[nm], E0));
    }
    function tgtDairy(y) { var v = Math.round(interp(DEM.DAIRY, y) / 100 * total); return Math.min(v, Math.round(0.8 * (y >= E0 ? obsCount(HPG, y) : oc[0][HPG]))); }
    function obsCountHPG(y) { return obsCount(HPG, y); }
    var sf0 = oc[0][C.SCRUB] / Math.max(1, oc[0][C.SCRUB] + oc[0][C.SHEEP] + oc[0][HPG] - tgtDairy(E0));
    var SF = DEM.SCRUBF.concat([[E0, sf0]]);

    // ---- town footprints (anchored: each 1996 urban cell belongs to its nearest town) ----
    var NT = TOWNS.length, foot = [], footCount = new Int32Array(NT + 1), townOf = new Int16Array(n).fill(-1);
    if (anchor) {
      var lists = []; for (t = 0; t <= NT; t++) lists.push([]);
      for (i = 0; i < n; i++) if (dest[i] === C.URB) {
        var best = NT, bd = 30;
        for (t = 0; t < NT; t++) { var d = S.distTo(i, TOWNS[t][1], TOWNS[t][2]) / Math.pow(Math.max(1, TOWNS[t][4][3]), 0.15); if (d < bd && TOWNS[t][3] < E0) { bd = d; best = t; } }
        lists[best].push(i);
      }
      for (t = 0; t <= NT; t++) { foot.push(Int32Array.from(lists[t])); footCount[t] = lists[t].length; }
    }

    // ---- transitions between LCDB epochs (anchored) ----
    var pend = new Uint8Array(n), trans = [];
    for (e = 0; e < NE - 1; e++) { var L = []; for (i = 0; i < n; i++) if (obs[e * n + i] !== obs[(e + 1) * n + i]) L.push(i); trans.push(Int32Array.from(L)); }
    function dispOf(code, prev) { return code === HPG ? (prev === C.DAIRY ? C.DAIRY : C.SHEEP) : code; }

    var dmin = new Float32Array(n).fill(1e9), active = new Uint8Array(NT), cropF = new Float32Array(n), pineF = new Float32Array(n);
    var cropW = new Float32Array(S.cropSpots.length), pineW = new Float32Array(S.pineSpots.length);
    var snapped = 0, yr = Y0;
    // gather candidates (class table ts, optional predicate dfn), then score them. When only
    // `need` cells are wanted from a much larger pool, score a random subset of >= KS*need.
    var NTAB = 1 << 20, noiseT = new Float32Array(NTAB); for (i = 0; i < NTAB; i++) noiseT[i] = gauss();
    var KS = 30, MINC = Math.max(4000, (n / 12) | 0);
    function gather(ts, dfn, score, pf, need) {
      var m = 0, i, j;
      if (dfn) { for (i = 0; i < n; i++) if (ts[cls[i]] && dfn(i)) cand[m++] = i; }
      else for (i = 0; i < n; i++) if (ts[cls[i]]) cand[m++] = i;
      var cap = Math.max(MINC, need * KS);
      if (m > cap) { for (j = 0; j < cap; j++) { var r = j + ((rnd() * (m - j)) | 0), tmp = cand[j]; cand[j] = cand[r]; cand[r] = tmp; } m = cap; }
      var f = S.pn[pf || 0], pw = sig * 2.2, off = (rnd() * NTAB) | 0;
      for (j = 0; j < m; j++) { i = cand[j]; pot[j] = score(i) + noiseT[(off + j) & (NTAB - 1)] * sig + f[i] * pw; }
      return m;
    }
    function convert(list, to) { for (var j = 0; j < list.length; j++) { var i = list[j]; if ((cls[i] === C.NAT || cls[i] === C.WET) && !clearY[i] && to !== C.NAT && to !== C.WET) clearY[i] = yr; setC(i, to); } }
    function spotUpdate(sp, wArr, F, ramp) {
      for (var q = 0; q < sp.length; q++) { var w = yr >= sp[q].y ? sstep(sp[q].y, sp[q].y + ramp, yr) : 0, dw = w - wArr[q]; if (!dw) continue; wArr[q] = w; var ii = sp[q].i, ff = sp[q].f; for (var j = 0; j < ii.length; j++) F[ii[j]] += dw * ff[j]; }
    }

    function step() {
      var y = yr, m, need, got;
      for (t = 0; t < NT; t++) if (!active[t] && y >= TOWNS[t][3]) { active[t] = 1; for (i = 0; i < n; i++) { var dd = S.distTo(i, TOWNS[t][1], TOWNS[t][2]); if (dd < dmin[i]) dmin[i] = dd; } }
      if (y === Y0) { // 1840 urban seeds
        [1, 2].forEach(function (t) { var tc = S.townCells[t], td = S.townDist[t], bi = -1, bd = 1e9; for (var j = 0; j < tc.length; j++) if (td[j] < bd && cls[tc[j]] !== C.LAKE && okDest(tc[j], C.URB)) { bd = td[j]; bi = tc[j]; } if (bi >= 0) { setC(bi, C.URB); townOf[bi] = t; } });
        return;
      }
      spotUpdate(S.cropSpots, cropW, cropF, 25); spotUpdate(S.pineSpots, pineW, pineF, 15);
      var Ls = 12 + 90 * sstep(1845, 1935, y) + 40 * sstep(1950, 1990, y);
      var coastB = 0.25 * (1 - sstep(1860, 1920, y)), CO = S.coast;
      var A = function (i) { var d = dmin[i]; return acw * Math.exp(-d / Ls) + (CO[i] < 8 ? coastB : 0); };
      var irr = sstep(1985, 2015, y);
      var dSuit = function (i) { var wetOK = 1 - S.dry[i] * (1 - irr); return 1.6 * flat(i) * low(i) * (0.4 + wetOK) + 1.2 * cn * frac(i, IS[C.DAIRY]) + 0.5 * A(i) - (S.si[i] ? 0.45 * (1 - irr) - 0.35 * irr : 0) + (S.el[i] > 500 ? -1 : 0) - (S.lat[i] > -36.2 ? 0.4 * sstep(1950, 1990, y) : 0); };
      var hpNow = function (i) { return y > E0 ? cur[i] === HPG : dest[i] === HPG; };

      if (anchor && y > E0) {
        // observed era: spread each LCDB change over its interval, nearest-neighbour first
        var e = 0; while (e < NE - 1 && y > OY[e + 1]) e++;
        if (e < NE - 1) {
          var Lst = trans[e], A0 = OY[e], B0 = OY[e + 1], done = 0, left = 0;
          if (y === A0 + 1) for (var j = 0; j < Lst.length; j++) pend[Lst[j]] = 1;
          for (j = 0; j < Lst.length; j++) if (pend[Lst[j]]) left++;
          var want = Math.round(Lst.length * (y - A0) / (B0 - A0)) - (Lst.length - left);
          if (want > 0) {
            m = 0; var f3 = S.pn[3];
            for (j = 0; j < Lst.length; j++) { i = Lst[j]; if (!pend[i]) continue; var to = obs[(e + 1) * n + i], ts = to === HPG ? GRASS : IS[to]; cand[m] = i; pot[m] = 1.6 * cn * frac(i, ts) + f3[i] * sig * 2.2 + noiseT[(m * 7 + y * 131) & (NTAB - 1)] * sig; m++; }
            got = pickTop(cand, pot, m, want);
            for (j = 0; j < got.length; j++) { i = got[j]; pend[i] = 0; var code = obs[(e + 1) * n + i]; cur[i] = code; var nc = dispOf(code, cls[i]); if ((cls[i] === C.NAT || cls[i] === C.WET) && !clearY[i] && nc !== C.NAT && nc !== C.WET) clearY[i] = y; setC(i, nc); }
          }
        }
        dairyStep();
        return;
      }

      // 1. urban
      if (anchor) {
        for (t = 0; t <= NT; t++) {
          if (!footCount[t]) continue;
          var g = t < NT ? Math.min(1, Math.pow(townPop(TOWNS[t], y) / Math.max(0.05, townPop(TOWNS[t], E0)), 0.9)) : interp(DEM.URB, y) / interp(DEM.URB, E0);
          var fp = foot[t], have = 0; for (j = 0; j < fp.length; j++) if (cls[fp[j]] === C.URB) have++;
          need = (y === E0 ? fp.length : Math.round(fp.length * g)) - have; if (need <= 0) continue;
          var tx = t < NT ? TOWNS[t][1] : 0, ty = t < NT ? TOWNS[t][2] : 0, rad = 2 + 1.25 * Math.sqrt(fp.length * S.CELL * S.CELL);
          m = 0; for (j = 0; j < fp.length; j++) { i = fp[j]; if (cls[i] === C.URB) continue; cand[m] = i; pot[m] = 2.2 * cn * frac(i, IS[C.URB]) - (t < NT ? S.distTo(i, tx, ty) / rad : -A(i)) + 0.6 * flat(i) + gauss() * sig * 0.8; m++; }
          convert(pickTop(cand, pot, m, need), C.URB);
        }
      } else {
        var tot = tgt(C.URB, y), pops = [], ps = 0, haveT = new Int32Array(NT);
        for (t = 0; t < NT; t++) { var pp = active[t] ? Math.pow(townPop(TOWNS[t], y), 0.9) : 0; pops.push(pp); ps += pp; }
        for (i = 0; i < n; i++) if (cls[i] === C.URB && townOf[i] >= 0) haveT[townOf[i]]++;
        for (t = 0; t < NT; t++) {
          var wantT = Math.round(tot * pops[t] / ps) - haveT[t]; if (wantT <= 0) continue;
          var tc = S.townCells[t], td = S.townDist[t], rad2 = 2 + 1.25 * Math.sqrt((haveT[t] + wantT) * S.CELL * S.CELL);
          m = 0; for (j = 0; j < tc.length; j++) { i = tc[j]; if (cls[i] === C.URB || cls[i] === C.LAKE || cls[i] === C.ALP) continue; cand[m] = i; pot[m] = 2.2 * cn * frac(i, IS[C.URB]) - td[j] / rad2 + 0.6 * flat(i) - (cls[i] === C.NAT ? 0.3 : 0) + gauss() * sig * 0.8; m++; }
          got = pickTop(cand, pot, m, wantT); convert(got, C.URB); for (j = 0; j < got.length; j++) townOf[got[j]] = t;
        }
      }
      // 2. plantation forestry
      need = tgt(C.PINE, y) - cnt[C.PINE];
      var pSuit = function (i) { return 1.4 * pineF[i] + 0.95 * hill(i) * sstep(1960, 1990, y) + 1.4 * cn * frac(i, IS[C.PINE]) - (S.el[i] > 1000 ? 2 : 0) - 0.4 * flat(i) * low(i); };
      var natOK = y > 1955 && y < 1985;
      if (need > 0) { m = gather(natOK ? T_PINEN : T_PINE, function (i) { return (cls[i] !== C.NAT || anchor || S.protY[i] > y) && okDest(i, C.PINE); }, function (i) { return pSuit(i) + (cls[i] === C.NAT ? -0.5 : 0) + (cls[i] === C.SCRUB ? 0.2 : 0); }, 2, need); convert(pickTop(cand, pot, m, need), C.PINE); }
      else if (need < 0) { m = gather(IS[C.PINE], anchor ? function (i) { return dest[i] !== C.PINE; } : null, function (i) { return -pSuit(i) + dSuit(i) * 0.5; }, 0, -need); convert(pickTop(cand, pot, m, -need), C.SHEEP); }
      // 3. native forest clearance
      need = cnt[C.NAT] - tgt(C.NAT, y);
      if (need > 0) { m = gather(IS[C.NAT], anchor ? function (i) { return dest[i] !== C.NAT; } : function (i) { return S.protY[i] > y; }, function (i) { return 1.3 * A(i) + 1.1 * cn * frac(i, DEV) + 0.7 * flat(i) + 0.7 * low(i) + (S.si[i] ? -0.35 : 0.15) - (S.si[i] && S.dry[i] < 0.1 && S.lon[i] < 171.8 ? 0.6 : 0); }, 0, need);
        convert(pickTop(cand, pot, m, need), C.SHEEP); }
      // 4. wetland drainage
      need = cnt[C.WET] - tgt(C.WET, y);
      if (need > 0) { m = gather(IS[C.WET], anchor ? function (i) { return dest[i] !== C.WET; } : null, function (i) { return 1.4 * A(i) + 1.0 * cn * frac(i, DEV) + 0.5 * flat(i); }, 0, need); convert(pickTop(cand, pot, m, need), C.SHEEP); }
      // 5. tussock improvement
      need = cnt[C.TUSS] - tgt(C.TUSS, y);
      if (need > 0) { m = gather(IS[C.TUSS], anchor ? function (i) { return dest[i] !== C.TUSS; } : null, function (i) { return A(i) + 0.8 * flat(i) + 1.2 * low(i) + 0.8 * cn * frac(i, GRASS) + S.plateau[i] * 0.4; }, 0, need); convert(pickTop(cand, pot, m, need), C.SHEEP); }
      // 6. Māori gardens alienated
      if (y >= 1850 && y <= 1900) for (i = 0; i < n; i++) if (origin[i] === 1 && cls[i] === C.CROP && !(anchor && dest[i] === C.CROP) && (rnd() < 0.06 || y === 1900)) { setC(i, C.SHEEP); origin[i] = 0; }
      var keep = function (i) { return 1.2 * flat(i) + 1.0 * low(i) + A(i) + 0.8 * cn * frac(i, GRASS) - (S.si[i] && S.dry[i] < 0.1 ? 0.3 : 0); };
      // 7. fernland and scrub cleared for pasture (anchored: scrub not in LCDB 1996 must go by then)
      if (anchor && y < E0) {
        var left0 = fernLeft, r = interp(DEM.NAT, y), r0 = interp(DEM.NAT, E0);
        need = left0 - Math.round(fern0 * (1 - (1 - r) / (1 - r0)));
        if (need > 0) { m = gather(IS[C.SCRUB], function (i) { return dest[i] !== C.SCRUB; }, keep, 3, need); convert(pickTop(cand, pot, m, need), C.SHEEP); }
      }
      // 8. sheep & beef vs scrub reversion
      var sT = y < E0 ? Math.round(interp(SF, y) * (cnt[C.SHEEP] + cnt[C.SCRUB])) : tgt(C.SCRUB, y);
      need = sT - cnt[C.SCRUB];
      if (need > 0) { m = gather(IS[C.SHEEP], anchor ? function (i) { return dest[i] === C.SCRUB; } : null, function (i) { return -keep(i) + 0.6 * cn * frac(i, IS[C.SCRUB]); }, 3, need); convert(pickTop(cand, pot, m, need), C.SCRUB); }
      else if (need < 0) { m = gather(IS[C.SCRUB], anchor ? function (i) { return dest[i] !== C.SCRUB; } : null, keep, 3, -need); convert(pickTop(cand, pot, m, -need), C.SHEEP); }
      // 9. dairy
      dairyStep();
      // 10. cropping & horticulture
      need = tgt(C.CROP, y) - cnt[C.CROP];
      var cSuit = function (i) { return 1.2 * flat(i) * low(i) * (0.6 + 0.6 * S.dry[i]) + 1.3 * cropF[i] + 1.0 * cn * frac(i, IS[C.CROP]) + 0.4 * A(i); };
      if (need > 0) { m = gather(T_CROP, function (i) { return origin[i] !== 1 && okDest(i, C.CROP); }, cSuit, 0, need); convert(pickTop(cand, pot, m, need), C.CROP); }
      else if (need < 0) { m = gather(IS[C.CROP], anchor ? function (i) { return dest[i] !== C.CROP; } : null, function (i) { return -cSuit(i) + (origin[i] === 1 ? 2 : 0); }, 0, -need); var gl = pickTop(cand, pot, m, -need); convert(gl, C.SHEEP); gl.forEach(function (i) { origin[i] = 0; }); }

      // first LCDB epoch: force every cell to its observed class
      if (anchor && y === E0) {
        for (i = 0; i < n; i++) {
          var want2 = dispOf(dest[i], cls[i]);
          if (want2 !== cls[i]) { snapped++; if ((cls[i] === C.NAT || cls[i] === C.WET) && !clearY[i] && want2 !== C.NAT && want2 !== C.WET) clearY[i] = y; setC(i, want2); }
          cur[i] = dest[i];
        }
        dairyStep();
      }
    }
    function dairyStep() {
      var y = yr, m, need = tgtDairy(y) - cnt[C.DAIRY];
      var irr = sstep(1985, 2015, y), Ls = 12 + 90 * sstep(1845, 1935, y) + 40 * sstep(1950, 1990, y);
      var dS = function (i) { var wetOK = 1 - S.dry[i] * (1 - irr), A = acw * Math.exp(-dmin[i] / Ls); return 1.6 * flat(i) * low(i) * (0.4 + wetOK) + 1.2 * cn * frac(i, IS[C.DAIRY]) + 0.5 * A - (S.si[i] ? 0.45 * (1 - irr) - 0.35 * irr : 0) + (S.el[i] > 500 ? -1 : 0) - (S.lat[i] > -36.2 ? 0.4 * sstep(1950, 1990, y) : 0); };
      var ts = anchor ? IS[C.SHEEP] : y > 2003 ? T_DAIRYF3 : irr > 0.2 ? T_DAIRYF2 : T_DAIRYF;
      var dfn = anchor ? (y >= E0 ? function (i) { return cur[i] === HPG; } : function (i) { return dest[i] === HPG; }) : null;
      if (need > 0) { m = gather(ts, dfn, function (i) { return dS(i) + (cls[i] === C.PINE ? -0.2 : 0); }, 1, need); convert(pickTop(cand, pot, m, need), C.DAIRY); }
      else if (need < 0) { m = gather(IS[C.DAIRY], null, function (i) { return -dS(i); }, 0, -need); convert(pickTop(cand, pot, m, -need), C.SHEEP); }
    }

    var agree = [];
    var res = { snaps: snaps, counts: counts, clearY: clearY, total: total, n: n, anchor: anchor, obsYears: OY, snapped: 0, agree: agree, upTo: Y0 - 1,
      init: { nat: nNAT0, wet: nWET0, tuss: nTUSS0, scrub: nSCRUB0, alp: nALP } };
    // time-sliced so a page can start playing early years while later ones are computed
    function loop() {
      var t0 = Date.now();
      while (yr <= Y1) {
        step();
        snaps.set(cls, (yr - Y0) * n);
        counts.push(Int32Array.from(cnt));
        var ei = OY.indexOf(yr); if (ei >= 0) agree.push({ year: yr, a: agreement(cls, obs.subarray(ei * n, (ei + 1) * n), n) });
        res.upTo = yr; res.snapped = snapped; yr++;
        if (!params.sync && Date.now() - t0 > (params.slice || 35)) break;
      }
      if (onProgress) onProgress((yr - Y0) / years, res);
      if (yr <= Y1) setTimeout(loop, 0); else onDone(res);
    }
    loop();
  }

  return { C: C, HPG: HPG, Y0: Y0, Y1: Y1, build: build, run: run, TOWNS: TOWNS, DEM: DEM, agreement: agreement, townPop: townPop };
})();
if (typeof module !== 'undefined') module.exports = NZModel;
