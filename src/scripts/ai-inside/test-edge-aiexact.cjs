#!/usr/bin/env node
// Reproduce the USER'S EXACT scenario in fresh Edge: build ai-inside via the
// same `update` ops as build-ai-inside (imageless company tiles), navigate to
// /ai-inside, screenshot. Tells us whether the atlas fix covers their real case.
const { chromium } = require('playwright')
const WebSocket = require('ws')
const path = require('path')
const PROFILE = path.join(require('os').tmpdir(), 'hc-ai-inside', '.edge-exact-' + (process.env.FRESH || 'a'))
const sleep = ms => new Promise(r => setTimeout(r, ms))
function bridge(req, to=20000){ return new Promise(res=>{ const ws=new WebSocket('ws://localhost:2401'); let done=false; const id='ex-'+Math.floor(performance.now()); const t=setTimeout(()=>{if(done)return;done=true;try{ws.close()}catch{};res({ok:false,error:'timeout'})},to); ws.on('open',()=>ws.send(JSON.stringify({...req,id}))); ws.on('message',r=>{if(done)return;done=true;clearTimeout(t);let m;try{m=JSON.parse(String(r))}catch{m={ok:false}};try{ws.close()}catch{};res(m)}); ws.on('error',e=>{if(done)return;done=true;clearTimeout(t);res({ok:false,error:e.code})}) }) }

const COMPANIES = ['openai','anthropic','google-deepmind','meta-ai','xai','mistral-ai','cohere','ai21-labs','reka-ai','deepseek','nvidia','amd','cerebras','groq','microsoft','perplexity','cursor','elevenlabs','figure-ai','tesla-ai']

async function main(){
  let ctx
  try { ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, channel:'msedge', viewport:{width:1600,height:1000} }) }
  catch(e){ console.log('EDGE LAUNCH FAILED:', e.message); process.exit(2) }
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto('http://localhost:4250/?claudeBridge=1', { waitUntil:'domcontentloaded' }); await sleep(9000)
  for (let i=0;i<12;i++){ const r=await bridge({op:'list-at',segments:[]}); if(r.ok) break; await sleep(1500) }

  // build ai-inside the SAME way build-ai-inside does: update ops, NO images
  await bridge({ op:'add', segments:[], cells:['ai-inside'] })
  await bridge({ op:'update', segments:['ai-inside'], layer:{ name:'ai-inside', children: COMPANIES } })
  for (const c of COMPANIES) await bridge({ op:'update', segments:['ai-inside', c], layer:{ name:c, children:['strategy','differentiation','roadmap','rationale','references'] } })
  console.log('built ai-inside with', COMPANIES.length, 'imageless company tiles')
  await sleep(2500)

  // navigate to /ai-inside (the failing level)
  await page.goto('http://localhost:4250/ai-inside?claudeBridge=1', { waitUntil:'domcontentloaded' }); await sleep(12000)

  const probe = await page.evaluate(() => {
    // sample canvas pixels at center (a tile) to detect white
    const c = document.querySelector('#pixi-host canvas') || document.querySelector('canvas')
    let px = 'no-canvas'
    try { const r=c.getBoundingClientRect(); const gl=c.getContext('webgl2')||c.getContext('webgl'); } catch {}
    const h=[]; try{window.__pixiDebug&&window.__pixiDebug.find(o=>{try{if(o&&o.constructor&&/Mesh/.test(o.constructor.name)){const b=o.getBounds&&o.getBounds();if(((b&&(b.width||b.rectangle?.width))||0)>400)h.push('Mesh tex='+((o.texture&&o.texture.source&&o.texture.source.alphaMode)||'?'))}}catch{}return false})}catch{}
    return JSON.stringify({ loc:(window.ioc.get('@hypercomb.social/Lineage')||{}).explorerLabel?.(), mesh:h })
  })
  console.log('probe:', probe)
  try{ await page.screenshot({ path: path.join(__dirname,'_edge-exact.png'), timeout:9000 }); console.log('shot _edge-exact.png') }catch(e){ console.log('(shot skip)') }
  await ctx.close(); process.exit(0)
}
main().catch(e=>{ console.error(e); process.exit(1) })
