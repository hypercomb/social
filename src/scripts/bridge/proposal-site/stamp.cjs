// Stamp a proposal site into the live hive over the bridge.
//
//   node scripts/bridge/proposal-site/stamp.cjs <proposal> --dry   # render only
//   node scripts/bridge/proposal-site/stamp.cjs <proposal>         # write tiles + pages
//
// Makes /<lineage> and one child tile per page (merge-safe: existing children
// are kept), then gives each tile its own page: put-resource(html) →
// decoration-add(visual:website:page, replaceKind). This writes to the hive
// only. Publishing the site to <lineage>.hypercomb.com is a separate act,
// from the Publish panel or `npm run publish:content -- <lineage> --r2`.

const WebSocket = require('ws')
const { renderPage } = require('./engine.cjs')

const BRIDGE = 'ws://localhost:2401'
const name = process.argv[2]
const DRY = process.argv.includes('--dry')
if (!name || name.startsWith('--')) { console.error('usage: stamp.cjs <proposal> [--dry]'); process.exit(1) }
const site = require('./load-site.cjs').loadSite(name)

let counter = 0
const send = (req) => new Promise((resolve, reject) => {
  const ws = new WebSocket(BRIDGE)
  const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 30000)
  ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `proposal-${Date.now()}-${++counter}` })))
  ws.on('message', raw => { clearTimeout(t); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
  ws.on('error', e => { clearTimeout(t); reject(e) })
})

async function children(segments) {
  const res = await send({ op: 'inflate', segments })
  if (!res.ok) return null
  return { name: String(res.data?.name ?? ''), children: (res.data?.children ?? []).map(c => String(c?.name ?? '')).filter(Boolean) }
}

// Union `wanted` after the live membership, so nothing already there is lost.
async function ensureChildren(segments, selfName, wanted) {
  const live = (await children(segments)) ?? { name: selfName, children: [] }
  const missing = wanted.filter(w => !live.children.includes(w))
  if (!missing.length) return
  const res = await send({ op: 'update', segments, layer: { name: live.name || selfName, children: [...live.children, ...missing] } })
  if (!res.ok) throw new Error(`update /${segments.join('/')} failed: ${res.error}`)
  console.log(`  /${segments.join('/') || '(root)'} + ${missing.join(', ')}`)
}

;(async () => {
  const root = site.lineage
  const segmentsOf = (page) => page.slug ? [root, page.slug] : [root]
  console.log(`${DRY ? '[DRY] ' : ''}${site.domain}: ${site.pages.length} pages under /${root}\n`)

  if (!DRY) {
    const probe = await send({ op: 'layer-at', segments: [] }).catch(e => ({ ok: false, error: e.message }))
    if (!probe.ok) { console.error(`ABORT: no renderer on the bridge (${probe.error}).`); process.exit(1) }
    const hive = await children([])
    if (!hive) { console.error('ABORT: cannot read the hive root.'); process.exit(1) }
    await ensureChildren([], hive.name, [root])
    await ensureChildren([root], root, site.pages.filter(p => p.slug).map(p => p.slug))
  }

  let ok = 0
  for (const page of site.pages) {
    const segments = segmentsOf(page)
    const html = renderPage(site, page, 'app')
    let htmlSig = '(dry)'
    if (!DRY) {
      const put = await send({ op: 'put-resource', text: html })
      if (!put.ok) throw new Error(`put-resource /${segments.join('/')}: ${put.error}`)
      htmlSig = put.data.sig
      const dec = await send({
        op: 'decoration-add',
        segments,
        kind: 'visual:website:page',
        appliesTo: segments,
        payload: { htmlSig, label: page.title, order: 0, createdAt: Date.now() },
        mark: 'persistent',
        replaceKind: true,
      })
      if (!dec.ok) throw new Error(`decoration-add /${segments.join('/')}: ${dec.error}`)
    }
    console.log(`  /${segments.join('/').padEnd(28)} ${String(html.length).padStart(6)}b  ${htmlSig.slice(0, 12)}`)
    ok++
  }

  if (!DRY) {
    const after = await children([root])
    const want = site.pages.filter(p => p.slug).map(p => p.slug)
    const missing = want.filter(w => !after?.children.includes(w))
    console.log(`\nverify /${root}: ${missing.length ? `MISSING ${missing.join(', ')}` : `all ${want.length} page tiles present`}`)
    const rev = await send({ op: 'build-record', segments: [root], label: `${site.domain} build` })
    console.log(rev.ok ? `build revision ${rev.data.label}${rev.data.unchanged ? ' (unchanged)' : ''}` : `build revision FAILED: ${rev.error}`)
  }
  console.log(`\n${DRY ? '[DRY] ' : ''}${ok} pages stamped.`)
})().catch(e => { console.error('FATAL', e.message); process.exit(2) })
