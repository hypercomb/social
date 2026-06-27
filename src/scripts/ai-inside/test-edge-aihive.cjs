#!/usr/bin/env node
// Drive EDGE through the exact failing flow: create an AI-hive cell WITH a
// visual:website:page decoration, enter it (website-strip launcher / website
// mode), then come back — and capture the global state that flips + persists.
const { chromium } = require('playwright')
const WebSocket = require('ws')
const path = require('path')
const PROFILE = path.join(require('os').tmpdir(), 'hc-ai-inside', '.edge-profile')
const URL = 'http://localhost:4250/?claudeBridge=1'
const sleep = ms => new Promise(r => setTimeout(r, ms))
function bridge(req, to=15000){ return new Promise(res=>{ const ws=new WebSocket('ws://localhost:2401'); let done=false; const id='ea-'+Math.floor(performance.now()); const t=setTimeout(()=>{if(done)return;done=true;try{ws.close()}catch{};res({ok:false,error:'timeout'})},to); ws.on('open',()=>ws.send(JSON.stringify({...req,id}))); ws.on('message',r=>{if(done)return;done=true;clearTimeout(t);let m;try{m=JSON.parse(String(r))}catch{m={ok:false}};try{ws.close()}catch{};res(m)}); ws.on('error',e=>{if(done)return;done=true;clearTimeout(t);res({ok:false,error:e.code})}) }) }

const PAGE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AI Inside</title>`+
  `<style>*{box-sizing:border-box;margin:0;padding:0}html,body{background:#070b12;color:#e8eef6;font-family:Inter,system-ui,sans-serif}.hero{padding:40px}</style>`+
  `</head><body><div class="hero"><h1>AI Inside</h1><p>company profile</p></div></body></html>`

const probe = `(() => { const c=document.querySelector('#pixi-host canvas')||document.querySelector('canvas'); const cs=c?getComputedStyle(c):null; const styleTags=[...document.querySelectorAll('style')].length; const globalRules=[]; for(const st of document.querySelectorAll('style')){ const t=st.textContent||''; if(/html\\s*,?\\s*body|canvas|#pixi-host|:root|\\bbody\\b/.test(t)) globalRules.push(t.slice(0,80)); } return { viewMode: (window.ioc?.get?.('@hypercomb.social/ViewMode')||{}).mode, dataTheme: document.documentElement.getAttribute('data-theme'), bodyClass: document.body.className, htmlStyle: document.documentElement.getAttribute('style'), bodyBg: getComputedStyle(document.body).backgroundColor, pixiHostStyle: (document.querySelector('#pixi-host')||{}).getAttribute?.('style'), canvas: c?(cs.visibility+'/op'+cs.opacity+'/filter:'+cs.filter+'/mix:'+cs.mixBlendMode):'none', canvasParentFilter: c&&c.parentElement?getComputedStyle(c.parentElement).filter:'', styleTags, globalRules }; })()`

async function main(){
  let ctx
  try { ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, channel:'msedge', viewport:{width:1440,height:900} }) }
  catch(e){ console.log('EDGE LAUNCH FAILED:', e.message); process.exit(2) }
  const page = ctx.pages()[0] || await ctx.newPage()
  const shot = async n => { try{ await page.screenshot({ path: path.join(__dirname,n), timeout:9000 }); console.log('   shot',n) }catch(e){ console.log('   (shot skip)') } }
  const dump = async (label) => { console.log('\n['+label+']', JSON.stringify(await page.evaluate(probe))) }

  await page.goto(URL, { waitUntil:'domcontentloaded' }); await sleep(9000)
  for (let i=0;i<10;i++){ const r=await bridge({op:'list-at',segments:[]}); if(r.ok) break; await sleep(1500) }

  // build a small AI hive WITH a website page on it
  await bridge({op:'add', segments:[], cells:['ai-inside','sib1','sib2']})
  await bridge({op:'update', segments:['ai-inside'], layer:{ name:'ai-inside', children:['openai','anthropic','google'] }})
  const sig = (await bridge({op:'put-resource', text: PAGE_HTML})).data?.sig
  console.log('page sig:', sig)
  await bridge({op:'decoration-add', segments:['ai-inside'], kind:'visual:website:page', appliesTo:['ai-inside'], payload:{ htmlSig:sig, icon:'hub', label:'AI Inside', order:0, createdAt:1782416000000 }, mark:'persistent', replaceKind:true})
  await sleep(2000); await page.reload({ waitUntil:'domcontentloaded' }); await sleep(8000)

  await dump('ROOT before'); await shot('_ai-0-root-before.png')

  // enter the AI site via the website-strip launcher (bottom-right hex), else toggle website mode
  let clicked = false
  try { const btn = await page.$('.ws-icon'); if (btn){ await btn.click(); clicked=true; console.log('\nclicked website-strip launcher') } } catch {}
  if (!clicked) { console.log('\nno launcher — toggling website mode + nav ai-inside via submit'); await bridge({op:'submit', text:'ai-inside'}); await sleep(1500); await page.evaluate(`window.ioc.get('@hypercomb.social/ViewMode').setMode('website')`) }
  await sleep(5000)
  await dump('INSIDE AI hive (website)'); await shot('_ai-1-inside.png')

  // come back out — Escape, then ensure hexagons
  await page.keyboard.press('Escape'); await sleep(2500)
  await page.evaluate(`try{window.ioc.get('@hypercomb.social/ViewMode').setMode('hexagons')}catch(e){}`); await sleep(3000)
  // navigate back to root
  await bridge({op:'submit', text:'/home'}).catch(()=>{}); await sleep(1500)
  await page.keyboard.press('Escape'); await sleep(2500)
  await dump('BACK at root (does it persist white?)'); await shot('_ai-2-back.png')

  await ctx.close(); process.exit(0)
}
main().catch(e=>{ console.error(e); process.exit(1) })
