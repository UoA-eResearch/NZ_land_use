const M=require('./model.js');const g=require('./grid.json');
let t=Date.now();const S=M.build(g);console.log('build',Date.now()-t,'ms n',S.n);
t=Date.now();
M.run(S,{seed:1,sync:true},r=>{console.log('run',Date.now()-t,'ms');
 const names=['SEA','NAT','SCRUB','TUSS','WET','ALP','SHEEP','DAIRY','PINE','CROP','URB','LAKE'];
 for(const y of [1840,1860,1880,1900,1920,1950,1980,2000,2025]){const c=r.counts[y-1840];console.log(y,names.slice(1).map((nm,i)=>nm+':'+(c[i+1]/r.total*100).toFixed(1)).join(' '));}
 const fs=require('fs');const out=Buffer.alloc(4*S.n*2+0);
 const yrs=[1840,1900,1950,2025];const buf=Buffer.alloc(S.W*S.H*yrs.length);
 yrs.forEach((y,k)=>{for(let i=0;i<S.n;i++)buf[k*S.W*S.H+S.cells[i]]=r.snaps[(y-1840)*S.n+i];});
 fs.writeFileSync('snaps.bin',buf);fs.writeFileSync('meta.json',JSON.stringify({W:S.W,H:S.H,yrs}));
 const e=Buffer.alloc(S.W*S.H*2);for(let i=0;i<S.n;i++)e.writeUInt16LE(Math.round(S.el[i]),S.cells[i]*2);fs.writeFileSync('elev.bin',e);
});
