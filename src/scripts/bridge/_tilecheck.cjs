const WebSocket=require('ws');let n=0;
const once=(req)=>new Promise((res,rej)=>{const ws=new WebSocket('ws://localhost:2401');const t=setTimeout(()=>{try{ws.close()}catch{};rej(new Error('bridge timeout'))},30000);
ws.on('open',()=>ws.send(JSON.stringify({...req,id:'tc'+(++n)})));
ws.on('message',(raw)=>{clearTimeout(t);const p=JSON.parse(String(raw));try{ws.close()}catch{};p.ok?res(p.data):rej(new Error(p.error))});
ws.on('error',e=>{clearTimeout(t);rej(e)})});
const bridge=async(req,tries=30)=>{for(let i=0;;i++){try{return await once(req)}catch(e){if(!/no renderer|timeout/i.test(e.message)||i>=tries)throw e;await new Promise(r=>setTimeout(r,4000))}}};
(async()=>{
  const S=['google-docs','jaime-wiese-resume'];
  const L=await bridge({op:'layer-at',segments:S});
  console.log('slots:',Object.keys(L).join(', '));
  const props=JSON.parse((await bridge({op:'get-resource',sig:L.properties[0]})).text);
  console.log('link :',props.link);
  console.log('tags :',JSON.stringify(props.tags));
  console.log('title:',props.title);
  const body=await bridge({op:'get-resource',sig:L.document[0]});
  console.log('body :',(body.text||'').length,'chars |',JSON.stringify((body.text||'').slice(0,60)));
  console.log('decorations:',(L.decorations||[]).length,'| notes:',(L.notes||[]).length);
})().catch(e=>console.error('FAILED:',e.message));
