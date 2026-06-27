// Read website pages back from the hive, validate, and export local previewable
// copies (chrome.css inlined) for screenshotting.
const fs=require('fs'); const path=require('path'); const WebSocket=require('ws')
const OUT=path.join(__dirname,'preview'); fs.mkdirSync(OUT,{recursive:true})
let ws,n=0; const pend=new Map()
function rpc(req){return new Promise(res=>{const id='vw-'+(++n);const t=setTimeout(()=>{pend.delete(id);res({ok:false,error:'timeout'})},12000);pend.set(id,m=>{clearTimeout(t);res(m)});ws.send(JSON.stringify({...req,id}))})}
async function getRes(sig){const r=await rpc({op:'get-resource',sig});if(!r.ok)return null;const d=r.data;return typeof d==='string'?d:(d&&d.text!=null?d.text:JSON.stringify(d))}
async function pageOf(segments){
  const la=await rpc({op:'layer-at',segments});if(!la.ok||!la.data.decorations)return {err:'no decorations'}
  for(const decSig of la.data.decorations){
    const raw=await getRes(decSig);if(!raw)continue;let rec;try{rec=JSON.parse(raw)}catch{continue}
    if(rec.kind==='visual:website:page'&&rec.payload&&rec.payload.htmlSig){
      const html=await getRes(rec.payload.htmlSig)
      return {decSig,htmlSig:rec.payload.htmlSig,icon:rec.payload.icon,label:rec.payload.label,html}
    }
  }
  return {err:'no website:page decoration among '+la.data.decorations.length}
}
ws=new WebSocket('ws://localhost:2401')
ws.on('message',raw=>{let m;try{m=JSON.parse(String(raw))}catch{return}const cb=pend.get(m.id);if(cb){pend.delete(m.id);cb(m)}})
ws.on('open',async()=>{
  const idx=await pageOf(['ai-inside'])
  const oa=await pageOf(['ai-inside','openai'])
  const nv=await pageOf(['ai-inside','nvidia'])
  for(const [name,p] of [['index',idx],['openai',oa],['nvidia',nv]]){
    if(p.err){console.log(name,'ERR:',p.err);continue}
    const checks={
      hasTitle:/\<title\>/.test(p.html),
      bytes:p.html.length,
      hasChromeLink:/resource:[0-9a-f]{64}\/chrome\.css/.test(p.html),
      hasBgDataUri:/background-image:url\(\"data:image\/svg/.test(p.html),
      hasHero:/class=\"hero\"/.test(p.html),
      links:(p.html.match(/href=\"\/ai-inside/g)||[]).length,
      icon:p.icon,label:p.label
    }
    console.log(name.padEnd(8),JSON.stringify(checks))
    // export previewable: inline chrome.css
    const chromeSig=(p.html.match(/resource:([0-9a-f]{64})\/chrome\.css/)||[])[1]
    let css=''; if(chromeSig){css=await getRes(chromeSig)||''}
    const local=p.html.replace(/<link rel=\"stylesheet\" href=\"resource:[0-9a-f]{64}\/chrome\.css\">/,`<style>${css}</style>`)
    fs.writeFileSync(path.join(OUT,name+'.html'),local)
  }
  console.log('\nexported preview HTML to',OUT)
  ws.close();process.exit(0)
})
ws.on('error',e=>{console.log('ERR',e.message);process.exit(1)})
