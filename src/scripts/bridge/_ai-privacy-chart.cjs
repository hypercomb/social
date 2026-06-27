// Builds the `ai-inside/data-privacy` comparison page — a color-coded
// matrix + posture ranking across every company that has a structured
// data-privacy block. Reads the same data.json the builder uses, mints
// the page, attaches the decoration, and links it from the ai-inside home.
//
//   node scripts/bridge/_ai-privacy-chart.cjs <data.json>

const WebSocket = require('ws')
const { readFileSync } = require('fs')

const BRIDGE = 'ws://localhost:2401'
const CHROME = 'e262da8308c237671918e948b7eaacf6c87e503262eb842658e01b976d45925a'
const STAMP = Number(process.env.DP_STAMP || 1782600000000)

let counter = 0
const nextId = () => `dpc-${Date.now()}-${++counter}`
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
    try { const r = await send(req); if (r.ok || r.error !== 'no renderer connected') return r }
    catch (e) { if (i === attempts - 1) throw e }
    await new Promise(r => setTimeout(r, 1500))
  }
  return { ok: false, error: 'renderer never connected' }
}
async function putResource(text) { const r = await ask({ op: 'put-resource', text }); if (!r.ok) throw new Error('put: ' + r.error); return r.data.sig }
async function getResource(sig) { const r = await ask({ op: 'get-resource', sig }); if (!r.ok) throw new Error('get: ' + r.error); return r.data.encoding === 'text' ? r.data.text : Buffer.from(r.data.base64, 'base64').toString('utf8') }

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const C = { green: '#46d39a', lime: '#9bd45e', amber: '#f5c451', orange: '#ff9a6b', red: '#ff7a8a', grey: '#6b7a8d' }

// each returns { t: shortLabel, c: color }
const cell = {
  trains: d => d.trainsConsumerDefault === true ? { t: 'Default', c: C.red } : d.trainsConsumerDefault === false ? { t: 'Opt-in', c: C.green } : d.trainsConsumerDefault === 'partial' ? { t: 'Partial', c: C.amber } : { t: 'N/A', c: C.grey },
  optout: d => d.consumerOptOut === true ? { t: 'Yes', c: C.green } : d.consumerOptOut === 'partial' ? { t: 'EU/UK', c: C.amber } : d.consumerOptOut === false ? { t: 'No', c: C.red } : { t: '—', c: C.grey },
  ent: d => d.enterpriseNoTrain === true ? { t: 'Yes', c: C.green } : d.enterpriseNoTrain === false ? { t: 'No', c: C.red } : { t: 'N/A', c: C.grey },
  zdr: d => d.zdr === true ? { t: 'Yes', c: C.green } : d.zdr === 'partial' ? { t: 'Partial', c: C.amber } : d.zdr === false ? { t: 'No', c: C.red } : { t: '—', c: C.grey },
  ads: d => d.sharesForAds === 'none' ? { t: 'No', c: C.green } : d.sharesForAds === 'limited' ? { t: 'Limited', c: C.amber } : { t: 'Core', c: C.red },
  sells: d => d.sellsData === true ? { t: 'Yes', c: C.red } : d.sellsData === false ? { t: 'No', c: C.green } : { t: '—', c: C.grey },
  scrape: d => d.publicScrape === true ? { t: 'Yes', c: C.amber } : d.publicScrape === false ? { t: 'No', c: C.green } : { t: '—', c: C.grey },
}
const postureColor = p => [C.red, C.orange, C.amber, C.lime, C.green][Math.max(1, Math.min(5, p)) - 1]

const COLS = [
  ['Trains on you', 'trains'], ['Opt-out', 'optout'], ['Enterprise no-train', 'ent'],
  ['Zero-retention', 'zdr'], ['Ads', 'ads'], ['Sells', 'sells'], ['Web scrape', 'scrape']
]

function chartPage(entries) {
  const rows = [...entries].sort((a, b) => b.data.posture - a.data.posture || a.label.localeCompare(b.label))
  const thead = `<th class="cl">Company</th>` + COLS.map(c => `<th>${esc(c[0])}</th>`).join('') + `<th>Retention</th><th>Posture</th>`
  const tbody = rows.map(e => {
    const d = e.data
    const tds = COLS.map(([, fn]) => { const v = cell[fn](d); return `<td><span class="pill" style="--pc:${v.c}">${esc(v.t)}</span></td>` }).join('')
    const pc = postureColor(d.posture)
    return `<tr><td class="cl"><a href="/ai-inside/${e.slug}/data-privacy">${esc(e.label)}</a><span class="sub">${esc(e.product)}</span></td>${tds}<td class="ret">${esc(d.retention)}</td><td><span class="score" style="--pc:${pc}">${d.posture}<i>/5</i></span></td></tr>`
  }).join('')

  // posture ranking bars
  const bars = rows.map(e => {
    const pc = postureColor(e.data.posture)
    return `<div class="bar"><span class="bl"><a href="/ai-inside/${e.slug}/data-privacy">${esc(e.label)}</a></span><span class="bt"><i style="width:${e.data.posture * 20}%;background:${pc}"></i></span><span class="bn">${e.data.posture}/5</span></div>`
  }).join('')

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Data &amp; Privacy — Who Does What</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet"><link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"><link rel="stylesheet" href="resource:${CHROME}/chrome.css"><style>:root{--accentc:#7ec0ff}.legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:22px;font-size:13px;color:var(--muted)}.legend span{display:inline-flex;align-items:center;gap:7px}.legend i{width:11px;height:11px;border-radius:50%;display:inline-block}.tscroll{overflow-x:auto;border:1px solid var(--line);border-radius:16px;margin-top:18px;background:var(--card)}table.m{border-collapse:collapse;width:100%;min-width:840px;font-size:13px}table.m th,table.m td{padding:11px 12px;text-align:center;border-bottom:1px solid var(--line);white-space:nowrap}table.m thead th{position:sticky;top:0;background:#0b1018;color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:600}table.m td.cl,table.m th.cl{text-align:left;position:sticky;left:0;background:#0b1018;z-index:1}table.m td.cl a{font-weight:700;color:var(--ink)}table.m td.cl .sub{display:block;font-size:11px;color:var(--muted);font-weight:400}table.m tbody tr:hover td{background:rgba(126,182,214,.06)}table.m tbody tr:hover td.cl{background:#0d141d}.pill{display:inline-block;min-width:58px;padding:4px 9px;border-radius:999px;font-size:12px;font-weight:600;color:#06090d;background:var(--pc)}.ret{color:var(--muted);font-size:12px;white-space:normal;max-width:160px;text-align:left}.score{display:inline-flex;align-items:baseline;gap:1px;font-weight:800;font-size:15px;color:var(--pc)}.score i{font-style:normal;font-size:11px;color:var(--muted);font-weight:600}.rank{margin-top:14px;display:grid;gap:9px}.bar{display:grid;grid-template-columns:160px 1fr 42px;align-items:center;gap:12px}.bar .bl a{color:var(--ink);font-weight:600;font-size:14px}.bar .bt{height:10px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden}.bar .bt i{display:block;height:100%;border-radius:999px}.bar .bn{font-size:13px;color:var(--muted);text-align:right}@media(max-width:640px){.bar{grid-template-columns:110px 1fr 38px}}</style></head><body><div class="wrap"><div class="crumb"><a href="/ai-inside"><span class="ms">arrow_back</span> AI Inside</a> <span>/</span> Data &amp; Privacy</div><div class="hero"><div class="eyebrow">Cross-company comparison</div><h1>AI Data &amp; Your Privacy</h1><p class="lede">How the major AI companies treat the data you give them — what they train on, how they share personal data, and the controls you actually get. Each row links to a full profile. ‘Privacy posture’ is a 1–5 read of how user-protective the defaults are (higher is better).</p><div class="legend"><span><i style="background:${C.green}"></i>User-friendly</span><span><i style="background:${C.amber}"></i>Mixed / conditional</span><span><i style="background:${C.red}"></i>Concerning for users</span><span><i style="background:${C.grey}"></i>Not applicable</span></div></div><div class="sec-title"><span class="ms">table_chart</span>The matrix<span class="count">${entries.length} companies</span></div><div class="tscroll"><table class="m"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div><div class="sec-title"><span class="ms">leaderboard</span>Privacy posture ranking</div><div class="rank">${bars}</div><div class="panel" style="margin-top:30px"><h3><span class="ms">info</span>How to read this</h3><p>‘Trains on you’ = whether your consumer conversations train their models by <strong>default</strong> (Default = yes unless you opt out; Opt-in = off unless you turn it on). ‘Enterprise no-train’ reflects business/API tiers. ‘Zero-retention’ is an available no-storage mode. ‘Ads’ is whether your data feeds ad targeting. This is a living comparison — figures reflect publicly stated policies and reporting and can change; each profile lists its sources.</p></div><div class="foot"><span>AI Inside — examining how AI handles data &amp; privacy</span><span>Hypercomb hive</span></div></div></body></html>`
}

function rootCard(count) {
  return `<div class="panel" data-dp-overview="1" style="border-color:rgba(126,182,214,.4)"><h3><span class="ms">policy</span>Featured · Data &amp; Privacy</h3><p>A cross-company comparison of how these ${count}+ AI companies consume your data and share personal information — color-coded matrix, controls, and a privacy-posture ranking.</p><p><a href="/ai-inside/data-privacy">Open the Data &amp; Privacy comparison &rarr;</a></p></div>`
}

async function main() {
  const file = process.argv[2]
  if (!file) { console.error('usage: _ai-privacy-chart.cjs <data.json>'); process.exit(1) }
  const entries = JSON.parse(readFileSync(file, 'utf8'))
  console.log(`Chart over ${entries.length} companies…`)

  // 1. ensure the cell
  const add = await ask({ op: 'add', segments: ['ai-inside'], cells: ['data-privacy'] })
  console.log('add cell:', add.ok ? 'ok' : ('(' + (add.error || 'exists') + ')'))

  // 2. mint + attach the page
  const sig = await putResource(chartPage(entries))
  console.log('page minted:', sig.slice(0, 12))
  const dec = await ask({
    op: 'decoration-add', segments: ['ai-inside', 'data-privacy'], kind: 'visual:website:page', appliesTo: ['ai-inside', 'data-privacy'],
    payload: { htmlSig: sig, icon: 'policy', label: 'Data & Privacy', order: 0, createdAt: STAMP }, mark: 'persistent', replaceKind: true
  })
  console.log('decoration:', dec.ok ? (dec.unchanged ? 'unchanged' : 'ok') : dec.error)

  // 3. note on the overview cell
  const notes = await ask({ op: 'note-list', segments: ['ai-inside', 'data-privacy'] })
  const have = (notes.ok && Array.isArray(notes.data)) ? notes.data : []
  if (!have.some(n => String(n.text || '').startsWith('Data & Privacy overview'))) {
    await ask({ op: 'note-add', segments: ['ai-inside'], cell: 'data-privacy', text: `Data & Privacy overview — cross-company comparison of AI data consumption and personal-data sharing across ${entries.length} companies. Built from each company's data-privacy structured block (schema ai-data-privacy/v1). Columns: training default, consumer opt-out, enterprise no-train, zero-retention, ad use, data sale, web scraping, retention, privacy posture (1-5).` })
    console.log('note: added')
  } else console.log('note: present')

  // 4. link from the ai-inside home (idempotent)
  const root = await ask({ op: 'layer-at', segments: ['ai-inside'] })
  const rdecos = (root.ok && root.data && Array.isArray(root.data.decorations)) ? root.data.decorations : []
  let rootPayload = null
  for (const s of rdecos) { try { const rec = JSON.parse(await getResource(s)); if (rec.kind === 'visual:website:page' && rec.payload && rec.payload.htmlSig) { rootPayload = rec.payload; break } } catch {} }
  if (rootPayload) {
    const cur = await getResource(rootPayload.htmlSig.$sig || rootPayload.htmlSig)
    if (cur.includes('/ai-inside/data-privacy')) console.log('home link: already present')
    else {
      const card = rootCard(entries.length)
      const next = cur.includes('<div class="sec-title">') ? cur.replace('<div class="sec-title">', card + '<div class="sec-title">') : cur.replace('<div class="foot">', card + '<div class="foot">')
      const newSig = await putResource(next)
      const dr = await ask({ op: 'decoration-add', segments: ['ai-inside'], kind: 'visual:website:page', appliesTo: ['ai-inside'], payload: { htmlSig: newSig, icon: rootPayload.icon || 'hub', label: rootPayload.label || 'AI Inside', order: 0, createdAt: STAMP }, mark: 'persistent', replaceKind: true })
      console.log('home link: injected →', newSig.slice(0, 12), dr.ok ? 'ok' : dr.error)
    }
  } else console.log('home link: SKIPPED (no root page)')
  console.log('Done.')
}
main().catch(e => { console.error(e); process.exit(2) })
