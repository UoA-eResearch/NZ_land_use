const topo=require('./node_modules/world-atlas/countries-10m.json');
const {feature}=require('topojson-client');
const f=feature(topo,topo.objects.countries).features.find(d=>d.id==='554');
let polys=f.geometry.type==='MultiPolygon'?f.geometry.coordinates:[f.geometry.coordinates];
// keep main islands
polys=polys.filter(p=>{const r=p[0];let mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9;for(const [x,y] of r){mnx=Math.min(mnx,x);mxx=Math.max(mxx,x);mny=Math.min(mny,y);mxy=Math.max(mxy,y);}
 return mnx>165&&mxx<179&&mny>-48&&mxy<-34 && r.length>3;});
const LAT0=-41,LON0=166.3,LATTOP=-34.3,K=Math.cos(LAT0*Math.PI/180)*111.32,KY=110.57,CELL=2.5;
const W=Math.ceil((178.7-LON0)*K/CELL),H=Math.ceil((LATTOP+47.4)*KY/CELL);
const px=lon=>(lon-LON0)*K/CELL, py=lat=>(LATTOP-lat)*KY/CELL;
const mask=new Uint8Array(W*H);
// scanline fill
const rings=[];for(const p of polys)for(const r of p)rings.push(r.map(([x,y])=>[px(x),py(y)]));
for(let j=0;j<H;j++){const yc=j+0.5;const xs=[];
 for(const r of rings)for(let i=0;i<r.length-1;i++){const [x1,y1]=r[i],[x2,y2]=r[i+1];if((y1<=yc)!==(y2<=yc)){xs.push(x1+(yc-y1)/(y2-y1)*(x2-x1));}}
 xs.sort((a,b)=>a-b);for(let k=0;k+1<xs.length;k+=2){for(let i=Math.max(0,Math.ceil(xs[k]-0.5));i<Math.min(W,Math.ceil(xs[k+1]-0.5));i++)mask[j*W+i]=1;}}
let n=0;for(const v of mask)n+=v;
// bitset b64
const bytes=new Uint8Array(Math.ceil(W*H/8));for(let i=0;i<W*H;i++)if(mask[i])bytes[i>>3]|=1<<(i&7);
// coastline path, simplified: keep rings with >20 pts after rounding, drop near-duplicate pts
let path='';let pts=0;for(const r of rings){let last=null,s='';let c=0;for(const [x,y] of r){const X=Math.round(x*4)/4,Y=Math.round(y*4)/4;if(last&&Math.hypot(X-last[0],Y-last[1])<1.2)continue;s+=(c?'L':'M')+X+' '+Y;last=[X,Y];c++;}if(c>=4){path+=s+'Z';pts+=c;}}
require('fs').writeFileSync('grid.json',JSON.stringify({W,H,CELL,LAT0,LON0,LATTOP,K,KY,mask:Buffer.from(bytes).toString('base64'),coast:path}));
console.log(W,H,n,n*CELL*CELL,'km2',polys.length,'polys',pts,'pts',path.length, Buffer.from(bytes).toString('base64').length);
