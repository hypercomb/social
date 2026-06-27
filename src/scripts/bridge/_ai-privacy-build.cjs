// Second-pass builder for the `ai-inside` website: adds a Data & Privacy
// profile to each company.
//
//   node scripts/bridge/_ai-privacy-build.cjs <data.json> [--slugs a,b,c]
//
// Per company entry it:
//   1. creates a `data-privacy` child cell under ai-inside/<slug>
//   2. writes a note: prose summary + a structured JSON block (the
//      evidence left behind + the data source for the comparison chart)
//   3. mints a standalone "Data & Your Privacy" page (shared chrome.css)
//   4. attaches a visual:website:page decoration on the new cell
//   5. injects a linking panel into the company's landing page
// Everything is idempotent (replaceKind + note/​panel presence checks).

const WebSocket = require('ws')
const { readFileSync } = require('fs')

const BRIDGE = 'ws://localhost:2401'
const CHROME = 'e262da8308c237671918e948b7eaacf6c87e503262eb842658e01b976d45925a'

let counter = 0
const nextId = () => `dp-${Date.now()}-${++counter}`

function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 15_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: nextId() })))
    ws.on('message', raw => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ; ws.close() })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

async function ask(req, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await send(req)
      if (r.ok || (r.error !== 'no renderer connected')) return r
    } catch (e) { if (i === attempts - 1) throw e }
    await new Promise(r => setTimeout(r, 1500))
  }
  return { ok: false, error: 'renderer never connected' }
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── colour vocabulary for the fact chips ──
const C = { green: '#46d39a', lime: '#9bd45e', amber: '#f5c451', orange: '#ff9a6b', red: '#ff7a8a', grey: '#6b7a8d' }

function fact(label, text, color) {
  return `<div class="fact"><div class="k">${esc(label)}</div><div class="v"><span class="dot" style="background:${color}"></span>${esc(text)}</div></div>`
}

function factChips(d) {
  const tcd = d.trainsConsumerDefault
  const out = []
  out.push(fact('Trains on your data',
    tcd === true ? 'Yes, by default' : tcd === false ? 'Only if you opt in' : 'Partly',
    tcd === true ? C.red : tcd === false ? C.green : C.amber))
  out.push(fact('Consumer opt-out',
    d.consumerOptOut === true ? 'Yes' : d.consumerOptOut === 'partial' ? 'EU/UK only' : d.consumerOptOut === false ? 'No' : '—',
    d.consumerOptOut === true ? C.green : d.consumerOptOut === 'partial' ? C.amber : d.consumerOptOut === false ? C.red : C.grey))
  out.push(fact('Enterprise no-train',
    d.enterpriseNoTrain === true ? 'Yes' : d.enterpriseNoTrain === false ? 'No' : 'N/A',
    d.enterpriseNoTrain === true ? C.green : d.enterpriseNoTrain === false ? C.red : C.grey))
  out.push(fact('Zero-retention option',
    d.zdr === true ? 'Yes' : d.zdr === 'partial' ? 'Partial' : d.zdr === false ? 'No' : '—',
    d.zdr === true ? C.green : d.zdr === 'partial' ? C.amber : d.zdr === false ? C.red : C.grey))
  out.push(fact('Uses data for ads',
    d.sharesForAds === 'none' ? 'No' : d.sharesForAds === 'limited' ? 'Limited' : 'Core business',
    d.sharesForAds === 'none' ? C.green : d.sharesForAds === 'limited' ? C.amber : C.red))
  out.push(fact('Default retention', d.retention, C.grey))
  const pc = [C.red, C.orange, C.amber, C.lime, C.green][Math.max(1, Math.min(5, d.posture)) - 1]
  out.push(fact('Privacy posture', `${d.posture} / 5`, pc))
  return out.join('')
}

function pageHtml(e) {
  const d = e.data
  const controls = e.controls.map(c => `<li><span class="ms">check</span>${esc(c)}</li>`).join('')
  const pros = e.pros.map(p => `<li><span class="ms">add</span>${esc(p)}</li>`).join('')
  const cons = e.cons.map(c => `<li><span class="ms">remove</span>${esc(c)}</li>`).join('')
  const sources = e.sources.map(s => `<a href="${s.url}">${esc(s.label)}</a>`).join(' &middot; ')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e.label)} — Data &amp; Privacy</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet"><link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"><link rel="stylesheet" href="resource:${CHROME}/chrome.css"><style>:root{--accentc:${e.accent || '#7ec0ff'}}.factgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:24px}.fact{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:rgba(255,255,255,.03)}.fact .k{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}.fact .v{font-size:14px;font-weight:600;margin-top:5px;display:flex;align-items:center;gap:7px}.dot{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 8px currentColor}.ctl,.pclist{list-style:none}.ctl li,.pclist li{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line);color:#d6e1ee;font-size:15px;line-height:1.5}.ctl li:first-child,.pclist li:first-child{border-top:none}.ctl .ms{font-size:18px;color:var(--accentc);flex:none;margin-top:1px}.prosCons{display:grid;grid-template-columns:1fr 1fr;gap:22px}.pccol h4{font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:8px}.pccol.pro h4{color:${C.green}}.pccol.con h4{color:${C.red}}.pclist .ms{font-size:18px;flex:none;margin-top:1px}.pro .ms{color:${C.green}}.con .ms{color:${C.red}}@media(max-width:640px){.prosCons{grid-template-columns:1fr;gap:8px}}</style></head><body><div class="wrap"><div class="crumb"><a href="/ai-inside"><span class="ms">arrow_back</span> AI Inside</a> <span>/</span> <a href="/ai-inside/${e.slug}">${esc(e.label)}</a> <span>/</span> Data &amp; Privacy</div><div class="hero"><div class="eyebrow">Data &amp; Your Privacy &middot; ${esc(e.product)}</div><h1>${esc(e.label)}</h1><p class="lede">${esc(e.summary)}</p><div class="factgrid">${factChips(d)}</div></div><div class="panel"><h3><span class="ms">database</span>What They Collect &amp; Train On</h3><p>${esc(e.collect)}</p></div><div class="panel"><h3><span class="ms">share</span>How Personal Data Is Shared</h3><p>${esc(e.share)}</p></div><div class="panel"><h3><span class="ms">tune</span>Your Controls</h3><ul class="ctl">${controls}</ul></div><div class="panel"><h3><span class="ms">balance</span>The Trade-offs</h3><div class="prosCons"><div class="pccol pro"><h4><span class="ms">thumb_up</span>Pros</h4><ul class="pclist pro">${pros}</ul></div><div class="pccol con"><h4><span class="ms">thumb_down</span>Cons</h4><ul class="pclist con">${cons}</ul></div></div></div><div class="panel"><h3><span class="ms">link</span>Sources</h3><p class="refs">${sources}</p></div><div class="foot"><span><a href="/ai-inside/data-privacy">&larr; AI Data &amp; Privacy comparison</a></span><span>Hypercomb hive &middot; AI Inside</span></div></div></body></html>`
}

function noteText(e) {
  const blob = {
    schema: 'ai-data-privacy/v1', slug: e.slug, label: e.label, product: e.product,
    category: e.category, ...e.data, controls: e.controls, pros: e.pros, cons: e.cons,
    sources: e.sources.map(s => s.url)
  }
  return `Data & Privacy — ${e.summary}\n\n\`\`\`json\n${JSON.stringify(blob, null, 0)}\n\`\`\``
}

function landingPanel(e) {
  return `<div class="panel" data-dp="1"><h3><span class="ms">policy</span>Data &amp; Your Privacy</h3><p>${esc(e.summary)}</p><p><a href="/ai-inside/${e.slug}/data-privacy">Full data &amp; privacy profile &rarr;</a></p></div>`
}

async function putResource(text) {
  const r = await ask({ op: 'put-resource', text })
  if (!r.ok) throw new Error('put-resource failed: ' + r.error)
  return r.data.sig
}

async function getResource(sig) {
  const r = await ask({ op: 'get-resource', sig })
  if (!r.ok) throw new Error('get-resource failed: ' + r.error)
  return r.data.encoding === 'text' ? r.data.text : Buffer.from(r.data.base64, 'base64').toString('utf8')
}

async function landingDeco(slug) {
  // read existing visual:website:page decoration on the landing cell to preserve icon/label
  const r = await ask({ op: 'layer-at', segments: ['ai-inside', slug] })
  const decos = (r.ok && r.data && Array.isArray(r.data.decorations)) ? r.data.decorations : []
  for (const sig of decos) {
    try {
      const rec = JSON.parse(await getResource(sig))
      if (rec && rec.kind === 'visual:website:page' && rec.payload && rec.payload.htmlSig) return rec.payload
    } catch {}
  }
  return null
}

async function buildOne(e) {
  const path = ['ai-inside', e.slug, 'data-privacy']
  const log = (...a) => console.log(`  [${e.slug}]`, ...a)

  // 1. create the cell
  const add = await ask({ op: 'add', segments: ['ai-inside', e.slug], cells: ['data-privacy'] })
  log('add cell:', add.ok ? 'ok' : ('(' + (add.error || 'exists') + ')'))

  // 2. note (idempotent — skip if a Data & Privacy note already present)
  const notes = await ask({ op: 'note-list', segments: path })
  const have = (notes.ok && Array.isArray(notes.data)) ? notes.data : []
  if (have.some(n => String(n.text || '').startsWith('Data & Privacy —'))) {
    log('note: already present')
  } else {
    const nr = await ask({ op: 'note-add', segments: ['ai-inside', e.slug], cell: 'data-privacy', text: noteText(e) })
    log('note-add:', nr.ok ? 'ok' : nr.error)
  }

  // 3. determine accent from the landing page, then mint the page
  let landingHtml = null
  try { landingHtml = await getResource(e.landingSig) } catch {}
  const m = landingHtml && landingHtml.match(/--accentc:\s*(#[0-9A-Fa-f]{3,8})/)
  e.accent = m ? m[1] : '#7ec0ff'
  const htmlSig = await putResource(pageHtml(e))
  log('page minted:', htmlSig.slice(0, 12), 'accent', e.accent)

  // 4. attach the page decoration on the data-privacy cell
  const dec = await ask({
    op: 'decoration-add', segments: path, kind: 'visual:website:page', appliesTo: path,
    payload: { htmlSig, icon: 'policy', label: 'Data & Privacy', order: 0, createdAt: STAMP },
    mark: 'persistent', replaceKind: true
  })
  log('decoration:', dec.ok ? (dec.unchanged ? 'unchanged' : 'ok ' + (dec.data && dec.data.sig || '').slice(0, 12)) : dec.error)

  // 5. inject the linking panel into the landing page (idempotent)
  if (landingHtml && landingHtml.includes(`/ai-inside/${e.slug}/data-privacy`)) {
    log('landing panel: already present')
  } else if (landingHtml) {
    const panel = landingPanel(e)
    const refMark = '<div class="panel"><h3><span class="ms">link</span>References'
    let next
    if (landingHtml.includes(refMark)) next = landingHtml.replace(refMark, panel + refMark)
    else if (landingHtml.includes('<div class="foot">')) next = landingHtml.replace('<div class="foot">', panel + '<div class="foot">')
    else next = landingHtml.replace('</div></body>', panel + '</div></body>')
    const newLandingSig = await putResource(next)
    const ld = await landingDeco(e.slug)
    const dr = await ask({
      op: 'decoration-add', segments: ['ai-inside', e.slug], kind: 'visual:website:page', appliesTo: ['ai-inside', e.slug],
      payload: { htmlSig: newLandingSig, icon: (ld && ld.icon) || 'neurology', label: (ld && ld.label) || e.label, order: 0, createdAt: STAMP },
      mark: 'persistent', replaceKind: true
    })
    log('landing panel: injected →', newLandingSig.slice(0, 12), dr.ok ? 'ok' : dr.error)
  } else {
    log('landing panel: SKIPPED (could not read landing html)')
  }
}

const STAMP = Number(process.env.DP_STAMP || 1782600000000)

async function main() {
  const file = process.argv[2]
  if (!file) { console.error('usage: _ai-privacy-build.cjs <data.json> [--slugs a,b]'); process.exit(1) }
  let entries = JSON.parse(readFileSync(file, 'utf8'))
  const si = process.argv.indexOf('--slugs')
  if (si >= 0 && process.argv[si + 1]) {
    const want = new Set(process.argv[si + 1].split(','))
    entries = entries.filter(e => want.has(e.slug))
  }
  console.log(`Building ${entries.length} data-privacy profile(s)…`)
  for (const e of entries) {
    console.log(`\n• ${e.label} (ai-inside/${e.slug})`)
    try { await buildOne(e) } catch (err) { console.log(`  [${e.slug}] ERROR:`, err.message) }
  }
  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(2) })
