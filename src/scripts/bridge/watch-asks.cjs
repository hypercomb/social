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
//   ASK_SESSION_MODEL=claude-opus-5              → what THIS parked session is
//
// ── AN ASK NAMES ITS MODEL, AND A PARKED SESSION CANNOT BECOME IT ─────────
//
// Every ask carries the model that was DESIGNATED for it (the participant's
// standing instructions, or a word they typed). This watcher's session is one
// model, from one company, and it cannot re-model itself to honour the next
// line it prints — so waking it for an ask designated elsewhere answers the
// question in the wrong voice while looking entirely confident about it.
//
// With `ASK_SESSION_MODEL` set, such an ask is HANDED OFF instead: the
// watcher starts a SILENT SESSION in the designated model — the owning CLI,
// headless, pointed at this same skill, with that CLI's own argv from
// `agent-bridges.json` — and never prints the line. Nothing is dropped: a
// handoff that cannot start (CLI not installed here) or that exits badly
// falls back to printing the line, because a question answered by a different
// model still beats a question nobody answers.
//
// Unset, the watcher behaves exactly as it always did: every ask wakes the
// session. The variable is what the session knows and the script cannot —
// which model it actually is.
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
//   { "stopped": "<sig>" }              ← the participant stopped an ask this
//                                          watcher announced: abort the work,
//                                          write no note, retire nothing else
//   { "watch": "bridge-unreachable" }   ← only after 3 consecutive bad ticks
//   { "watch": "renderer-missing" }     ← only after 3 consecutive bad ticks
//   { "watch": "recovered" }            ← once, after a REPORTED outage heals
//
// Debounce rationale: the renderer tab's socket flaps when the browser
// throttles a backgrounded tab (drop + 3s reconnect). A single-tick miss is
// noise; a persistent one is an outage worth a wake-up.

const { spawn } = require('child_process')
const path = require('path')
const WebSocket = require('ws')
const roster = require('./agent-roster.cjs')

const REPO = path.resolve(__dirname, '..', '..')
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
// Only needed when driving a REMOTE broker (loopback senders are trusted).
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()
const WS_OPTS = TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined
const POLL_MS = Math.max(2_000, Number(process.env.ASK_POLL_MS || 6_000))
const ONCE = process.argv.includes('--once')
/** What this parked session IS — a model word or a wire id, whichever the
 *  session knows itself by. Empty = do not hand anything off. */
const SESSION_MODEL = String(process.env.ASK_SESSION_MODEL || '').trim().toLowerCase()

// ── handing an ask to the model it asked for ─────────────────────────────

/** Probed once: `roster.installed()` runs `--version` per CLI, and the answer
 *  does not change under a parked watcher often enough to pay for it again. */
let installedBridges = null
const bridges = () => (installedBridges ??= roster.installed())

/** Which bridge and which wire model a hint resolves to here — null when
 *  nothing installed owns it (then the parked session takes it, as before). */
function planFor(hint) {
  const agent = roster.agentForModel(String(hint || '').trim(), bridges())
  if (!agent) return null
  return { agent, model: roster.modelIdFor(agent, hint) }
}

/** Is this ask for the model this session already is? Compared as RESOLVED
 *  wire ids, so `opus` and `claude-opus-5` are one answer rather than two. */
function isOwnModel(hint) {
  if (!SESSION_MODEL) return true
  const wanted = planFor(hint)
  if (!wanted) return true
  const mine = planFor(SESSION_MODEL)
  if (!mine) return true
  return wanted.agent.id === mine.agent.id && wanted.model === mine.model
}

/**
 * START A SILENT SESSION in the designated model, for ONE ask.
 *
 * The prompt is vendor-neutral on purpose — the skill file is the contract,
 * and any coding agent with repo access can follow it, which is what lets a
 * bridge be added as data (`agent-bridges.json`) rather than as code. Resolves
 * false when the ask was NOT taken, and the caller prints the line instead.
 */
function handOff(sig, plan) {
  const prompt = [
    `One hive ask (${sig}) is pending on the Hypercomb bridge, designated for this model.`,
    'Read .claude/skills/bridge-listen/SKILL.md and follow its section 3 exactly to answer and retire it.',
    'Work from the repo root. Do not start a Monitor and do not park — answer that one ask, then stop.',
    'Ground the answer by reading the target tile over the bridge first.',
    'Answer only what was asked: never propose or create tiles unless the ask itself asks for that.',
    'If the ask raises a decision rather than a question, mint a dashboard question instead of deciding.',
  ].join(' ')

  const { bin, file, spawnArgs, options } = roster.invocation(plan.agent, prompt, plan.model)
  if (!bin) return Promise.resolve(false)

  return new Promise(resolve => {
    let child
    try {
      child = spawn(file, spawnArgs, {
        cwd: REPO,
        shell: false,
        ...options,
        // stdin CLOSED: this child has no console of its own, and the CLIs
        // otherwise wait seconds for input that will never arrive.
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch { return resolve(false) }
    // The child's output belongs to the watcher's operator, not to the wake
    // contract — stdout here is a protocol, so this goes to stderr.
    let out = ''
    child.stdout.on('data', d => { out += String(d) })
    child.stderr.on('data', d => { out += String(d) })
    child.on('error', () => resolve(false))
    child.on('close', code => {
      const tail = out.trim().split('\n').slice(-2).join(' / ').slice(-400)
      process.stderr.write(`[handoff] ${plan.agent.id} (${plan.model}) exited ${code} for `
        + `${sig.slice(0, 12)}${tail ? ' - ' + tail : ''}\n`)
      resolve(code === 0)
    })
  })
}

let counter = 0
const nextId = () => `askwatch-${Date.now()}-${++counter}`

function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE, WS_OPTS)
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
  const items = r.data?.items ?? []

  // CONTEXT records are follow-ups the participant added from the agent panel
  // (clicking the ask's bee) after the ask was already minted. They ride the
  // same channel and point at their parent ask's sig. Fold them in: an ask
  // seen for the first time carries whatever context already exists, and
  // context that lands LATER prints its own wake-up line, because the session
  // may already be answering the question it changes.
  const contextByAsk = new Map()
  for (const it of items) {
    if (it.payload?.mode !== 'context') continue
    const of = String(it.payload?.askSig ?? '')
    if (!of) continue
    contextByAsk.set(of, [...(contextByAsk.get(of) ?? []), String(it.payload?.prompt ?? '')])
  }

  // STOP markers — the participant pressed Stop on the bee. The ask record is
  // already gone, so a session that never announced it simply never sees it;
  // one that IS working on it gets a wake-up line and should drop the work.
  // A marker is announced once (an answered ask leaves no marker, so this
  // never fires for work that finished normally).
  for (const it of items) {
    if (it.payload?.mode !== 'stop') continue
    const of = String(it.payload?.askSig ?? '')
    if (!of || !seen.has(of)) continue
    const key = `stop:${of}`
    if (seen.has(key)) continue
    seen.add(key)
    console.log(JSON.stringify({ stopped: of }))
  }

  for (const it of items) {
    const sig = String(it.sig || '')
    if (!sig) continue
    if (it.payload?.mode === 'stop') continue
    if (it.payload?.mode === 'context') {
      if (seen.has(sig)) continue
      seen.add(sig)
      const of = String(it.payload?.askSig ?? '')
      // Context for an ask this watcher never announced (a previous session's)
      // still deserves the line — the sig identifies what it belongs to.
      console.log(JSON.stringify({ context: of, text: it.payload?.prompt ?? '' }))
      continue
    }
    if (seen.has(sig)) continue
    seen.add(sig)

    const line = JSON.stringify({
      ask: sig,
      context: contextByAsk.get(sig) ?? [],
      // mode 'chat' = a refinement-conversation turn: reply via the
      // `chat-reply` bridge op (cell=convoId, text=reply) then retire —
      // NEVER note-add. Absent mode = classic note-bound ask.
      mode: it.payload?.mode ?? '',
      convoId: it.payload?.convoId ?? '',
      // 'hive' = asked from the root with no tile chosen: a hive-wide ask with
      // no single tile to own the answer. The responder reports on the
      // DASHBOARD instead of forcing a note somewhere arbitrary (see the
      // bridge-listen skill). Without this field the responder can't tell.
      scope: it.payload?.scope ?? '',
      // 'break-apart' = the /break-apart behaviour: this ask asks for STRUCTURE, not
      // a note. The responder creates the parts as tiles (`existing` lists
      // what is already there so nothing is duplicated) and retires without
      // writing a note. Absent = a normal question.
      task: it.payload?.task ?? '',
      existing: it.payload?.existing ?? [],
      prompt: it.payload?.prompt ?? '',
      transcript: it.payload?.transcript ?? [],
      model: it.payload?.model ?? '',
      targets: it.payload?.targets ?? [],
      segments: it.payload?.segments ?? [],
      appliesTo: it.appliesTo ?? [],
    })

    // DESIGNATED ELSEWHERE — start a silent session in that model rather than
    // waking this one to answer in a voice the ask did not ask for. Fire and
    // forget: the tick must not stall behind a model, and a handoff that
    // fails prints the line so the ask is never dropped.
    const hint = String(it.payload?.model ?? '')
    if (!isOwnModel(hint)) {
      const plan = planFor(hint)
      if (plan) {
        void handOff(sig, plan).then(taken => { if (!taken) console.log(line) })
        continue
      }
    }
    console.log(line)
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
