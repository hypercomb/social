// Dedupe the visual:game:play record on /games/arkanoid.
//
//   node scripts/bridge/_arkanoid-dedupe.cjs [--dry]
//
// The tile's decorations bag holds the SAME record sig twice (a blind
// whole-array append by an exited session — LayerMachine's `append` op
// refuses duplicates, but `set` used to write the caller's array verbatim).
// One decoration-add with replaceKind:true collapses both entries and
// re-appends the record once, in ONE commit: the worker's replaceKind scan
// drops every prior entry whose sig or kind matches before the append.
//
// The record itself is read from the hive and sent back verbatim, so the
// minted sig is the SAME sig — nothing about the record changes, only how
// many times the bag points at it. view:default (postit — deliberate until
// the game view deploys) and the post-it record are not touched; the
// verify asserts all three survivors.
//
// Idempotent: a bag already holding the record once reads as clean and the
// script exits without writing.

const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const DRY = process.argv.includes('--dry')
const SEGMENTS = ['games', 'arkanoid']
const KIND = 'visual:game:play'
const log = (...a) => console.log(...a)

// ── transport (the _moose-paint pattern) ──────────────────────────────
let ws, pending = new Map(), seq = 0, connected = null
async function connect() {
  if (connected) return connected
  connected = new Promise((res, rej) => {
    ws = new WebSocket(BRIDGE, { maxPayload: 128 * 1024 * 1024 })
    ws.on('open', () => res(ws))
    ws.on('error', rej)
    ws.on('close', () => { connected = null; for (const [, p] of pending) p.rej(new Error('socket closed')); pending.clear() })
    ws.on('message', raw => {
      let m; try { m = JSON.parse(String(raw)) } catch { return }
      const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); p.res(m) }
    })
  })
  return connected
}
async function call(req, timeoutMs = 90_000) {
  await connect()
  const id = `ad-${Date.now()}-${++seq}`
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { pending.delete(id); rej(new Error('bridge timeout: ' + req.op)) }, timeoutMs)
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

// ── guard: never write into the wrong hive ────────────────────────────
async function assertRightHive() {
  const r = await ask({ op: 'layer-at', segments: ['revolucion', 'meetup'] })
  if (!r.ok || r.data?.name !== 'meetup') {
    throw new Error('WRONG HIVE — /revolucion/meetup does not resolve. A stray tab stole the broker slot.')
  }
}

async function readBag() {
  const layer = await ask({ op: 'layer-at', segments: SEGMENTS })
  if (!layer.ok) throw new Error(`/${SEGMENTS.join('/')} does not resolve: ` + layer.error)
  const sigs = Array.isArray(layer.data?.decorations) ? layer.data.decorations : []
  const entries = []
  for (const sig of sigs) {
    const r = await ask({ op: 'get-resource', sig })
    let record = null
    if (r.ok) { try { record = JSON.parse(r.data.text) } catch {} }
    entries.push({ sig: String(sig), record })
  }
  return entries
}

async function main() {
  await assertRightHive()
  log(`deduping ${KIND} on /${SEGMENTS.join('/')}${DRY ? ' (dry)' : ''}`)

  const before = await readBag()
  const game = before.filter(e => e.record?.kind === KIND)
  const others = before.filter(e => e.record?.kind !== KIND)
  log(`  bag        : ${before.length} entries — ${game.length}× ${KIND}, ${others.length} other`)
  for (const e of before) log(`    ${e.sig.slice(0, 12)} ${e.record?.kind ?? '(unreadable)'}`)

  if (game.length <= 1) { log('  already clean — nothing to do'); try { ws.close() } catch {}; return }
  const distinct = new Set(game.map(e => e.sig))
  if (distinct.size !== 1) {
    throw new Error(`expected identical duplicates, found ${distinct.size} distinct ${KIND} sigs — not touching the bag`)
  }
  const record = game[0].record
  log(`  record     : ${JSON.stringify(record)}`)
  if (DRY) { log('  dry — would replaceKind with the record above'); try { ws.close() } catch {}; return }

  // Send the record back verbatim: same kind/appliesTo/payload/mark mints the
  // same sig, replaceKind drops both prior entries and appends it once.
  const deco = await ask({
    op: 'decoration-add',
    segments: SEGMENTS,
    kind: record.kind,
    appliesTo: record.appliesTo,
    payload: record.payload,
    ...(record.mark ? { mark: record.mark } : {}),
    replaceKind: true,
  })
  if (!deco.ok) throw new Error('decoration-add: ' + deco.error)
  const newSig = String(deco.data.sig)
  log(`  write      : sig ${newSig.slice(0, 12)}… dropped ${deco.data.dropped ?? '?'} count ${deco.data.count ?? '?'}${newSig === game[0].sig ? ' (same sig — record unchanged)' : ' (SIG CHANGED — record re-minted)'}`)

  // Verify by read-back FROM the hive: exactly one game record, every other
  // decoration still present. replaceKind commits async — poll until settled.
  let ok = false, after = []
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, 2500))
    after = await readBag()
    const gameNow = after.filter(e => e.record?.kind === KIND)
    const othersNow = after.filter(e => e.record?.kind !== KIND)
    const othersKept = others.every(o => othersNow.some(n => n.sig === o.sig))
    if (gameNow.length === 1 && gameNow[0].record?.payload?.gameId === 'arkanoid' && othersKept) { ok = true; break }
  }
  log(`  verify     : ${ok ? 'ONE game record, others intact' : 'FAILED'}`)
  for (const e of after) log(`    ${e.sig.slice(0, 12)} ${e.record?.kind ?? '(unreadable)'}`)
  if (!ok) throw new Error('read-back verification FAILED')

  log('done — head is unsealed; publish:run seals at publish time')
  try { ws.close() } catch {}
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1) })
