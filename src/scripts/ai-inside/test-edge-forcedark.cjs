#!/usr/bin/env node
// Reproduce: launch Edge with FORCE-DARK (Auto Dark Mode for Web Contents)
// enabled — the Edge-only setting the user likely has — and see if it washes
// the WebGL tiles white. If yes, that's the root cause.
const { chromium } = require('playwright')
const WebSocket = require('ws')
const path = require('path')
const PROFILE = path.join(require('os').tmpdir(), 'hc-ai-inside', '.edge-fd-profile')
const URL = 'http://localhost:4250/?claudeBridge=1'
const sleep = ms => new Promise(r => setTimeout(r, ms))
function bridge(req, to=15000){ return new Promise(res=>{ const ws=new WebSocket('ws://localhost:2401'); let done=false; const id='fd-'+Math.floor(performance.now()); const t=setTimeout(()=>{if(done)return;done=true;try{ws.close()}catch{};res({ok:false,error:'timeout'})},to); ws.on('open',()=>ws.send(JSON.stringify({...req,id}))); ws.on('message',r=>{if(done)return;done=true;clearTimeout(t);let m;try{m=JSON.parse(String(r))}catch{m={ok:false}};try{ws.close()}catch{};res(m)}); ws.on('error',e=>{if(done)return;done=true;clearTimeout(t);res({ok:false,error:e.code})}) }) }

async function run(label, args, outShot){
  let ctx
  try { ctx = await chromium.launchPersistentContext(PROFILE+'-'+label, { headless:false, channel:'msedge', viewport:{width:1280,height:820}, args }) }
  catch(e){ console.log(label,'LAUNCH FAILED:', e.message); return }
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto(URL, { waitUntil:'domcontentloaded' }); await sleep(9000)
  for (let i=0;i<10;i++){ const r=await bridge({op:'list-at',segments:[]}); if(r.ok) break; await sleep(1500) }
  await bridge({op:'add', segments:[], cells:['alpha','beta','gamma','delta','epsilon','zeta']})
  await sleep(2500); await page.reload({ waitUntil:'domcontentloaded' }); await sleep(8000)
  // does the page declare a color-scheme? (the opt-out for force-dark)
  const cs = await page.evaluate(() => ({ metaCS: (document.querySelector('meta[name=color-scheme]')||{}).content || null, rootCS: getComputedStyle(document.documentElement).colorScheme, bodyBg: getComputedStyle(document.body).backgroundColor }))
  console.log(label, 'color-scheme:', JSON.stringify(cs))
  try { await page.screenshot({ path: path.join(__dirname,outShot), timeout:9000 }); console.log('  shot', outShot) } catch(e){ console.log('  (shot skip)') }
  await ctx.close()
}

async function main(){
  console.log('=== Edge WITH force-dark (Auto Dark Mode for Web Contents) ===')
  await run('forcedark', ['--enable-features=WebContentsForceDark','--force-dark-mode'], '_fd-on.png')
  process.exit(0)
}
main().catch(e=>{ console.error(e); process.exit(1) })
