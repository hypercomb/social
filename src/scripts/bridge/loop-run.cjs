// scripts/bridge/loop-run.cjs
//
// A RESPONDER'S RUN — two fields, and the loop records itself.
//
// The hive records what an agent DID (essentials/assistant/chat-steps.ts),
// but only for requests that say which loop they belong to. That is the
// whole contract: put `run: { convoId, id }` on the requests you already
// send, and every step — including the ones that failed, and the ones you
// forgot you took — lands in the conversation's ledger. A responder that
// declares no run behaves exactly as it always did.
//
// What it buys is the thing a killed process cannot otherwise have: on
// restart, `resume()` reads the ledger back and says where you got to.
//
// ── Two rules this file exists to enforce ───────────────────────────────
//
// FAILING TO READ IS NOT AN EMPTY RUN. The first version of this helper
// returned `{ landed: [] }` when the read failed, so a transient store fault
// was indistinguishable from a run that had never done anything — and the
// caller, seeing nothing landed, did the work again. That is the exact
// outcome the ledger exists to prevent, produced by the ledger's own client.
// So `resume()` THROWS when it cannot find out. A resume you cannot trust
// must stop the responder, never quietly hand it a clean slate.
//
// A MANIFEST IS NOT AN ANSWER. Steps come back as pointers: the request is
// behind `contentSig`. A caller asking "did I already answer target 3 of 5"
// cannot tell from the manifest alone, and a helper that let it try would
// answer target 1, report success, and drop the other four. So `resume()`
// materializes each step's request before returning, and predicates receive
// the request, not just the manifest.
//
// Deliberately self-contained, like every other script in this directory.

const WebSocket = require('ws')
const crypto = require('crypto')

const DEFAULT_BRIDGE = 'ws://localhost:2401'

let counter = 0
const nextId = () => `loop-${Date.now()}-${++counter}`

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
 * The run id for an ask — DERIVED, never invented.
 *
 * A run id has to be the same string after the process that chose it has
 * died, or resuming reads an empty ledger and reports, honestly, that this
 * run has never done anything. Every other stable handle in this loop is
 * derived (the ask sig, the convoId, the bucket name); leaving this one to be
 * retyped from memory is what would make the whole mechanism a no-op that
 * still appears to work. So: derive it from the ask the run is answering.
 */
const runIdForAsk = askSig =>
  'ask:' + crypto.createHash('sha256').update(String(askSig || '')).digest('hex').slice(0, 32)

/**
 * THE WHOLE RUN REFERENCE, from the ask sig and nothing else.
 *
 * Mirrors runIdForAsk / runConvoForAsk in assistant/chat-steps.ts, which is
 * the source of truth — a .cjs script cannot import the TypeScript, so the
 * rule is spelled twice and loop-run.spec.ts compares the two rather than
 * trusting them.
 *
 * ONE input, deliberately. Deriving the conversation from the target tile
 * instead reads better and is wrong: the responder knows that path from the
 * command line (whichever target it is answering) and a reader can only
 * infer it from the ask record — two inputs, free to disagree, and for a
 * multi-target ask they do. The reader then shows an empty ledger, silently.
 */
const runConvoForAsk = askSig => 'agent:' + String(askSig || '')

const runRefForAsk = askSig => ({
  convoId: runConvoForAsk(askSig),
  id: runIdForAsk(askSig),
})

/**
 * The run a responder was woken for, from the environment — or null.
 *
 * A parked session exports this ONCE per ask; every script it then runs
 * attaches the run without the model having to remember a field on each
 * hand-typed request. That is the difference between a ledger that fills
 * itself and one that fills only when somebody remembers it.
 */
const runFromEnv = (env = process.env) => {
  const ask = String(env.HYPERCOMB_RUN_ASK || '').trim()
  return ask ? runRefForAsk(ask) : null
}

/**
 * Open a run against one conversation.
 *
 * Pass `ask` (the ask sig) and the run id is derived for you — the safe path,
 * and the one to use whenever the run is answering an ask. Pass `runId`
 * explicitly only when you have your own stable handle and can guarantee the
 * next process spells it identically.
 */
function openRun({ convoId, runId, ask, bridge = DEFAULT_BRIDGE, timeoutMs = 15_000 }) {
  const convo = String(convoId || '').trim()
  const id = String(runId || (ask ? runIdForAsk(ask) : '')).trim()
  if (!convo) throw new Error('openRun needs a convoId')
  if (!id) throw new Error('openRun needs `ask` (preferred — the id is derived) or an explicit stable `runId`')

  const run = { convoId: convo, id }

  /** Send one op AS A STEP of this run. The hive records it; you get the
   *  op's own answer back, unchanged. */
  const act = async (op, fields = {}) =>
    send(bridge, { op, ...fields, run }, timeoutMs)

  /** Send one op WITHOUT recording it — for the reads that are how you
   *  rejoin the loop rather than moves within it. */
  const peek = async (op, fields = {}) => send(bridge, { op, ...fields }, timeoutMs)

  /** The request a step recorded, or undefined when it stored none. Throws
   *  only on transport failure — a resource that has gone is `undefined`,
   *  which a caller must read as "cannot tell", never as "nothing". */
  const requestOf = async step => {
    if (!step || !step.contentSig) return undefined
    const res = await peek('get-resource', { sig: step.contentSig })
    if (!res || !res.ok || !res.data || res.data.encoding !== 'text') return undefined
    try { return JSON.parse(res.data.text) } catch { return undefined }
  }

  /**
   * What this run has already done, read back off disk.
   *
   * THROWS when the ledger cannot be read — see the header. Returns every
   * recorded attempt with its request materialized, plus:
   *   settled — one entry per `seq`, the outcome that stands
   *   landed  — the attempts that ended `ok`; what a resume may skip
   *   nextSeq — the seq a fresh writer should claim
   */
  const resume = async () => {
    const res = await peek('thread-read', { cell: convo, steps: true, runId: id })
    if (!res || !res.ok) {
      throw new Error(`cannot read the run ledger: ${(res && res.error) || 'thread-read failed'}`)
    }
    const turns = (res.data && res.data.turns) || []
    const raw = (res.data && res.data.steps) || []

    const steps = []
    for (const step of raw) steps.push({ ...step, request: await requestOf(step) })

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

    // `landed` asks "did this seq EVER end ok", not "does the settled record
    // say ok". The clock is not monotonic, and for a skip decision the
    // conservative reading of a disagreement is that the work happened.
    const okSeqs = new Set(steps.filter(s => s.outcome === 'ok').map(s => s.seq))
    const landed = settled.filter(s => okSeqs.has(s.seq))

    const nextSeq = steps.reduce((max, s) => (s.seq > max ? s.seq : max), -1) + 1
    return { turns, steps, settled, landed, nextSeq }
  }

  /**
   * True when this run already landed a step matching `verb`.
   *
   * `predicate` receives `(request, step)` — the materialized request first,
   * because "did I already write the note for THIS target" is the question
   * that actually gets asked, and it is unanswerable from the manifest.
   *
   * A BLUNT GUARD, on purpose. It says a matching step landed once; it cannot
   * say the effect still stands, and it does not know whether repeating the
   * op is safe. That judgement belongs to the caller, which is the only party
   * that knows whether its op is idempotent. Propagates the throw from
   * `resume()` rather than reporting "no" when it could not find out.
   */
  const alreadyDid = async (verb, predicate) => {
    const { landed } = await resume()
    return landed.some(s => s.verb === verb && (!predicate || predicate(s.request, s)))
  }

  return { convoId: convo, runId: id, act, peek, resume, alreadyDid, requestOf }
}

module.exports = { openRun, runIdForAsk, runRefForAsk, runConvoForAsk, runFromEnv }
