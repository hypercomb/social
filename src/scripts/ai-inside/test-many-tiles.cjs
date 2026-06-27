#!/usr/bin/env node
// Hypothesis: many tiles overflow the HexImageAtlas -> tiles render WHITE.
// Create ~85 tiles and screenshot.
const { chromium } = require('playwright')
const WebSocket = require('ws')
const path = require('path')
const PROFILE = path.join(require('os').tmpdir(), 'hc-ai-inside', '.test-profile-many')
const URL = 'http://localhost:4250/?claudeBridge=1'
const sleep = ms => new Promise(r => setTimeout(r, ms))
function bridge(req, to=20000){ return new Promise(res=>{ const ws=new WebSocket('ws://localhost:2401'); let done=false; const id='mt-'+Math.floor(performance.now()); const t=setTimeout(()=>{if(done)return;done=true;try{ws.close()}catch{};res({ok:false,error:'timeout'})},to); ws.on('open',()=>ws.send(JSON.stringify({...req,id}))); ws.on('message',r=>{if(done)return;done=true;clearTimeout(t);let m;try{m=JSON.parse(String(r))}catch{m={ok:false}};try{ws.close()}catch{};res(m)}); ws.on('error',e=>{if(done)return;done=true;clearTimeout(t);res({ok:false,error:e.code})}) }) }

async function main(){
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, viewport:{width:1600,height:1000} })
  const page = ctx.pages()[0] || await ctx.newPage()
  const shot = async n => { try{ await page.screenshot({ path: path.join(__dirname,n), timeout:9000 }); console.log('   shot',n) }catch(e){ console.log('   (shot skip)') } }

  await page.goto(URL, { waitUntil:'domcontentloaded' }); await sleep(8000)
  for (let i=0;i<10;i++){ const r=await bridge({op:'list-at',segments:[]}); if(r.ok) break; await sleep(1500) }

  const cells = Array.from({length:85}, (_,i)=>'cell'+String(i+1).padStart(2,'0'))
  console.log('creating', cells.length, 'tiles...')
  const add = await bridge({op:'add', segments:[], cells})
  console.log('  add:', JSON.stringify(add.data||add.error))
  await sleep(3000)
  await page.reload({ waitUntil:'domcontentloaded' }); await sleep(10000)

  // zoom out so all tiles are in frame (fit). Try the fit control via keyboard or just screenshot.
  await shot('_many-1-default.png')
  // try to zoom to fit via the app (press the fit/zoom-out a few times) — best effort
  try { await page.evaluate(() => { const z = window.ioc?.get?.('@diamondcoreprocessor.com/ZoomService'); }) } catch {}

  // probe atlas if exposed
  const info = await page.evaluate(() => {
    const out = {}
    try { const d = window.__pixiDebug; out.pixiDebug = d? Object.keys(d): 'none' } catch {}
    try { out.canvasCount = document.querySelectorAll('canvas').length } catch {}
    return out
  })
  console.log('probe:', JSON.stringify(info))
  await ctx.close(); process.exit(0)
}
main().catch(e=>{ console.error(e); process.exit(1) })
