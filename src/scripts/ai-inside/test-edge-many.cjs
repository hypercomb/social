#!/usr/bin/env node
// Reproduce the Edge white-wash LOCALLY: Edge + >64 tiles (atlas wrap).
// arg --substrate-off creates tiles then turns substrate off (avatar/empty).
const { chromium } = require('playwright')
const WebSocket = require('ws')
const path = require('path')
const PROFILE = path.join(require('os').tmpdir(), 'hc-ai-inside', '.edge-fresh-' + (process.env.FRESH || 'a'))
const URL = 'http://localhost:4250/?claudeBridge=1'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const SUB_OFF = process.argv.includes('--substrate-off')
function bridge(req, to=20000){ return new Promise(res=>{ const ws=new WebSocket('ws://localhost:2401'); let done=false; const id='em-'+Math.floor(performance.now()); const t=setTimeout(()=>{if(done)return;done=true;try{ws.close()}catch{};res({ok:false,error:'timeout'})},to); ws.on('open',()=>ws.send(JSON.stringify({...req,id}))); ws.on('message',r=>{if(done)return;done=true;clearTimeout(t);let m;try{m=JSON.parse(String(r))}catch{m={ok:false}};try{ws.close()}catch{};res(m)}); ws.on('error',e=>{if(done)return;done=true;clearTimeout(t);res({ok:false,error:e.code})}) }) }

async function main(){
  let ctx
  try { ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, channel:'msedge', viewport:{width:1600,height:1000} }) }
  catch(e){ console.log('EDGE LAUNCH FAILED:', e.message); process.exit(2) }
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto(URL, { waitUntil:'domcontentloaded' }); await sleep(9000)
  for (let i=0;i<12;i++){ const r=await bridge({op:'list-at',segments:[]}); if(r.ok) break; await sleep(1500) }

  const cells = Array.from({length:85},(_,i)=>'c'+String(i+1).padStart(2,'0'))
  console.log('creating 85 tiles (atlas has 64 slots → wrap)...')
  console.log('  add:', JSON.stringify((await bridge({op:'add',segments:[],cells})).data||'fail'))
  await sleep(3000)
  if (SUB_OFF) { console.log('  /substrate off:', JSON.stringify(await bridge({op:'submit',text:'/substrate off'}))); await sleep(2000) }
  await page.reload({ waitUntil:'domcontentloaded' }); await sleep(12000)

  const probe = await page.evaluate(() => { const h=[]; try{window.__pixiDebug&&window.__pixiDebug.find(o=>{try{if(o&&o.constructor&&/Mesh/.test(o.constructor.name)){const b=o.getBounds&&o.getBounds();const w=(b&&(b.width||b.rectangle?.width))||0;if(w>400)h.push('Mesh tint='+o.tint+' blend='+o.blendMode+' texAlpha='+((o.texture&&o.texture.source&&o.texture.source.alphaMode)||'?'))}}catch{}return false})}catch(e){return['ERR'+e.message]} return JSON.stringify({mesh:h}) })
  console.log('probe:', probe)
  try{ await page.screenshot({ path: path.join(__dirname,'_edge-many.png'), timeout:9000 }); console.log('shot _edge-many.png') }catch(e){ console.log('(shot skip)') }
  await ctx.close(); process.exit(0)
}
main().catch(e=>{ console.error(e); process.exit(1) })
