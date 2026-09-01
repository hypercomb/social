// Rebuild broken `children` lists from a trusted census.
//
// Parents index their children by name. When that list is short or empty the
// cells still EXIST and still resolve by path (they are addressed through
// their own lineage bag) — but anything that walks the tree by children, in
// particular the publish closure walk, cannot see them. Measured 2026-08-04:
// the walk reached 98 of 458 cells, and a publish faithfully carried exactly
// those 98 while reporting "zero holes".
//
// Source of truth is a census produced by walk.cjs, which learns child names
// from LAYER BYTES. Do NOT derive names from `inflate` — it is unreliable on
// fresh subtrees, and a re-link built on it truncated six lists here.
//
// Repairs only parents whose live list is SHORTER than the census; never
// removes a name, never reorders beyond the census order, never invents one.
// Each name is confirmed to resolve by path before it is written.
//
// Usage: node repair-children.cjs <census.json> [--apply]   (default: dry run)
const WebSocket = require('ws')
const fs = require('fs')
const BRIDGE = 'ws://127.0.0.1:2401'
const APPLY = process.argv.includes('--apply')
const CENSUS = process.argv[2]
let counter = 0

function send(req, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const id = `repair-${Date.now()}-${++counter}`
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, timeoutMs)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', raw => { clearTimeout(timer); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
    ws.on('error', err => { clearTimeout(timer); reject(err) })
  })
}

async function sendRetry(req, tries = 5) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const r = await send(req)
      if (r.ok) return r
      last = r.error
      if (/no renderer/.test(r.error || '')) { await new Promise(s => setTimeout(s, 8000)); continue }
      return r
    } catch (e) { last = e.message; await new Promise(s => setTimeout(s, 4000)) }
  }
  return { ok: false, error: `retries exhausted: ${last}` }
}

// Child names come from the ONE shared implementation
// (scripts/lib/hive-children.mjs). This read decoded them with
// `get-resource`, which CANNOT work: a parent's `children` slot holds LAYER
// sigs, and a layer sig is not a resource, so EVERY parent read as empty.
// In a repair tool that is the worst possible failure: `live` came back `[]`,
// so every parent looked broken, and the census list was written over the
// slot as a SET — dropping any live child the census did not name.
let namesOfChildSigs
async function bindHiveHelpers() {
  const { hiveChildren } = await import('../lib/hive-children.mjs')
  ;({ namesOfChildSigs } = hiveChildren(sendRetry))
}

/** Child names as the LAYER BYTES report them. Throws rather than
 *  under-report a parent whose children will not decode. */
const liveChildNames = async (layer) => namesOfChildSigs(layer?.children || [], 'a parent')

async function main() {
  await bindHiveHelpers()
  if (!CENSUS || !fs.existsSync(CENSUS)) {
    console.error('usage: node repair-children.cjs <census.json> [--apply]')
    process.exit(1)
  }
  const census = JSON.parse(fs.readFileSync(CENSUS, 'utf8'))
  const want = new Map(
    census.filter(c => c.path && Array.isArray(c.childNames) && c.childNames.length)
      .map(c => [c.path.join('/'), c.childNames]))

  const plan = []
  for (const [key, names] of want) {
    const segs = key.split('/')
    const lr = await sendRetry({ op: 'layer-at', segments: segs })
    if (!lr.ok) { console.log(`? /${key} unreadable: ${lr.error}`); continue }
    const live = await liveChildNames(lr.data)
    if (live.length >= names.length) continue          // healthy, leave alone

    // Union: keep everything live already has, restore what is missing.
    const merged = [...names]
    for (const n of live) if (!merged.includes(n)) merged.push(n)

    // Never write a name that does not resolve as a real cell.
    const confirmed = []
    for (const n of merged) {
      const probe = await sendRetry({ op: 'layer-at', segments: [...segs, n] }, 2)
      if (probe.ok) confirmed.push(n)
      else console.log(`  ! /${key}/${n} does not resolve — omitted`)
    }
    if (confirmed.length > live.length) plan.push({ segs, key, live, confirmed, layer: lr.data })
  }

  console.log(`\n=== ${plan.length} parent(s) to repair ===`)
  for (const p of plan) {
    console.log(`\n/${p.key}   ${p.live.length} -> ${p.confirmed.length}`)
    console.log(`   now:     ${p.live.join(', ') || '(empty)'}`)
    console.log(`   restore: ${p.confirmed.join(', ')}`)
  }
  const total = plan.reduce((n, p) => n + (p.confirmed.length - p.live.length), 0)
  console.log(`\n${total} child link(s) would be restored across ${plan.length} parent(s).`)
  if (!APPLY) { console.log('DRY RUN — nothing written. Re-run with --apply to commit.'); return }

  let done = 0, failed = 0
  for (const p of plan) {
    // A repair RESTORES links; it must never shrink a parent. `confirmed` is
    // the union of the census and what is live, each name probed to resolve,
    // so it is a superset by construction — assert that before the SET.
    const dropped = p.live.filter(n => !p.confirmed.includes(n))
    if (dropped.length) {
      console.error(`! /${p.key} REFUSED: the write would drop ${dropped.join(', ')}`)
      failed++
      continue
    }
    const res = await sendRetry({
      op: 'update', segments: p.segs,
      layer: { name: p.layer?.name ?? p.segs[p.segs.length - 1], children: p.confirmed },
    })
    if (res.ok) { done++; console.log(`+ /${p.key}`) }
    else { failed++; console.log(`! /${p.key} FAILED: ${res.error}`) }
  }
  console.log(`DONE repaired=${done} failed=${failed}`)
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
