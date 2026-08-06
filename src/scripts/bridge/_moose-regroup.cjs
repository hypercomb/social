// Moose — regroup the network branch.
//
//   node scripts/bridge/_moose-regroup.cjs [--dry]
//
// The first import put 522 entities flat under /network with names taken from
// full claim titles. That broke two things: it exceeded the 256-slot label
// atlas (tile text blinked — see show-cell.drone.ts eviction bound), and the
// names were far too long to rasterise legibly into a hex.
//
// This pass reads regroup.json (short names, duplicates folded, routed) and:
//   1. replaces /network's children with its new sub-branches — the old flat
//      tiles are EMPTY shells (the notes/marks stages never ran) so nothing
//      is lost, and history holds them anyway
//   2. fills each sub-branch
//   3. moves Brookfield entities under companies/brookfield (the integration
//      rule: one tile per firm) and named people under people/
//
// No layer it creates exceeds 256 children.

const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const DRY = process.argv.includes('--dry')
const PLAN = path.join('C:', 'Users', 'Jaime', 'AppData', 'Local', 'Temp', 'claude',
  'C--Projects-hypercomb-social-src', '794930d7-2799-414e-a615-a4bc6f07d7c6',
  'scratchpad', 'miro', 'regroup.json')
const log = (...a) => console.log(...a)

let ws, pending = new Map(), seq = 0, connected = null
async function connect() {
  if (connected) return connected
  connected = new Promise((res, rej) => {
    ws = new WebSocket(BRIDGE, { maxPayload: 128 * 1024 * 1024 })
    ws.on('open', () => res(ws)); ws.on('error', rej)
    ws.on('close', () => { connected = null; for (const [, p] of pending) p.rej(new Error('socket closed')); pending.clear() })
    ws.on('message', raw => { let m; try { m = JSON.parse(String(raw)) } catch { return }
      const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); p.res(m) } })
  })
  return connected
}
async function call(req, ms = 90_000) {
  await connect()
  const id = `rg-${Date.now()}-${++seq}`
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error('timeout ' + req.op)) }, ms)
    pending.set(id, { res, rej, timer })
    try { ws.send(JSON.stringify({ ...req, id })) } catch (e) { pending.delete(id); clearTimeout(timer); rej(e) }
  })
}
async function ask(req, attempts = 8) {
  let wait = 2000
  for (let i = 0; i < attempts; i++) {
    try { const r = await call(req); if (r.ok || r.error !== 'no renderer connected') return r }
    catch (e) { if (i === attempts - 1) return { ok: false, error: e.message } }
    await new Promise(r => setTimeout(r, wait)); wait = Math.min(wait * 1.7, 30_000); connected = null
  }
  return { ok: false, error: 'renderer never came back' }
}

const nameCache = new Map()
async function childNamesOf(segments) {
  const layer = await ask({ op: 'layer-at', segments })
  if (!layer.ok) return null
  const sigs = (layer.data?.children || []).map(String)
  const texts = await Promise.all(sigs.map(async s => {
    if (nameCache.has(s)) return nameCache.get(s)
    const r = await ask({ op: 'get-resource', sig: s })
    const v = r.ok ? r.data.text : null
    nameCache.set(s, v); return v
  }))
  const names = []
  for (const t of texts) { if (!t) continue; try { const n = JSON.parse(t).name; if (n) names.push(n) } catch {} }
  return names
}

async function setChildren(segments, wanted, { replace = false } = {}) {
  const have = await childNamesOf(segments)
  if (have === null) return { ok: false, reason: 'no layer' }
  const target = replace ? wanted : [...have, ...wanted.filter(n => !have.includes(n))]
  if (!replace && target.length === have.length) return { ok: true, added: 0, total: have.length }
  if (replace && target.length === have.length && target.every((n, i) => have[i] === n)) return { ok: true, added: 0, total: have.length }
  if (DRY) return { ok: true, added: target.length - have.length, dry: true }
  const name = segments[segments.length - 1]
  const BATCH = 100
  // A replace must land in ONE commit (a batched replace would transiently
  // drop children); an append is batched so a huge commit can't freeze the tab.
  if (replace) {
    const r = await ask({ op: 'update', segments, layer: { name, children: target } })
    return r.ok ? { ok: true, replaced: target.length } : { ok: false, reason: r.error }
  }
  let running = [...have], added = 0
  const missing = target.slice(have.length)
  for (let i = 0; i < missing.length; i += BATCH) {
    const slice = missing.slice(i, i + BATCH)
    const r = await ask({ op: 'update', segments, layer: { name, children: [...running, ...slice] } })
    if (!r.ok) return { ok: false, reason: r.error, added }
    running = [...running, ...slice]; added += slice.length
  }
  return { ok: true, added }
}

async function assertRightHive() {
  const names = await childNamesOf([])
  if (!names || !names.includes('moose-on-the-loose')) {
    throw new Error('WRONG HIVE — no /moose-on-the-loose. A stray tab stole the broker slot.\n  root: ' + (names || []).join(', '))
  }
}

async function main() {
  const recs = JSON.parse(fs.readFileSync(PLAN, 'utf8'))
  await assertRightHive()

  const byParent = new Map()
  for (const r of recs) {
    const k = r.segments.join('/')
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k).push(r.name)
  }
  const over = [...byParent.entries()].filter(([, v]) => v.length > 256)
  if (over.length) throw new Error('refusing: layer over the 256-slot label atlas: ' + over.map(([k, v]) => `${k}=${v.length}`).join(', '))

  const netSubs = [...byParent.keys()]
    .filter(k => k.startsWith('moose-on-the-loose/network/'))
    .map(k => k.split('/').pop())
  log(`plan: ${recs.length} tiles, ${byParent.size} parents, network sub-branches: ${netSubs.join(', ')}`)

  // 1. /network — REPLACE the 522 flat shells with the sub-branches.
  log('\n1. replacing /network children')
  const r1 = await setChildren(['moose-on-the-loose', 'network'], netSubs, { replace: true })
  log('   ', JSON.stringify(r1))

  // 2. companies/brookfield needs its `entities` child before it can be filled.
  log('\n2. parents for the moved material')
  for (const segs of [['moose-on-the-loose', 'companies', 'brookfield']]) {
    const subs = [...byParent.keys()].filter(k => k.startsWith(segs.join('/') + '/')).map(k => k.split('/').pop())
    if (subs.length) log('   ', segs.join('/'), JSON.stringify(await setChildren(segs, subs)))
  }

  // 3. fill every parent
  log('\n3. filling')
  for (const [k, kids] of [...byParent.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const segs = k.split('/')
    const r = await setChildren(segs, kids)
    log(`   ${r.ok ? '+' : '!'} ${k}  ${kids.length} wanted  ${JSON.stringify(r)}`)
  }

  log('\ndone')
  try { ws.close() } catch {}
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
