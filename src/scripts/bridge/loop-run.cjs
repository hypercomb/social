// scripts/bridge/loop-run.cjs
//
// A RESPONDER'S RUN — two fields, and the loop records itself.
//
// The hive records what an agent DID (essentials/assistant/chat-steps.ts),
// but only for requests that say which loop they belong to. That is the
// whole contract: put `run: { convoId, id }` on the requests you already
// send, and every step — including the ones that failed, and the ones you
// forgot you took — lands in the conversation's ledger. Nothing else is
// asked of a responder, and a responder that declares no run behaves exactly
// as it always did.
//
// What it buys is the thing a killed process cannot otherwise have: on
// restart, `resume()` reads the ledger back and tells you where you got to,
// so the work already done is not done twice and the work not yet done is
// not lost.
//
// Deliberately self-contained, like every other script in this directory —
// one `ws` require and no shared client to keep in step.

const WebSocket = require('ws')

const DEFAULT_BRIDGE = 'ws://localhost:2401'

let counter = 0
const nextId = () => `run-${Date.now()}-${++counter}`

function send(bridge, req, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(bridge)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, timeoutMs)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: req.id || nextId() })))
    ws.on('message', raw => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw))) } catch (err) { reject(err) }
      ws.close()
    })
    ws.on('error', err => { clearTimeout(timer); reject(err) })
  })
}

/**
 * Open a run against one conversation.
 *
 * `runId` is opaque and chosen by the caller. Pass a STABLE one — the same
 * string the process used before it died — or resuming is impossible: a
 * fresh id is a fresh run, and the ledger will honestly tell you it has
 * never seen a step.
 */
function openRun({ convoId, runId, bridge = DEFAULT_BRIDGE, timeoutMs = 15_000 }) {
  const id = String(runId || '').trim()
  const convo = String(convoId || '').trim()
  if (!convo || !id) throw new Error('openRun needs both convoId and runId')

  const run = { convoId: convo, id }

  /** Send one op AS A STEP of this run. The hive records it; you get the
   *  op's own answer back, unchanged. */
  const act = async (op, fields = {}) =>
    send(bridge, { op, ...fields, run }, timeoutMs)

  /** Send one op WITHOUT recording it — for the reads that are how you
   *  rejoin the loop rather than moves within it. */
  const peek = async (op, fields = {}) => send(bridge, { op, ...fields }, timeoutMs)

  /**
   * What this run has already done, read back off disk.
   *
   * Returns the conversation's turns and this run's steps. `steps` is every
   * recorded attempt, retries included; `settled` is one entry per `seq`,
   * carrying the outcome that stands; `landed` is the subset that worked —
   * the one a resume should skip.
   */
  const resume = async () => {
    const res = await peek('thread-read', { cell: convo, steps: true, runId: id })
    if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'thread-read failed', turns: [], steps: [], settled: [], landed: [], nextSeq: 0 }
    const turns = (res.data && res.data.turns) || []
    const steps = (res.data && res.data.steps) || []

    // Settle the same way the hive does: later `at` wins, and on a tie the
    // attempt that succeeded is the one that describes the world.
    const best = new Map()
    for (const step of steps) {
      const key = String(step.seq)
      const held = best.get(key)
      if (!held
        || step.at > held.at
        || (step.at === held.at && held.outcome === 'failed' && step.outcome === 'ok')) {
        best.set(key, step)
      }
    }
    const settled = [...best.values()].sort((a, b) => a.seq - b.seq)
    const landed = settled.filter(s => s.outcome === 'ok')
    const nextSeq = steps.reduce((max, s) => (s.seq > max ? s.seq : max), -1) + 1

    return { ok: true, turns, steps, settled, landed, nextSeq }
  }

  /** True when this run already landed a step matching `verb` (and, when
   *  given, a predicate over the step). The blunt idempotency guard a
   *  resumed responder wants before repeating expensive work. */
  const alreadyDid = async (verb, predicate) => {
    const { landed } = await resume()
    return landed.some(s => s.verb === verb && (!predicate || predicate(s)))
  }

  return { convoId: convo, runId: id, act, peek, resume, alreadyDid }
}

module.exports = { openRun }
