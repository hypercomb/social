// Add /hypercomb/articles/agnostic to the hive and attach the
// "What does it mean to be agnostic?" article as a visual:website:page.
//
// Design rules (same as intel-build-revolucion-lounge.ts):
//   1. Cell names pre-normalized (lowercase-hyphen) — segments == children keys.
//   2. MERGE, never replace: union new children after live membership; `update`
//      sets only the slots present in the payload.
//   3. note-add is NOT idempotent — notes are written only for newly created cells.
//   4. Verify with fresh path-addressed layer-at / get-resource, never deep inflate.
//
// Usage (from monorepo root src/):
//   node scripts/build-hypercomb-articles.cjs <path-to-article-html>

const WebSocket = require('ws')
const fs = require('fs')

const BRIDGE = 'ws://localhost:2401'
const TIMEOUT = 60_000
let counter = 0

function sendOnce(request) {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cli-${Date.now()}-${++counter}` }
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('invalid response')) }
      ws.close()
    })
    ws.on('error', (err) => { clearTimeout(timer); reject(new Error(`bridge connection failed: ${err.message}`)) })
  })
}

async function send(request) {
  const res = await sendOnce(request)
  if (!res.ok && res.error === 'no renderer connected') {
    await new Promise(r => setTimeout(r, 4000))
    return sendOnce(request)
  }
  return res
}

const PATH = ['hypercomb', 'articles', 'agnostic']
const LABEL = 'What does it mean to be agnostic?'
const NOTES = {
  articles: 'Articles about Hypercomb — written from the hive, published outward.',
  agnostic: '"Platform agnostic" is one of the most-used and least-meant phrases in software. This article explains what it looks like when a system actually commits to it: identity by content signature, shells as the disposable part, and the one dependency arrow that keeps it honest.',
}

function wrapDocument(fragment) {
  const cut = fragment.indexOf('</style>')
  if (cut < 0) throw new Error('article HTML missing </style> split point')
  const head = fragment.slice(0, cut + '</style>'.length)
  const body = fragment.slice(cut + '</style>'.length)
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    head + '\n</head>\n<body>' + body + '\n</body>\n</html>\n'
}

async function inflateChildren(segments) {
  const res = await send({ op: 'inflate', segments })
  if (!res.ok) return null
  const node = res.data ?? {}
  return {
    name: String(node.name ?? ''),
    children: (node.children ?? []).map(c => String(c?.name ?? '')).filter(Boolean),
  }
}

async function ensureChild(segments, selfName, existingChildren, child) {
  if (existingChildren.includes(child)) {
    console.log(`[struct] /${segments.join('/') || '(root)'} already holds "${child}" — merge skip`)
    return false
  }
  const merged = [...existingChildren, child]
  process.stdout.write(`[struct] /${segments.join('/') || '(root)'} <- ${merged.length} children (${existingChildren.length} kept, +${child}) ... `)
  const res = await send({ op: 'update', segments, layer: { name: selfName, children: merged } })
  console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  if (!res.ok) process.exit(1)
  return true
}

async function main() {
  const htmlPath = process.argv[2]
  if (!htmlPath) { console.error('usage: node scripts/build-hypercomb-articles.cjs <article.html>'); process.exit(1) }
  const html = wrapDocument(fs.readFileSync(htmlPath, 'utf8'))
  console.log(`[articles] page document: ${html.length} bytes`)

  // Preflight 1: fast probe — renderer connected?
  const probe = await send({ op: 'layer-at', segments: [] }).catch(e => ({ ok: false, error: e.message }))
  if (!probe.ok) {
    console.error(`[articles] ABORT: root layer-at failed (${probe.error}). Renderer connected?`)
    process.exit(1)
  }

  // Preflight 2: identify the OPFS — the real authoring hive holds these roots.
  const root = await inflateChildren([])
  if (!root) { console.error('[articles] ABORT: cannot inflate root'); process.exit(1) }
  console.log(`[articles] root "${root.name}" holds: ${root.children.join(', ') || '(none)'}`)
  const landmarks = ['revolucion', 'dolphin', 'humanity-centres']
  if (!landmarks.some(l => root.children.includes(l))) {
    console.error(`[articles] ABORT: no landmark cell (${landmarks.join('/')}) at root — WRONG OPFS, refusing to write.`)
    process.exit(1)
  }

  // Structure, merge-safe at every level.
  await ensureChild([], root.name, root.children, 'hypercomb')

  const hyper = (await inflateChildren(['hypercomb'])) ?? { name: 'hypercomb', children: [] }
  await ensureChild(['hypercomb'], 'hypercomb', hyper.children, 'articles')

  const articles = (await inflateChildren(['hypercomb', 'articles'])) ?? { name: 'articles', children: [] }
  const createdArticles = articles.children.length === 0 && !hyper.children.includes('articles')
  const createdAgnostic = !articles.children.includes('agnostic')
  await ensureChild(['hypercomb', 'articles'], 'articles', articles.children, 'agnostic')

  if (createdAgnostic) {
    const leaf = await send({ op: 'update', segments: PATH, layer: { name: 'agnostic' } })
    console.log(`[struct] /${PATH.join('/')} ${leaf.ok ? 'ok' : `FAIL: ${leaf.error}`}`)
    if (!leaf.ok) process.exit(1)
  }

  // Notes — only on freshly created cells (note-add duplicates on re-run).
  if (createdArticles) {
    const r = await send({ op: 'note-add', segments: ['hypercomb'], cell: 'articles', text: NOTES.articles })
    console.log(`[note] /hypercomb/articles ${r.ok ? 'ok' : `FAIL: ${r.error}`}`)
  }
  if (createdAgnostic) {
    const r = await send({ op: 'note-add', segments: ['hypercomb', 'articles'], cell: 'agnostic', text: NOTES.agnostic })
    console.log(`[note] /${PATH.join('/')} ${r.ok ? 'ok' : `FAIL: ${r.error}`}`)
  }

  // Mint the HTML and attach the page decoration.
  const put = await send({ op: 'put-resource', text: html })
  if (!put.ok || !/^[0-9a-f]{64}$/.test(String(put.data?.sig ?? ''))) {
    console.error(`[articles] ABORT: put-resource failed: ${put.error ?? JSON.stringify(put.data)}`)
    process.exit(1)
  }
  const htmlSig = put.data.sig
  console.log(`[page] htmlSig ${htmlSig}`)

  const deco = await send({
    op: 'decoration-add',
    segments: PATH,
    kind: 'visual:website:page',
    payload: { htmlSig, icon: 'article', label: LABEL, order: 0, createdAt: Date.now() },
    mark: 'persistent',
    replaceKind: true,
  })
  if (!deco.ok) { console.error(`[articles] ABORT: decoration-add failed: ${deco.error}`); process.exit(1) }
  console.log(`[page] decoration ${deco.data?.sig ?? '(unchanged)'} slot=${deco.data?.slot ?? '-'} unchanged=${deco.unchanged === true || deco.data?.unchanged === true}`)

  // Verify — fresh path-addressed reads.
  for (let depth = 1; depth <= PATH.length; depth++) {
    const seg = PATH.slice(0, depth)
    const res = await send({ op: 'layer-at', segments: seg })
    console.log(`[verify] /${seg.join('/')} ok=${res.ok} children=${Array.isArray(res.data?.children) ? res.data.children.length : 0}`)
  }
  const leafLayer = await send({ op: 'layer-at', segments: PATH })
  const decoSigs = Array.isArray(leafLayer.data?.decorations) ? leafLayer.data.decorations : []
  let pageOk = false
  for (const sig of decoSigs) {
    const r = await send({ op: 'get-resource', sig })
    if (!r.ok) continue
    try {
      const rec = JSON.parse(typeof r.data === 'string' ? r.data : (r.data?.text ?? ''))
      if (rec?.kind === 'visual:website:page' && rec?.payload?.htmlSig === htmlSig) pageOk = true
    } catch { /* not JSON — some other decoration payload */ }
  }
  console.log(`[verify] page decoration present with htmlSig: ${pageOk}`)
  const bytes = await send({ op: 'get-resource', sig: htmlSig })
  const roundTrip = bytes.ok && String(typeof bytes.data === 'string' ? bytes.data : (bytes.data?.text ?? '')).includes('What does it mean to be agnostic?')
  console.log(`[verify] html bytes round-trip: ${roundTrip}`)
  console.log(pageOk && roundTrip
    ? `[articles] DONE — /${PATH.join('/')} carries the article page. Toggle /website to view.`
    : '[articles] COMPLETED WITH WARNINGS — check the verify lines above.')
}

main().catch(err => { console.error(err); process.exit(1) })
