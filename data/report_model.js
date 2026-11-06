// Decade snapshots of the default anchored model run (seed 1) for the location report.
// Usage: node data/report_model.js grid.json report/data/model.bin
// Output: zlib( JSON header length u32 LE | JSON header | u8 rasters ), each raster W*H row-major,
// 255 = sea. Rasters: one per year in header.years (model class codes, see model.js), then the year
// a cell's 1840 forest or wetland was cleared (0 = never, else year - 1800).
const fs = require('fs'), zlib = require('zlib');
const M = require('../model.js');
const [gridPath, outPath] = process.argv.slice(2);
const g = JSON.parse(fs.readFileSync(gridPath, 'utf8'));
const S = M.build(g);
M.run(S, { seed: 1, sync: true, anchor: true }, r => {
  const years = []; for (let y = 1840; y <= 1990; y += 10) years.push(y); years.push(1995);
  const WH = S.W * S.H, buf = new Uint8Array(WH * (years.length + 1)).fill(255);
  years.forEach((y, k) => { const o = (y - M.Y0) * S.n; for (let i = 0; i < S.n; i++) buf[k * WH + S.cells[i]] = r.snaps[o + i]; });
  const kc = years.length * WH; for (let i = 0; i < S.n; i++) buf[kc + S.cells[i]] = r.clearY[i] ? r.clearY[i] - 1800 : 0;
  const header = Buffer.from(JSON.stringify({ W: S.W, H: S.H, CELL: g.CELL, LON0: g.LON0, LATTOP: g.LATTOP, K: g.K, KY: g.KY, years, seed: 1, anchored: true }));
  const len = Buffer.alloc(4); len.writeUInt32LE(header.length);
  const out = zlib.deflateSync(Buffer.concat([len, header, Buffer.from(buf.buffer)]), { level: 9 });
  fs.writeFileSync(outPath, out);
  console.log(`${years.length} snapshots + clearance year, ${S.W}x${S.H}: ${(out.length / 1e6).toFixed(2)} MB`);
});
