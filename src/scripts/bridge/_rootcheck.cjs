const WebSocket=require('ws');let n=0;
const once=(req)=>new Promise((res,rej)=>{const ws=new WebSocket('ws://localhost:2401');const t=setTimeout(()=>{try{ws.close()}catch{};rej(new Error('bridge timeout'))},30000);
ws.on('open',()=>ws.send(JSON.stringify({...req,id:'rc'+(++n)})));
ws.on('message',(raw)=>{clearTimeout(t);const p=JSON.parse(String(raw));try{ws.close()}catch{};p.ok?res(p.data):rej(new Error(p.error))});
ws.on('error',e=>{clearTimeout(t);rej(e)})});
const bridge=async(req,tries=30)=>{for(let i=0;;i++){try{return await once(req)}catch(e){if(!/no renderer|timeout/i.test(e.message)||i>=tries)throw e;await new Promise(r=>setTimeout(r,4000))}}};
(async()=>{
  const L=await bridge({op:'layer-at',segments:[]});
  const sigs=L.children||[];
  const names=[];const bad=[];
  for(const s of sigs){ try{names.push(JSON.parse((await bridge({op:'get-resource',sig:s})).text).name)}catch(e){bad.push(s.slice(0,10))} }
  console.log('root children sigs:',sigs.length,'| resolved:',names.length,'| UNRESOLVED:',bad.length);
  console.log('names:',names.join(', '));
  const counts={};names.forEach(x=>counts[x]=(counts[x]||0)+1);
  console.log('duplicates:',JSON.stringify(Object.fromEntries(Object.entries(counts).filter(([,c])=>c>1))));
})().catch(e=>console.error('FAILED:',e.message));
