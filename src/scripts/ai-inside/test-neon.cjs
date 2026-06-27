#!/usr/bin/env node
// Does neon border mode (/border neon, persisted hc:neon-mode) wash tiles white?
const { chromium } = require('playwright')
const WebSocket = require('ws')
const path = require('path')
const PROFILE = path.join(require('os').tmpdir(), 'hc-ai-inside', '.test-profile')
const URL = 'http://localhost:4250/?claudeBridge=1'
const sleep = ms => new Promise(r => setTimeout(r, ms))
function bridge(req, to=12000){ return new Promise(res=>{ const ws=new WebSocket('ws://localhost:2401'); let done=false; const id='nz-'+Math.floor(performance.now()); const t=setTimeout(()=>{if(done)return;done=true;try{ws.close()}catch{};res({ok:false,error:'timeout'})},to); ws.on('open',()=>ws.send(JSON.stringify({...req,id}))); ws.on('message',r=>{if(done)return;done=true;clearTimeout(t);let m;try{m=JSON.parse(String(r))}catch{m={ok:false}};try{ws.close()}catch{};res(m)}); ws.on('error',e=>{if(done)return;done=true;clearTimeout(t);res({ok:false,error:e.code})}) }) }

async function main(){
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, viewport:{width:1440,height:900} })
  const page = ctx.pages()[0] || await ctx.newPage()
  const shot = async n => { try{ await page.screenshot({ path: path.join(__dirname,n), timeout:8000 }); console.log('   shot',n) }catch(e){ console.log('   (shot skip)') } }

  await page.goto(URL, { waitUntil:'domcontentloaded' }); await sleep(8000)
  for (let i=0;i<10;i++){ const r=await bridge({op:'list-at',segments:[]}); if(r.ok) break; await sleep(1500) }
  await bridge({op:'add', segments:[], cells:['alpha','beta','gamma','delta','epsilon','zeta','eta','theta']})
  await sleep(2000); await page.reload({ waitUntil:'domcontentloaded' }); await sleep(7000)

  console.log('accent/neon prefs:', JSON.stringify(await page.evaluate(() => ({ neonMode: localStorage.getItem('hc:neon-mode'), neonColor: localStorage.getItem('hc:neon-color') }))))
  console.log('[OFF baseline]'); await shot('_neon-0-off.png')

  console.log('[/border neon]'); console.log('  ', JSON.stringify(await bridge({op:'submit', text:'/border neon'}))); await sleep(3500)
  console.log('  prefs now:', JSON.stringify(await page.evaluate(() => ({ neonMode: localStorage.getItem('hc:neon-mode') }))))
  await shot('_neon-1-on.png')

  // also try a white accent + neon (worst case)
  console.log('[/accent white-ish then neon]'); await bridge({op:'submit', text:'/accent #ffffff'}); await sleep(2500); await shot('_neon-2-white-accent.png')

  console.log('[/border off]'); await bridge({op:'submit', text:'/border off'}); await sleep(3000); await shot('_neon-3-off-again.png')

  await ctx.close(); process.exit(0)
}
main().catch(e=>{ console.error(e); process.exit(1) })
