#!/usr/bin/env node
// Reproduce the white-overlay in EDGE (channel: msedge). Chromium renders fine;
// the user sees white in Edge. Capture screenshot + WebGL renderer + any large
// light overlay layer (Pixi or DOM) over the tiles.
const { chromium } = require('playwright')
const WebSocket = require('ws')
const path = require('path')
const PROFILE = path.join(require('os').tmpdir(), 'hc-ai-inside', '.edge-profile')
const URL = 'http://localhost:4250/?claudeBridge=1'
const sleep = ms => new Promise(r => setTimeout(r, ms))
function bridge(req, to=15000){ return new Promise(res=>{ const ws=new WebSocket('ws://localhost:2401'); let done=false; const id='ed-'+Math.floor(performance.now()); const t=setTimeout(()=>{if(done)return;done=true;try{ws.close()}catch{};res({ok:false,error:'timeout'})},to); ws.on('open',()=>ws.send(JSON.stringify({...req,id}))); ws.on('message',r=>{if(done)return;done=true;clearTimeout(t);let m;try{m=JSON.parse(String(r))}catch{m={ok:false}};try{ws.close()}catch{};res(m)}); ws.on('error',e=>{if(done)return;done=true;clearTimeout(t);res({ok:false,error:e.code})}) }) }

async function probe(page){
  return page.evaluate(() => {
    const out = {}
    // WebGL renderer (software vs GPU)
    try { const c=document.createElement('canvas'); const gl=c.getContext('webgl2')||c.getContext('webgl'); const dbg=gl&&gl.getExtension('WEBGL_debug_renderer_info'); out.webgl = dbg? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (gl?'(no debug ext)':'NO-WEBGL'); out.webglVendor = dbg? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL):'' } catch(e){ out.webglErr=e.message }
    // big light DOM elements over the canvas
    try {
      const big=[]; for (const el of document.body.querySelectorAll('*')){ const r=el.getBoundingClientRect(); if(r.width>600&&r.height>400){ const s=getComputedStyle(el); const bg=s.backgroundColor; const m=/rgba?\((\d+), ?(\d+), ?(\d+)(?:, ?([\d.]+))?/.exec(bg); if(m){ const br=(+m[1]+ +m[2]+ +m[3])/3, a=m[4]===undefined?1:+m[4]; if(br>140&&a>0.05) big.push((el.tagName.toLowerCase()+'.'+(el.className||'').toString().slice(0,30))+' '+Math.round(r.width)+'x'+Math.round(r.height)+' bg='+bg+' bf='+s.backdropFilter) } } } out.lightDom=big.slice(0,8)
    } catch(e){ out.domErr=e.message }
    // large light Pixi layers
    try { const h=[]; window.__pixiDebug&&window.__pixiDebug.find(o=>{try{const b=o.getBounds&&o.getBounds();const w=(b&&(b.width||b.rectangle?.width))||0,ht=(b&&(b.height||b.rectangle?.height))||0;if(w>600&&ht>400&&o.visible&&(o.alpha??1)>0.1)h.push((o.label||o.constructor?.name||'?')+` ${Math.round(w)}x${Math.round(ht)} a=${(o.alpha??1).toFixed(2)} blend=${o.blendMode} tint=${o.tint}`)}catch{}return false}); out.pixiBig=h.slice(0,10) } catch(e){ out.pixiErr=e.message }
    return out
  })
}

async function main(){
  let ctx
  try { ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, channel:'msedge', viewport:{width:1440,height:900} }) }
  catch(e){ console.log('EDGE LAUNCH FAILED:', e.message); console.log('(Playwright may need the msedge channel; user can run the probe manually.)'); process.exit(2) }
  const page = ctx.pages()[0] || await ctx.newPage()
  const errs=[]; page.on('console', m=>{ if(m.type()==='error') errs.push(m.text().slice(0,140)) })
  const shot = async n => { try{ await page.screenshot({ path: path.join(__dirname,n), timeout:9000 }); console.log('   shot',n) }catch(e){ console.log('   (shot skip)') } }

  console.log('loading in EDGE:', URL)
  await page.goto(URL, { waitUntil:'domcontentloaded' }); await sleep(9000)
  for (let i=0;i<10;i++){ const r=await bridge({op:'list-at',segments:[]}); if(r.ok) break; await sleep(1500) }
  await bridge({op:'add', segments:[], cells:['alpha','beta','gamma','delta','epsilon','zeta']})
  await sleep(2500); await page.reload({ waitUntil:'domcontentloaded' }); await sleep(9000)

  console.log('\nPROBE:', JSON.stringify(await probe(page), null, 1))
  console.log('console errors:', errs.slice(0,6))
  await shot('_edge-tiles.png')
  await ctx.close(); process.exit(0)
}
main().catch(e=>{ console.error(e); process.exit(1) })
