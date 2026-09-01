// Reduce /google-docs to the documents the participant actually OWNS.
//
// Shared-with-me documents are unlinked from the parent's children; their
// layers and bodies remain content-addressed and history keeps the prior
// membership, so this is reversible.
//
// Membership is read from `layer-at` + resolving each child sig to its name.
// NOT from `list-at`: that op answers for the RENDERER'S CURRENT LOCATION and
// returns an empty array (or "path not found") for a populated branch the
// renderer is not standing in — which would read as "no children" and silently
// turn a prune into a wipe.
const WebSocket=require('ws');let n=0;
const once=(req)=>new Promise((res,rej)=>{const ws=new WebSocket('ws://localhost:2401');const t=setTimeout(()=>{try{ws.close()}catch{};rej(new Error('bridge timeout'))},30000);
ws.on('open',()=>ws.send(JSON.stringify({...req,id:'pr'+(++n)})));
ws.on('message',(raw)=>{clearTimeout(t);const p=JSON.parse(String(raw));try{ws.close()}catch{};p.ok?res(p.data):rej(new Error(p.error))});
ws.on('error',e=>{clearTimeout(t);rej(e)})});
const bridge=async(req,tries=30)=>{for(let i=0;;i++){try{return await once(req)}catch(e){if(!/no renderer|timeout/i.test(e.message)||i>=tries)throw e;await new Promise(r=>setTimeout(r,4000))}}};

// Child names come from the ONE shared implementation
// (scripts/lib/hive-children.mjs). These loops decoded them with
// `get-resource`, which CANNOT work: a parent's `children` slot holds LAYER
// sigs, and a layer sig is not a resource, so every name came back null.
// `bridge` here resolves to the payload and throws on error, so it is wrapped
// into the {ok,data,error} envelope the module expects.
const asSend = async (req) => {
  try { return { ok: true, data: await bridge(req) } }
  catch (e) { return { ok: false, error: e.message } }
}
let namesOfChildSigs
async function bindHiveHelpers() {
  const { hiveChildren } = await import('../lib/hive-children.mjs')
  ;({ namesOfChildSigs } = hiveChildren(asSend))
}

async function childNames(segments){
  const L=await bridge({op:'layer-at',segments});
  return {layer:L,names:await namesOfChildSigs(L.children||[],'/'+segments.join('/'))};
}
const KEEP=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const DRY=process.argv.includes('--dry');
(async()=>{
  await bindHiveHelpers();
  const {names}=await childNames(['google-docs']);
  console.log('before:',names.length,'tiles');
  const unresolved=names.filter(x=>!x).length;
  if(unresolved){console.error('ABORT:',unresolved,'child sig(s) would not resolve — refusing to rewrite membership');process.exit(1)}
  for(const k of KEEP){
    if(!names.includes(k)){console.error('ABORT: keep-name not present:',k);process.exit(1)}
    const L=await bridge({op:'layer-at',segments:['google-docs',k]});
    console.log('  preflight',k,'-> slots:',Object.keys(L).join(','));
  }
  console.log('removing',names.length-KEEP.length,'tile(s); keeping',KEEP.join(', '));
  if(DRY){console.log('dry run, nothing written');return}
  await bridge({op:'update',segments:['google-docs'],layer:{name:'google-docs',children:KEEP}});
  const after=await childNames(['google-docs']);
  console.log('after:',after.names.length,'tiles ->',after.names.join(', '));
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1)});
