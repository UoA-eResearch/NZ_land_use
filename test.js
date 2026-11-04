// Run the model in node and report: class shares by decade, agreement with LCDB,
// timings, and preview PNGs at 1840/1900/1950/2025.
// Usage: node test.js [grid.json] [anchored|free] [outdir] [seed]
const fs = require('fs'), zlib = require('zlib');
const M = require('./model.js');
const gp = process.argv[2] || './grid.json', mode = process.argv[3] || 'anchored', out = process.argv[4] || 'shots', seed = +(process.argv[5] || 1);
const g = JSON.parse(fs.readFileSync(gp, 'utf8'));
let t = Date.now(); const S = M.build(g); console.log(`grid ${S.W}x${S.H} @ ${S.CELL} km, ${S.n} cells; build ${Date.now() - t} ms`);
t = Date.now();
const names = ['SEA', 'NAT', 'SCRUB', 'TUSS', 'WET', 'ALP', 'SHEEP', 'DAIRY', 'PINE', 'CROP', 'URB', 'LAKE'];
const COL = { 1: '#2f5d3a', 2: '#8d904c', 3: '#d6bf78', 4: '#3f9c9a', 5: '#dfe3e6', 6: '#b3cf78', 7: '#45ad46', 8: '#1f4a5e', 9: '#d8952f', 10: '#c23b2a', 11: '#7fa6c2' };
const rgb = h => [1, 3, 5].map(k => parseInt(h.substr(k, 2), 16));

function png(file, w, h, px) { // px: Uint8Array w*h*3
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(px.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = ~0; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (~c) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

M.run(S, { seed, sync: true, anchor: mode !== 'free' }, r => {
  console.log(`run (${r.anchor ? 'anchored' : 'free'}) ${Date.now() - t} ms; 1840 init: ` + Object.entries(r.init).map(([k, v]) => `${k} ${(v / r.total * 100).toFixed(1)}%`).join(' '));
  if (r.anchor) console.log(`cells forced to LCDB at ${r.obsYears[0]}: ${r.snapped} (${(r.snapped / r.n * 100).toFixed(2)}%)`);
  const yrs = [1840, 1850, 1860, 1870, 1880, 1890, 1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 1996, 2001, 2008, 2012, 2018, 2023, 2025];
  console.log('year  ' + names.slice(1).map(s => s.padStart(6)).join(''));
  for (const y of yrs) { const c = r.counts[y - 1840]; console.log(y + '  ' + names.slice(1).map((nm, i) => (c[i + 1] / r.total * 100).toFixed(1).padStart(6)).join('')); }
  console.log('agreement with LCDB (grassland merged): ' + r.agree.map(a => `${a.year} ${a.a.pc.toFixed(1)}% k=${a.a.kappa.toFixed(3)}`).join(' | '));
  fs.mkdirSync(out, { recursive: true });
  const sh = new Float32Array(S.n); for (let i = 0; i < S.n; i++) sh[i] = Math.max(0.55, Math.min(1.22, 0.66 + 0.55 * S.shade[S.cells[i]]));
  for (const y of [1840, 1900, 1950, 1996, 2025]) {
    const px = new Uint8Array(S.W * S.H * 3).fill(0); for (let k = 0; k < S.W * S.H; k++) { px[k * 3] = 211; px[k * 3 + 1] = 224; px[k * 3 + 2] = 227; }
    for (let i = 0; i < S.n; i++) { const c = r.snaps[(y - 1840) * S.n + i], col = rgb(COL[c]), k = S.cells[i] * 3; for (let q = 0; q < 3; q++) px[k + q] = Math.min(255, col[q] * sh[i]); }
    png(`${out}/${mode}_${y}.png`, S.W, S.H, px);
  }
  console.log('previews in ' + out);
});
