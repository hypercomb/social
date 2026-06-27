#!/usr/bin/env node
// Does activating one of the NEW themed substrate sets render tiles white?
const { chromium } = require('playwright')
const WebSocket = require('ws')
const path = require('path')
const PROFILE = path.join(require('os').tmpdir(), 'hc-ai-inside', '.test-profile')
const URL = 'http://localhost:4250/?claudeBridge=1'
const sleep = ms => new Promise(r => setTimeout(r, ms))
function bridge(req, to=15000){ return new Promise(res=>{ const ws=new WebSocket('ws://localhost:2401'); let done=false; const id='th-'+Math.floor(performance.now()); const t=setTimeout(()=>{if(done)return;done=true;try{ws.close()}catch{};res({ok:false,error:'timeout'})},to); ws.on('open',()=>ws.send(JSON.stringify({...req,id}))); ws.on('message',r=>{if(done)return;done=true;clearTimeout(t);let m;try{m=JSON.parse(String(r))}catch{m={ok:false}};try{ws.close()}catch{};res(m)}); ws.on('error',e=>{if(done)return;done=true;clearTimeout(t);res({ok:false,error:e.code})}) }) }

async function main(){
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, viewport:{width:1440,height:900} })
  const page = ctx.pages()[0] || await ctx.newPage()
  const shot = async n => { try{ await page.screenshot({ path: path.join(__dirname,n), timeout:9000 }); console.log('   shot',n) }catch(e){ console.log('   (shot skip)') } }

  await page.goto(URL, { waitUntil:'domcontentloaded' }); await sleep(8000)
  for (let i=0;i<10;i++){ const r=await bridge({op:'list-at',segments:[]}); if(r.ok) break; await sleep(1500) }
  await bridge({op:'add', segments:[], cells:['alpha','beta','gamma','delta','epsilon','zeta']})
  await sleep(2000); await page.reload({ waitUntil:'domcontentloaded' }); await sleep(7000)

  // set active directly to each themed set via the service, then re-fill + screenshot
  for (const id of ['builtin:theme-minimal','builtin:theme-geometric','builtin:theme-abstract','builtin:theme-nature','builtin:defaults']) {
    const r = await page.evaluate(async (sid) => {
      const s = window.ioc?.get?.('@diamondcoreprocessor.com/SubstrateService'); if(!s) return 'no-service'
      try { await s.setActive(sid); return 'active=' + s.registry?.activeId } catch(e){ return 'err '+e.message }
    }, id)
    await page.reload({ waitUntil:'domcontentloaded' }); await sleep(7000)
    console.log(id, '→', r)
    await shot('_themed-' + id.replace('builtin:','') + '.png')
  }
  await ctx.close(); process.exit(0)
}
main().catch(e=>{ console.error(e); process.exit(1) })
