#!/usr/bin/env node
// Does a broken / non-tile-source active substrate make tiles render WHITE?
// Reproduce: set active to 'builtin:steel' (v2 leftover, no longer a tile
// source) and a bogus id, reload, screenshot. Compare to Photos.
const { chromium } = require('playwright')
const WebSocket = require('ws')
const path = require('path')
const PROFILE = path.join(require('os').tmpdir(), 'hc-ai-inside', '.test-profile')
const URL = 'http://localhost:4250/?claudeBridge=1'
const sleep = ms => new Promise(r => setTimeout(r, ms))
function bridge(req, to=12000){ return new Promise(res=>{ const ws=new WebSocket('ws://localhost:2401'); let done=false; const id='sw-'+Math.floor(performance.now()); const t=setTimeout(()=>{if(done)return;done=true;try{ws.close()}catch{};res({ok:false,error:'timeout'})},to); ws.on('open',()=>ws.send(JSON.stringify({...req,id}))); ws.on('message',r=>{if(done)return;done=true;clearTimeout(t);let m;try{m=JSON.parse(String(r))}catch{m={ok:false}};try{ws.close()}catch{};res(m)}); ws.on('error',e=>{if(done)return;done=true;clearTimeout(t);res({ok:false,error:e.code})}) }) }

async function setActiveAndReload(page, id){
  const r = await page.evaluate(async (sid) => {
    const s = window.ioc?.get?.('@diamondcoreprocessor.com/SubstrateService')
    if (!s) return 'no-service'
    try { await s.setActive(sid); return 'set ' + sid + ' (active now ' + (s.registry?.activeId) + ')' } catch(e){ return 'setActive err: ' + e.message }
  }, id)
  await page.reload({ waitUntil:'domcontentloaded' }); await sleep(7000)
  return r
}

async function main(){
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, viewport:{width:1440,height:900} })
  const page = ctx.pages()[0] || await ctx.newPage()
  const shot = async n => { try{ await page.screenshot({ path: path.join(__dirname,n), timeout:8000 }); console.log('   shot',n) }catch(e){ console.log('   (shot skip)') } }

  await page.goto(URL, { waitUntil:'domcontentloaded' }); await sleep(8000)
  for (let i=0;i<10;i++){ const r=await bridge({op:'list-at',segments:[]}); if(r.ok) break; await sleep(1500) }
  await bridge({op:'add', segments:[], cells:['alpha','beta','gamma','delta','epsilon','zeta']})
  await sleep(2000); await page.reload({ waitUntil:'domcontentloaded' }); await sleep(7000)

  // dump registry
  const reg = await page.evaluate(() => { const s=window.ioc?.get?.('@diamondcoreprocessor.com/SubstrateService'); return s? { active: s.registry?.activeId, sources: (s.listSources?.()||[]).map(x=>x.id) } : 'none' })
  console.log('registry:', JSON.stringify(reg))

  console.log('\n[BASE] Photos active:'); await shot('_sub-0-photos.png')

  console.log('\n[STEEL] setActive builtin:steel (v2 leftover, not a tile source):')
  console.log('  ', await setActiveAndReload(page, 'builtin:steel')); await shot('_sub-1-steel.png')

  console.log('\n[BOGUS] setActive builtin:does-not-exist:')
  console.log('  ', await setActiveAndReload(page, 'builtin:does-not-exist')); await shot('_sub-2-bogus.png')

  console.log('\n[RESTORE] setActive builtin:defaults (Photos):')
  console.log('  ', await setActiveAndReload(page, 'builtin:defaults')); await shot('_sub-3-restored.png')

  await ctx.close(); process.exit(0)
}
main().catch(e=>{ console.error(e); process.exit(1) })
