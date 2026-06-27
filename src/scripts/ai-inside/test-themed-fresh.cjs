#!/usr/bin/env node
// Definitive: set each themed set active, then create FRESH tiles (no prior
// image) so they fill from that set. Screenshot per set.
const { chromium } = require('playwright')
const WebSocket = require('ws')
const path = require('path')
const PROFILE = path.join(require('os').tmpdir(), 'hc-ai-inside', '.test-profile-fresh')
const URL = 'http://localhost:4250/?claudeBridge=1'
const sleep = ms => new Promise(r => setTimeout(r, ms))
function bridge(req, to=15000){ return new Promise(res=>{ const ws=new WebSocket('ws://localhost:2401'); let done=false; const id='tf-'+Math.floor(performance.now()); const t=setTimeout(()=>{if(done)return;done=true;try{ws.close()}catch{};res({ok:false,error:'timeout'})},to); ws.on('open',()=>ws.send(JSON.stringify({...req,id}))); ws.on('message',r=>{if(done)return;done=true;clearTimeout(t);let m;try{m=JSON.parse(String(r))}catch{m={ok:false}};try{ws.close()}catch{};res(m)}); ws.on('error',e=>{if(done)return;done=true;clearTimeout(t);res({ok:false,error:e.code})}) }) }

const SETS = [
  ['builtin:theme-minimal','min'], ['builtin:theme-geometric','geo'],
  ['builtin:theme-abstract','abs'], ['builtin:theme-nature','nat'], ['builtin:defaults','pho'],
]

async function main(){
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, viewport:{width:1280,height:820} })
  const page = ctx.pages()[0] || await ctx.newPage()
  const shot = async n => { try{ await page.screenshot({ path: path.join(__dirname,n), timeout:9000 }); console.log('   shot',n) }catch(e){ console.log('   (shot skip)') } }
  await page.goto(URL, { waitUntil:'domcontentloaded' }); await sleep(8000)
  for (let i=0;i<10;i++){ const r=await bridge({op:'list-at',segments:[]}); if(r.ok) break; await sleep(1500) }

  for (const [id, pfx] of SETS) {
    const setRes = await page.evaluate(async (sid)=>{ const s=window.ioc?.get?.('@diamondcoreprocessor.com/SubstrateService'); if(!s)return 'no-svc'; try{ await s.setActive(sid); return s.registry?.activeId }catch(e){ return 'err '+e.message } }, id)
    // fresh tiles named per set so they have NO prior image -> fill from active set
    const cells = [pfx+'1', pfx+'2', pfx+'3', pfx+'4']
    await bridge({ op:'add', segments:[], cells })
    await sleep(4500) // allow substrate fill
    await page.reload({ waitUntil:'domcontentloaded' }); await sleep(7000)
    console.log(id, '→ active', setRes)
    await shot('_fresh-'+pfx+'.png')
  }
  await ctx.close(); process.exit(0)
}
main().catch(e=>{ console.error(e); process.exit(1) })
