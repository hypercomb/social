#!/usr/bin/env node
// Build the "AI Inside" website: one shared chrome.css + an index page on the
// `ai-inside` cell + one rich profile page per company cell. Each page carries
// a custom, deterministic brand-tinted generative background. Pages attach via
// `decoration-add` kind 'visual:website:page' (replaceKind, persistent).
//
// Absolute hrefs ("/ai-inside/<slug>") drive in-app lineage navigation.

const fs = require('fs'); const path = require('path'); const WebSocket = require('ws')
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '_merged.json'), 'utf8'))
const bySlug = new Map(data.map(c => [c.slug, c]))
const ROOT = 'ai-inside'

// ---- categories (index grouping) ----------------------------------------
const CATEGORIES = [
  { name: 'Frontier Labs', icon: 'neurology', slugs: ['openai','anthropic','google-deepmind','meta-ai','xai','mistral-ai','cohere','ai21-labs','reka-ai','safe-superintelligence','thinking-machines-lab'] },
  { name: 'Image · Video · Creative Generation', icon: 'palette', slugs: ['stability-ai','midjourney','runway','pika','black-forest-labs','luma-ai','ideogram','krea'] },
  { name: "China's AI Labs", icon: 'translate', slugs: ['deepseek','alibaba-qwen','baidu-ernie','tencent-hunyuan','bytedance-doubao','moonshot-ai','zhipu-ai','zero-one-ai','minimax','baichuan'] },
  { name: 'Chips & Compute', icon: 'memory', slugs: ['nvidia','amd','cerebras','groq','sambanova','tenstorrent','etched','d-matrix','graphcore','broadcom'] },
  { name: 'Cloud & Infrastructure', icon: 'cloud', slugs: ['microsoft','amazon-aws','google-cloud','coreweave','lambda','together-ai','fireworks-ai','hugging-face','modal','crusoe'] },
  { name: 'Coding · Agents · Enterprise', icon: 'terminal', slugs: ['cursor','cognition','replit','github-copilot','perplexity','glean','harvey','sierra','scale-ai','databricks'] },
  { name: 'Voice · Media · Avatars', icon: 'graphic_eq', slugs: ['elevenlabs','suno','udio','synthesia','heygen','character-ai','captions','descript','adobe-firefly','canva'] },
  { name: 'Robotics · Embodied · Science', icon: 'precision_manufacturing', slugs: ['figure-ai','physical-intelligence','skild-ai','tesla-ai','wayve','world-labs','sakana-ai','isomorphic-labs','waymo','boston-dynamics'] },
]
const catOf = new Map()
for (const cat of CATEGORIES) for (const s of cat.slugs) catOf.set(s, cat)

const SECTIONS = [
  { key: 'strategy',        title: 'Strategy',            icon: 'strategy' },
  { key: 'differentiation', title: 'What Sets Them Apart', icon: 'auto_awesome' },
  { key: 'roadmap',         title: 'Roadmap',             icon: 'route' },
  { key: 'rationale',       title: 'Why This Approach',    icon: 'lightbulb' },
  { key: 'references',      title: 'References',          icon: 'link' },
]

// ---- helpers -------------------------------------------------------------
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
function linkify(text) {
  // escape, then turn URLs into anchors, newlines into <br>
  const e = esc(text)
  return e.replace(/(https?:\/\/[^\s<]+[^\s<.,)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>')
}
function hash(str){ let h=2166136261>>>0; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619)>>>0 } return h }

// deterministic generative background (inline SVG data URI) seeded by slug
function bgStyle(slug, brand, accent) {
  const h = hash(slug)
  const a = brand || '#5b8def', b = accent || '#0e1726'
  // procedural blobs + faint hex grid, seeded
  const blob = (seed, color, op) => {
    const cx = 10 + (seed % 80), cy = 10 + ((seed >> 3) % 80), r = 18 + ((seed >> 6) % 30)
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${op}"/>`
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 100 100'>`+
    `<defs><filter id='b'><feGaussianBlur stdDeviation='9'/></filter></defs>`+
    `<g filter='url(#b)'>`+ blob(h, a, 0.55) + blob(h*3+17, a, 0.30) + blob(h*7+91, accent||a, 0.40) +`</g>`+
    `<g stroke='${a}' stroke-width='0.25' opacity='0.10' fill='none'>`+
      Array.from({length:6},(_,i)=>`<path d='M${i*20} 0 L${i*20} 100'/>`).join('')+
    `</g></svg>`
  const uri = `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/#/g,'%23')}")`
  return { brand: a, accent: b, bg: uri }
}

// ---- chrome.css ----------------------------------------------------------
// Bytes live in `../bridge/_chrome-bytes.cjs` so every consumer (this
// builder and the `_ai-privacy-*` bridge scripts) hashes the SAME bytes and
// derives the same sig instead of copying a literal around.
const { AI_INSIDE_CHROME_CSS: CHROME_CSS } = require('../bridge/_chrome-bytes.cjs')

// ---- page templates ------------------------------------------------------
const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet"><link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">`

function pageShell(chromeSig, title, accentColor, bgUri, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`+
    `<title>${esc(title)}</title>${FONTS}`+
    `<link rel="stylesheet" href="resource:${chromeSig}/chrome.css">`+
    `<style>:root{--accentc:${accentColor}}.hero::after{background-image:${bgUri}}</style>`+
    `</head><body><div class="wrap">${body}<div class="foot"><span>AI Inside — a living map of who's building AI and why</span><span>Hypercomb hive</span></div></div></body></html>`
}

function indexPage(chromeSig) {
  const intro = "A map of the companies building artificial intelligence — and crucially, WHY each is doing it the way it does. Every company opens into five deep-dives: its strategy, what sets it apart, its roadmap, the rationale behind its bet, and references. " + data.length + " companies across eight arenas.";
  const bg = bgStyle('ai-inside', '#7ec0ff', '#0e1726')
  let body = `<div class="crumb"><span class="ms">hub</span> AI Inside</div>`+
    `<div class="hero"><div class="eyebrow">The AI Landscape</div><h1>AI Inside<span class="dot">.</span></h1><p class="lede">${esc(intro)}</p>`+
    `<div class="tags">`+CATEGORIES.map(c=>`<span class="chip"><span class="ms">${c.icon}</span>${esc(c.name)} · ${c.slugs.length}</span>`).join('')+`</div></div>`
  for (const cat of CATEGORIES) {
    body += `<div class="sec-title"><span class="ms">${cat.icon}</span>${esc(cat.name)}<span class="count">${cat.slugs.length} companies</span></div><div class="grid">`
    for (const slug of cat.slugs) {
      const c = bySlug.get(slug); if (!c) continue
      const tag = (c.overview||'').split(/(?<=\.)\s/)[0].slice(0,120)
      body += `<a class="card" href="/${ROOT}/${slug}" style="--bar:${c.brandColor||'#5b8def'}"><span class="bar"></span>`+
        `<h3>${esc(c.name)}</h3><p>${esc(tag)}</p><span class="go">Open profile →</span></a>`
    }
    body += `</div>`
  }
  return pageShell(chromeSig, 'AI Inside', '#7ec0ff', bg.bg, body)
}

function companyPage(chromeSig, c) {
  const cat = catOf.get(c.slug)
  const bg = bgStyle(c.slug, c.brandColor, c.accentColor)
  let body = `<div class="crumb"><a href="/${ROOT}"><span class="ms">arrow_back</span> AI Inside</a> <span>/</span> ${esc(cat?cat.name:'Company')}</div>`+
    `<div class="hero"><div class="eyebrow">${esc(cat?cat.name:'AI Company')}</div><h1>${esc(c.name)}</h1>`+
    `<p class="lede">${esc(c.overview)}</p></div>`
  for (const s of SECTIONS) {
    const val = c[s.key]; if (!val) continue
    const inner = s.key === 'references' ? `<p class="refs">${linkify(val)}</p>` : `<p>${esc(val)}</p>`
    body += `<div class="panel"><h3><span class="ms">${s.icon}</span>${s.title}</h3>${inner}</div>`
  }
  body += `<div class="sec-title"><span class="ms">grid_view</span>Explore in the hive</div><div class="grid">`+
    SECTIONS.map(s=>`<a class="card" href="/${ROOT}/${c.slug}/${s.key}" style="--bar:${c.brandColor||'#5b8def'}"><span class="bar"></span><h3><span class="ms">${s.icon}</span>${s.title}</h3><span class="go">Open tile →</span></a>`).join('')+
    `</div>`
  return pageShell(chromeSig, c.name + ' — AI Inside', c.brandColor || '#7ec0ff', bg.bg, body)
}

// ---- bridge client -------------------------------------------------------
let ws, counter = 0; const pend = new Map()
function rpc(req, timeout=20000){return new Promise(res=>{const id='ws-'+(++counter); const t=setTimeout(()=>{pend.delete(id);res({ok:false,error:'timeout'})},timeout); pend.set(id,m=>{clearTimeout(t);res(m)}); ws.send(JSON.stringify({...req,id}))})}
async function putResource(text){ const r=await rpc({op:'put-resource',text}); return r.ok?r.data.sig:null }
async function addPage(segments, htmlSig, icon, label){
  return rpc({op:'decoration-add', segments, kind:'visual:website:page', appliesTo:segments,
    payload:{htmlSig, icon, label, order:0, createdAt:1782416000000}, mark:'persistent', replaceKind:true})
}

function connect(){return new Promise((resolve,reject)=>{ws=new WebSocket('ws://localhost:2401');ws.on('open',resolve);ws.on('error',reject);ws.on('message',raw=>{let m;try{m=JSON.parse(String(raw))}catch{return}const cb=pend.get(m.id);if(cb){pend.delete(m.id);cb(m)}})})}

async function main(){
  await connect()
  const probe = await rpc({op:'list-at',segments:[]}); if(!probe.ok){console.error('no renderer:',probe.error);process.exit(2)}

  console.log('Minting chrome.css...')
  const chromeSig = await putResource(CHROME_CSS)
  if(!chromeSig){console.error('chrome.css mint failed');process.exit(1)}
  console.log('chrome.css sig:', chromeSig)

  // index page on ai-inside
  console.log('\nBuilding index page on /ai-inside ...')
  const idxSig = await putResource(indexPage(chromeSig))
  let r = await addPage([ROOT], idxSig, 'hub', 'AI Inside')
  console.log('index page:', r.ok ? `ok (decoration ${r.data.sig.slice(0,12)})` : 'FAIL '+r.error)

  // per-company pages
  console.log('\nBuilding company pages...')
  let ok=0, fail=0
  for (let i=0;i<data.length;i++){
    const c = data[i]; const cat = catOf.get(c.slug)
    const sig = await putResource(companyPage(chromeSig, c))
    if(!sig){fail++; console.log('\nFAIL mint '+c.slug); continue}
    const res = await addPage([ROOT, c.slug], sig, cat?cat.icon:'web', c.name)
    if(res.ok) ok++; else fail++
    process.stdout.write(`\r[page ${i+1}/${data.length}] ${c.slug.padEnd(22)} (${ok} ok, ${fail} fail)   `)
  }
  console.log(`\n\nWEBSITE done: index + ${ok} company pages (${fail} fail). chromeSig=${chromeSig}`)

  // verify a sample read-back
  const la = await rpc({op:'layer-at',segments:[ROOT]})
  console.log('verify: ai-inside decorations slot length =', la.ok&&la.data.decorations?la.data.decorations.length:la.error)

  // one build revision for the whole pass (documentation/build-revisions.md)
  const rev = await rpc({op:'build-record', segments:[ROOT], label:'ai-inside site build'})
  console.log('build revision:', rev.ok ? `${rev.data.label} seal=${rev.data.seal.slice(0,12)}${rev.data.unchanged?' (unchanged)':''}` : `FAILED: ${rev.error}`)
  ws.close(); process.exit(0)
}
main().catch(e=>{console.error(e);process.exit(1)})
