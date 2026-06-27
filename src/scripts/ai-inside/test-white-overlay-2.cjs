#!/usr/bin/env node
// Full-cycle driver test WITH real tiles: create tiles via the bridge, then
// watch hexagon -> website -> hexagon and a persist+reload, capturing the body
// background / canvas visibility (the white-wash signals) and screenshots at
// each stage. Proves you can SEE tiles cleanly and can't get stuck white.

const { chromium } = require('playwright')
const WebSocket = require('ws')
const path = require('path')
const PROFILE = path.join(require('os').tmpdir(), 'hc-ai-inside', '.test-profile')
const URL = 'http://localhost:4250/?claudeBridge=1'
const sleep = ms => new Promise(r => setTimeout(r, ms))

function bridge(req, to=12000){ return new Promise(res=>{ const ws=new WebSocket('ws://localhost:2401'); let done=false; const id='t2-'+Math.floor(performance.now())+'-'+Math.round(performance.timeOrigin%1000); const t=setTimeout(()=>{ if(done)return; done=true; try{ws.close()}catch{}; res({ok:false,error:'timeout'}) },to); ws.on('open',()=>ws.send(JSON.stringify({...req,id}))); ws.on('message',r=>{ if(done)return; done=true; clearTimeout(t); let m; try{m=JSON.parse(String(r))}catch{m={ok:false,error:'parse'}}; try{ws.close()}catch{}; res(m) }); ws.on('error',e=>{ if(done)return; done=true; clearTimeout(t); res({ok:false,error:e.code||e.message}) }) }) }

const probe = `(() => { const vm=window.ioc&&window.ioc.get&&window.ioc.get('@hypercomb.social/ViewMode'); const c=document.querySelector('#pixi-host canvas')||document.querySelector('canvas'); const cs=c?getComputedStyle(c):null; return { mode: vm?vm.mode:'?', stored: localStorage.getItem('hc:view-mode'), dataTheme: document.documentElement.getAttribute('data-theme'), bodyBg: getComputedStyle(document.body).backgroundColor, bodyClass: document.body.className, canvas: c?(cs.visibility+'/'+cs.display+'/op'+cs.opacity):'NO-CANVAS' }; })()`

async function main(){
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, viewport:{width:1440,height:900} })
  const page = ctx.pages()[0] || await ctx.newPage()
  const shot = async n => { try{ await page.screenshot({ path: path.join(__dirname,n), timeout:8000 }); console.log('   shot',n) }catch(e){ console.log('   (shot skip',e.message.slice(0,30)+')') } }

  console.log('loading', URL)
  await page.goto(URL, { waitUntil:'domcontentloaded' }); await sleep(8000)

  // wait for this tab to register as the bridge renderer
  let live=false
  for (let i=0;i<10;i++){ const r=await bridge({op:'list-at',segments:[]}); if(r.ok){ live=true; break } await sleep(1500) }
  console.log('bridge renderer connected:', live)

  // create a few tiles at root (idempotent-ish: add appends by name)
  const add = await bridge({op:'add', segments:[], cells:['alpha','beta','gamma','delta','epsilon']})
  console.log('create tiles:', add.ok?('ok '+JSON.stringify(add.data)):('FAIL '+add.error))
  await sleep(2500)
  await page.reload({ waitUntil:'domcontentloaded' }); await sleep(8000)

  console.log('\n[A] HEXAGON mode with tiles:')
  console.log('  ', JSON.stringify(await page.evaluate(probe)))
  await shot('_t2-A-hexagons.png')

  console.log('\n[B] enter WEBSITE mode (this is what /website does):')
  await page.evaluate(`window.ioc.get('@hypercomb.social/ViewMode').setMode('website')`); await sleep(3000)
  console.log('  ', JSON.stringify(await page.evaluate(probe)))
  await shot('_t2-B-website.png')

  console.log('\n[C] back to HEXAGON mode — tiles must return clean:')
  await page.evaluate(`window.ioc.get('@hypercomb.social/ViewMode').setMode('hexagons')`); await sleep(3000)
  console.log('  ', JSON.stringify(await page.evaluate(probe)))
  await shot('_t2-C-back.png')

  console.log('\n[D] persist website + RELOAD — must boot to hexagons (the fix):')
  await page.evaluate(() => localStorage.setItem('hc:view-mode','website'))
  await page.reload({ waitUntil:'domcontentloaded' }); await sleep(8000)
  const d = await page.evaluate(probe); console.log('  ', JSON.stringify(d))
  await shot('_t2-D-reload.png')

  console.log('\n=== VERDICT ===')
  console.log('boots hexagons after stored website:', d.mode==='hexagons' ? 'YES (fixed)' : 'NO ('+d.mode+')')
  console.log('canvas visible after reload:', /visible/.test(d.canvas) ? 'YES' : d.canvas)
  await ctx.close(); process.exit(0)
}
main().catch(e=>{ console.error(e); process.exit(1) })
