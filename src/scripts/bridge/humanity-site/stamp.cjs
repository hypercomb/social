// Stamp the Humanity Centres site into the live hive via the bridge.
//
//   node scripts/bridge/humanity-site/stamp.cjs --dry   # render only, no writes
//   node scripts/bridge/humanity-site/stamp.cjs         # mint + put + decorate
//
// Mirrors the proven dolphin generator: mint a shared chrome.css resource
// once, then per cell: put-resource(html) → decoration-add(visual:website:page,
// replaceKind:true). decoration-add only touches the `decorations` slot
// (slot-merge cascade) so children/images are preserved — we VERIFY that
// after the first parent stamp before proceeding, as a safety net.

const WebSocket = require('ws')
const { CSS, renderPage, setChromeRef } = require('./engine.cjs')
const { PAGES, LABELS } = require('./pages.cjs')

const BRIDGE = 'ws://localhost:2401'
const DRY = process.argv.includes('--dry')
let counter = 0
const send = (req) => new Promise((resolve, reject) => {
  const id = `stamp-${Date.now()}-${++counter}`
  const ws = new WebSocket(BRIDGE)
  const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 20000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
  ws.on('message', raw => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
  ws.on('error', e => { clearTimeout(t); reject(e) })
})

const KIND = 'visual:website:page'
const now = Date.now()

async function putPage(page) {
  const html = renderPage(page, 'app', LABELS)
  if (DRY) return { sig: '(dry)', bytes: html.length }
  const put = await send({ op: 'put-resource', text: html })
  if (!put.ok) throw new Error(`put-resource failed for /${page.segments.join('/')}: ${put.error}`)
  return { sig: put.data.sig, bytes: html.length }
}

async function decorate(page, htmlSig) {
  if (DRY) return { sig: '(dry)' }
  const dec = await send({
    op: 'decoration-add',
    segments: page.segments,
    kind: KIND,
    appliesTo: page.segments,
    payload: { htmlSig, order: 0, createdAt: now },
    mark: 'persistent',
    replaceKind: true,
  })
  if (!dec.ok) throw new Error(`decoration-add failed for /${page.segments.join('/')}: ${dec.error}`)
  return dec.data
}

function imgSig(node) {
  const p = (node?.properties || [])[0]
  return p?.small?.image?.$sig || p?.flat?.small?.image?.$sig || null
}

;(async () => {
  console.log(`${DRY ? '[DRY RUN] ' : ''}Stamping ${PAGES.length} pages.\n`)

  // 1. Mint shared chrome.css ONCE (deduped by signature).
  let chromeSig = '(dry)'
  if (!DRY) {
    const put = await send({ op: 'put-resource', text: CSS })
    if (!put.ok) { console.error('chrome.css put-resource FAILED:', put.error); process.exit(1) }
    chromeSig = put.data.sig
  }
  setChromeRef(`resource:${chromeSig}/chrome.css`)
  console.log(`chrome.css → ${chromeSig.slice(0, 16)} (${CSS.length} bytes)\n`)

  // 2. Safety probe: stamp a PARENT cell first, then confirm its children
  //    and image survive the decorations cascade before doing the rest.
  const probe = PAGES.find(p => p.segments.join('/') === 'humanity-centres/programs')
  if (!DRY && probe) {
    const before = await send({ op: 'inflate', segments: probe.segments })
    const beforeKids = (before.data?.children || []).map(c => c.name)
    const beforeImg = imgSig(before.data)
    const { sig } = await putPage(probe)
    await decorate(probe, sig)
    const after = await send({ op: 'inflate', segments: probe.segments })
    const afterKids = (after.data?.children || []).map(c => c.name)
    const afterImg = imgSig(after.data)
    const kidsOk = beforeKids.length === afterKids.length && beforeKids.every(k => afterKids.includes(k))
    const imgOk = beforeImg === afterImg
    console.log(`SAFETY PROBE /programs: children ${beforeKids.length}→${afterKids.length} ${kidsOk ? 'OK' : 'CHANGED!'}, image ${imgOk ? 'OK' : 'CHANGED!'}`)
    if (!kidsOk || !imgOk) {
      console.error('\nABORT: decoration-add altered children/image. Not stamping further.')
      process.exit(2)
    }
    console.log('Safety probe passed — children & image preserved.\n')
  }

  // 3. Stamp the rest (skip the probe page, already done).
  let ok = 0, failed = 0
  for (const page of PAGES) {
    const path = '/' + page.segments.join('/')
    if (!DRY && probe && page === probe) { ok++; console.log(`  ${path.padEnd(52)} (probe, done)`); continue }
    try {
      const { sig, bytes } = await putPage(page)
      const dec = await decorate(page, sig)
      console.log(`  ${path.padEnd(52)} ${String(bytes).padStart(6)}b  html=${sig.slice(0, 12)}${DRY ? '' : `  dec=${String(dec.sig).slice(0, 12)}`}`)
      ok++
    } catch (e) {
      console.log(`  ${path.padEnd(52)} FAILED: ${e.message}`)
      failed++
    }
  }

  // 4. Final structural confirmation.
  if (!DRY) {
    const root = await send({ op: 'inflate', segments: ['humanity-centres'] })
    const kids = (root.data?.children || []).map(c => c.name)
    console.log(`\nRoot /humanity-centres children intact: [${kids.join(', ')}]`)
  }
  console.log(`\n${DRY ? '[DRY] ' : ''}Done. chrome=${chromeSig.slice(0, 12)} · ${ok} stamped · ${failed} failed.`)
})().catch(e => { console.error('FATAL', e.message); process.exit(2) })
