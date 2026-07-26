// watch-asks.cjs — park-and-wake watcher for hive asks.
//
// The hive slash commands `/opus`, `/sonnet`, `/haiku <question>` mint a
// `kind:'ask'` optimization (llm.queen.ts) targeting the current selection
// (else the current page). This watcher checks the pending
// pool through the RUNNING broker every few seconds and prints ONE JSON LINE
// per ask it hasn't seen before — nothing else. It is built to sit under a
// persistent Claude Code Monitor: each printed line wakes the session, the
// session answers over the bridge (`_ask-drain.cjs answer …`), and the
// watcher stays parked. Silence means "parked and healthy".
//
//   node scripts/bridge/watch-asks.cjs           → watch forever (Monitor mode)
//   node scripts/bridge/watch-asks.cjs --once    → one tick, then exit (smoke)
//   ASK_POLL_MS=6000                             → poll cadence (default 6s)
//
// Zero changes to the live broker or renderer: it speaks the same
// request/response envelope every scripts/bridge client uses. The poll is
// localhost, read-only (`optimization-list kind:'ask'`), one request per
// tick — the cheap half of park-and-wake; the expensive half (the model)
// runs only when a line prints.
//
// Output contract (line-buffered, one JSON object per line):
//   { "ask": "<sig>", "prompt": "...", "model": "opus|sonnet|haiku",
//     "targets": [...], "segments": [...], "appliesTo": [...] }
//   { "watch": "bridge-unreachable" }   ← only after 3 consecutive bad ticks
//   { "watch": "renderer-missing" }     ← only after 3 consecutive bad ticks
//   { "watch": "recovered" }            ← once, after a REPORTED outage heals
//
// Debounce rationale: the renderer tab's socket flaps when the browser
// throttles a backgrounded tab (drop + 3s reconnect). A single-tick miss is
// noise; a persistent one is an outage worth a wake-up.

const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const POLL_MS = Math.max(2_000, Number(process.env.ASK_POLL_MS || 6_000))
const ONCE = process.argv.includes('--once')

let counter = 0
const nextId = () => `askwatch-${Date.now()}-${++counter}`

function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { try { ws.close() } catch {} ; reject(new Error('bridge timeout')) }, 10_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: nextId() })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      ws.close()
    })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

const seen = new Set()
const OUTAGE_TICKS = 3
// ONE failure counter across ALL reasons: a churning renderer alternates
// between refusals, timeouts, and 'no renderer' — per-reason counters reset
// each other and the debounce never fires (or fires late). Any 3 consecutive
// bad ticks (each already retried once in-tick) = a real outage; the LAST
// reason observed is what gets reported.
let failCount = 0
let reportedOutage = false

function onFail(reason) {
  failCount++
  // Both renderer-side failures are CHURN signatures — a dev-server rebuild
  // reloads the tab (clean disconnect → renderer-missing) and a throttled or
  // half-dead socket times out — and both self-heal within seconds. They only
  // matter if they STICK, so both get the long fuse (~1 min of consecutive
  // failure). `bridge-unreachable` (connect refused = no broker at all) keeps
  // the short fuse: that one is a process being gone, not churn.
  const churn = reason === 'bridge-timeout' || reason === 'renderer-missing'
  const threshold = ONCE ? 1 : (churn ? 10 : OUTAGE_TICKS)
  if (failCount >= threshold && !reportedOutage) {
    reportedOutage = true
    console.log(JSON.stringify({ watch: reason }))
  }
}

// One attempt = one request. 'bridge-timeout' (broker up, reply lost — the
// renderer-churn signature) is distinct from 'bridge-unreachable' (connect
// refused: no broker).
async function attempt() {
  let r
  try {
    r = await send({ op: 'optimization-list', kind: 'ask' })
  } catch (e) {
    return { fail: /timeout/i.test(String(e?.message)) ? 'bridge-timeout' : 'bridge-unreachable' }
  }
  if (!r.ok) return { fail: 'renderer-missing' }
  return { ok: true, r }
}

async function tick() {
  let a = await attempt()
  if (a.fail && !ONCE) {
    // The renderer reconnects on a ~3s cycle — one in-tick retry rides it out.
    await new Promise(res => setTimeout(res, 2_000))
    a = await attempt()
  }
  if (a.fail) { onFail(a.fail); return }
  failCount = 0
  if (reportedOutage) { reportedOutage = false; console.log(JSON.stringify({ watch: 'recovered' })) }
  const r = a.r
  for (const it of r.data?.items ?? []) {
    const sig = String(it.sig || '')
    if (!sig || seen.has(sig)) continue
    seen.add(sig)
    console.log(JSON.stringify({
      ask: sig,
      // mode 'chat' = a refinement-conversation turn: reply via the
      // `chat-reply` bridge op (cell=convoId, text=reply) then retire —
      // NEVER note-add. Absent mode = classic note-bound ask.
      mode: it.payload?.mode ?? '',
      convoId: it.payload?.convoId ?? '',
      prompt: it.payload?.prompt ?? '',
      transcript: it.payload?.transcript ?? [],
      model: it.payload?.model ?? '',
      targets: it.payload?.targets ?? [],
      segments: it.payload?.segments ?? [],
      appliesTo: it.appliesTo ?? [],
    }))
  }
}

async function main() {
  await tick()
  if (ONCE) return
  for (;;) {
    await new Promise(r => setTimeout(r, POLL_MS))
    await tick()
  }
}

main().catch(err => { console.error(String(err)); process.exit(1) })
