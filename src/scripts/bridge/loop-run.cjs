// scripts/bridge/loop-run.cjs
//
// A RESPONDER'S RUN — one field, and the loop records itself.
//
// The hive records what an agent DID (essentials/assistant/chat-steps.ts),
// but only for requests that say which loop they belong to. That is the
// whole contract: put `run: { ask }` on the requests you already send —
// the sig of the ask you are answering — and every step, including the ones
// that failed and the ones you forgot you took, lands in the conversation's
// ledger. The RENDERER resolves which conversation from the ask record it
// already reads (a chat ask's run lives in the chat's own bucket, any other
// in `agent:<askSig>`), so nothing here needs a second input. The older
// explicit `run: { convoId, id }` is still honoured for runs that are not
// answering an ask. A responder that declares no run behaves exactly as it
// always did.
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
 * A FALLBACK, for `_bop.cjs` and any hand-typed request: the scripts that
 * answer an ask take `--ask <sig>` on the command line and never need this.
 * A Claude Code session runs each command in a fresh shell, so an exported
 * variable does not survive to the next call anyway — and in a shell where
 * it does, a stale one files a run under the wrong ask. When it is set, it
 * yields the `{ ask }` form: the renderer resolves the bucket from the ask
 * record (a chat ask's run lands in the chat's own bucket), never this
 * script from a second variable.
 */
const runFromEnv = (env = process.env) => {
  const ask = String(env.HYPERCOMB_RUN_ASK || '').trim()
  return ask ? { ask } : null
}

/**
 * The conversation an ask's run lives in, given the ask RECORD — the rule the
 * renderer applies when it resolves `run: { ask }` (`runForAsk` in
 * assistant/chat-steps.ts, the source of truth; loop-run.spec.ts compares the
 * two). A chat ask names its conversation; anything else is `agent:<askSig>`.
 */
const runConvoForAskRecord = (askSig, record) => {
  const payload = record && record.payload
  const chat = payload && payload.mode === 'chat' && typeof payload.convoId === 'string'
    ? payload.convoId.trim()
    : ''
  return chat || runConvoForAsk(askSig)
}

/**
 * Open a run against one conversation.
 *
 * Pass `ask` (the ask sig) and every op is sent as `run: { ask }`: the
 * RENDERER resolves where the run lives from the ask record it already
 * reads — a chat-mode ask into the chat's own bucket, anything else into
 * `agent:<askSig>` — so one input addresses the run on both sides and no
 * environment is involved.
 *
 * `resume()` must read THAT bucket, and a local guess cannot know it: a chat
 * ask's run is not under `agent:<askSig>`, so guessing the note-mode address
 * returns an empty ledger for a run that did the work — the silent false
 * negative this file refuses. So the bucket is resolved the way the renderer
 * resolves it, from the ask record (read over the bridge on first use, then
 * held — a record's content never changes under its sig). Pass `convoId` too
 * when you already know it (the wake line prints it); then no lookup is made.
 * When the record is gone — retired — and no `convoId` was given, `resume()`
 * THROWS: an empty ledger is never an answer to "I could not find out".
 *
 * Pass `convoId` + `runId` explicitly, with no `ask`, only when you have your
 * own stable handle and can guarantee the next process spells it identically
 * — that form is sent as it always was.
 */
function openRun({ convoId, runId, ask, bridge = DEFAULT_BRIDGE, timeoutMs = 15_000 }) {
  const askSig = String(ask || '').trim()
  const given = String(convoId || '').trim()
  const id = String(runId || (askSig ? runIdForAsk(askSig) : '')).trim()
  if (!given && !askSig) throw new Error('openRun needs a convoId')
  if (!id) throw new Error('openRun needs `ask` (preferred — the id is derived) or an explicit stable `runId`')

  // THE ASK FORM WINS. With an ask in hand the renderer's resolution is the
  // one that cannot misfile (it reads the record); an explicit address is
  // the legacy form for runs that are not answering an ask.
  const run = askSig ? { ask: askSig } : { convoId: given, id }

  /** Send one op AS A STEP of this run. The hive records it; you get the
   *  op's own answer back, unchanged. */
  const act = async (op, fields = {}) =>
    send(bridge, { op, ...fields, run }, timeoutMs)

  /** Send one op WITHOUT recording it — for the reads that are how you
   *  rejoin the loop rather than moves within it. */
  const peek = async (op, fields = {}) => send(bridge, { op, ...fields }, timeoutMs)

  let resolved = given

  /**
   * The conversation this run's ledger lives in — the bucket the renderer
   * files `run: { ask }` under. Given, or read from the ask record over the
   * bridge and then held. THROWS when it cannot be known: the lookup failed,
   * or the record is gone (retired) and no `convoId` was given. Guessing
   * `agent:<askSig>` there would read an empty ledger for a chat run that
   * did the work.
   */
  const resolveConvoId = async () => {
    if (resolved) return resolved
    const res = await peek('optimization-list', { kind: 'ask' })
    if (!res || !res.ok) {
      throw new Error(`cannot find the run's conversation: ${(res && res.error) || 'optimization-list failed'}`)
    }
    const items = (res.data && res.data.items) || []
    const record = items.find(item => item && item.sig === askSig)
    if (!record) {
      throw new Error(
        `cannot find the run's conversation: the ask ${askSig} is gone (retired?) and no convoId was given`
        + ' — pass openRun({ ask, convoId }) with the convoId the wake line printed')
    }
    resolved = runConvoForAskRecord(askSig, record)
    return resolved
  }

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
    const convo = await resolveConvoId()
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

  return {
    /** The conversation the ledger lives in: the one given, or the one read
     *  from the ask record once `resume()` / `resolveConvoId()` found it.
     *  `null` until then — never a guess. */
    get convoId() { return resolved || null },
    runId: id,
    act,
    peek,
    resume,
    alreadyDid,
    requestOf,
    resolveConvoId,
  }
}

module.exports = { openRun, runIdForAsk, runRefForAsk, runConvoForAsk, runConvoForAskRecord, runFromEnv }
