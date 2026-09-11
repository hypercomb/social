// watch-asks.cjs — park-and-wake watcher for hive asks.
//
// The hive slash commands `/opus`, `/sonnet`, `/haiku <question>` mint a
// `kind:'ask'` optimization (llm.queen.ts) targeting the current selection
// (else the current page). This watcher checks the pending
// pool through the RUNNING broker every few seconds and prints ONE JSON LINE
// per ask it hasn't seen before — nothing else. It is built to sit under a
// persistent Claude Code Monitor: each printed line wakes the session, the
// session answers over the bridge (`_ask-drain.cjs answer …` for a note-bound
// ask, `_chat-reply.cjs` for a chat turn), and the watcher stays parked.
// Silence means "parked and healthy". EVERY ask wakes the session, whatever
// model it was designated for — `model` on the line says what was asked for,
// and the session answers it; there is no handoff to another CLI here.
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
//     "targets": [...], "segments": [...], "appliesTo": [...],
//     "instructionSig": "<sig>",        ← expand with `get-resource`: how to
//                                        read this hive, plus the live census
//                                        of behaviours a machine may say here
//     "references": [{kind,sig,label}], ← what the participant attached by hand
//     "contextSigs": [...],             ← content sigs attached to the tile
//     "contextTruncated": false,        ← the sig list was capped; widen with
//                                        `layer-at` from `segments`
//     "creationId": "<id>",             ← structural asks: stamp every tile
//     "reply": "node scripts/bridge/_chat-reply.cjs '<convoId>' '<reply text>' --ask '<sig>'" }
//                                      ← mode:'chat' only — the exact command
//                                        that delivers the reply into THIS
//                                        conversation with the run attached;
//                                        every argument single-quoted for a
//                                        POSIX shell, so a tile path with a
//                                        space stays ONE argument
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

const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
// Only needed when driving a REMOTE broker (loopback senders are trusted).
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()
const WS_OPTS = TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined
const POLL_MS = Math.max(2_000, Number(process.env.ASK_POLL_MS || 6_000))
const ONCE = process.argv.includes('--once')

let counter = 0
const nextId = () => `askwatch-${Date.now()}-${++counter}`

/**
 * One argument, quoted for a POSIX shell: wrapped in single quotes, with each
 * embedded `'` closed, escaped and reopened as `'\''`. Nothing inside single
 * quotes expands, so a tile path holding a space, a `$`, a backtick or a
 * quote reaches the script as ONE positional, byte for byte. Unquoted, a
 * convoId like `chat:tile:/my notes` split into extra positionals and
 * _chat-reply.cjs refused the reply.
 */
const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`

/**
 * The exact command that delivers a reply into a chat conversation with the
 * run attached — every interpolated argument quoted. The reply text is a
 * single-quoted placeholder: substitute it the same way (`'\''` for a `'`).
 */
const replyCommand = (convoId, askSig) =>
  `node scripts/bridge/_chat-reply.cjs ${shellQuote(convoId)} '<reply text>' --ask ${shellQuote(askSig)}`

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
    const mode = String(it.payload?.mode ?? '')
    const convoId = String(it.payload?.convoId ?? '')
    console.log(JSON.stringify({
      ask: sig,
      // `context` is FOLLOW-UP TEXT (the context records folded in above).
      // The payload's own `context` — content sigs — prints as `contextSigs`
      // below; the two have nothing in common but the word.
      context: contextByAsk.get(sig) ?? [],
      // mode 'chat' = a conversation turn from the chat window: reply via
      // `_chat-reply.cjs` (the `chat-reply` bridge op, cell=convoId,
      // text=reply) then retire — NEVER note-add. Absent mode = classic
      // note-bound ask.
      mode,
      convoId,
      // THE PROCEDURE TRAVELS WITH THE SCRIPT. For a chat turn, this is the
      // exact command that delivers the reply into this conversation with
      // `run:{ask}` attached, so the work is filed in the conversation's own
      // ledger and the route can draw it (documentation/chat-route.md §2.5,
      // §3.1). Add `--question "<prompt>" --option "<a>" --option "<b>"` to
      // ask a direction; retire the ask afterwards with `_ask-drain.cjs
      // retire <sig>`. A responder with no skill file has only this line.
      ...(mode === 'chat' && convoId
        ? { reply: replyCommand(convoId, sig) }
        : {}),
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
      // ONE ACT, ONE ID. Structural asks (break-apart, expand, organize)
      // carry it so every tile the responder mints is stamped as part of the
      // same batch; the organize plan echoes it verbatim. Absent on asks
      // minted before the field existed — stamp nothing rather than invent.
      creationId: it.payload?.creationId ?? '',
      // WHAT THE PARTICIPANT ATTACHED BY HAND: `{kind, sig, label}` each. A
      // media `kind` (image/png, …) is a picture pasted into the composer —
      // fetch it and LOOK before answering; `layer` / `context` kinds are
      // hive content read as usual.
      references: it.payload?.references ?? [],
      // THE TILE'S ATTACHED CONTEXT, as content sigs (the payload's own
      // `context` field — renamed here because `context` above is already
      // the follow-up text). Read these first; `contextTruncated` says the
      // list was capped, so widen with `layer-at` from `segments` when the
      // question needs more than it shows.
      contextSigs: it.payload?.context ?? [],
      contextTruncated: it.payload?.contextTruncated === true,
      // WHAT THIS HIVE CAN DO — a signature naming a plain-text instruction:
      // how to read the hive (get-resource / layer-at / behaviors-list) and
      // the LIVE census of behaviours a machine may say here, filtered by the
      // participant's grant. Expand it with `get-resource` BEFORE answering.
      // Claude Code has a skill file to fall back on; every other CLI has only
      // this, so a responder that skips it is guessing about the hive it is
      // standing in. Absent on asks minted before this field existed.
      instructionSig: it.payload?.instructionSig ?? '',
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

module.exports = { shellQuote, replyCommand }

if (require.main === module) main().catch(err => { console.error(String(err)); process.exit(1) })
