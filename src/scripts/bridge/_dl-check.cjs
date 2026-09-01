const WebSocket=require('ws');const fs=require('fs'),path=require('path');const DIR=process.env.DP_DIR||__dirname;let n=0;
const send=q=>new Promise((res,rej)=>{const ws=new WebSocket('ws://localhost:2401');const t=setTimeout(()=>{try{ws.close()}catch{};rej(new Error('t'))},40000);
ws.on('open',()=>ws.send(JSON.stringify({...q,id:'dc'+(++n)})));ws.on('message',r=>{clearTimeout(t);let p=null;try{p=JSON.parse(String(r))}catch{};try{ws.close()}catch{};res(p)});ws.on('error',e=>{clearTimeout(t);rej(e)})});
const ok=async(q,w)=>{const r=await send(q);if(!r||r.ok===false)throw new Error(w+': '+(r&&r.error));return r.data};
const W='division-live';const P=['live-hub','live-intake','live-compressor','live-combustor','live-turbine','live-nozzle','live-casing'];
(async()=>{
 const wl=await ok({op:'layer-at',segments:[W]},'w');
 for(const s of (wl.decorations||[])){try{const d=JSON.parse((await ok({op:'get-resource',sig:s},'d')).text);
   if(d.kind==='visual:division:plan')console.log('FRAME payload:',JSON.stringify(d.payload));
   if(d.kind==='visual:division:artifact')console.log('FACE :',d.payload.meaning)}catch{}}
 const wp=JSON.parse((await ok({op:'get-resource',sig:(wl.properties||[])[0]},'wp')).text);
 const wimg=wp.large?.image??wp.small?.image;
 console.log('whole picture:',String(wimg).slice(0,12)+'…');
 const seen=new Set();
 for(let k=0;k<P.length;k++){const L=await ok({op:'layer-at',segments:[W,P[k]]},'l');
  let order='—';for(const s of (L.decorations||[])){try{const d=JSON.parse((await ok({op:'get-resource',sig:s},'d')).text);if(d.kind==='group')order=d.payload.order}catch{}}
  const pr=JSON.parse((await ok({op:'get-resource',sig:(L.properties||[])[0]},'p')).text);
  const img=pr.large?.image??pr.small?.image;seen.add(img);
  const b=await ok({op:'get-resource',sig:img,text:'base64'},'b');
  fs.writeFileSync(path.join(DIR,`live-${k}-${P[k]}.webp`),Buffer.from(b.base64||b.text,'base64'));
  console.log(`  ${k} ${P[k].padEnd(17)} order=${order} index=${pr.index??'—'} pic=${String(img).slice(0,12)}…`)}
 console.log('distinct:',seen.size+'/'+P.length, seen.has(wimg)?'— WHOLE REUSED':'— none is the whole\'s');
})().catch(e=>console.error('FAILED:',e.message))
