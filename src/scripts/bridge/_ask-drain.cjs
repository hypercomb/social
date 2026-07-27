// Drain user→Claude "ask" requests and answer them back INTO the hive.
//
// The hive command line `[tiles]/opus|sonnet|haiku <question>` writes a
// `{ kind:'ask', appliesTo, payload:{ prompt, model, targets, segments } }`
// optimization into the renderer's OPFS `__optimization__/`. This script is the
// Claude Code side of the loop: it LISTS pending asks over the bridge, and (per
// ask) writes the answer as a NOTE on the target tile and retires the ask.
//
//   node scripts/bridge/_ask-drain.cjs list
//       → JSON array: [{ sig, prompt, model, targets, segments, appliesTo }]
//
//   node scripts/bridge/_ask-drain.cjs answer <ask-sig> <cell-path> "<answer text>"
//       → note-add the answer onto <cell-path>, then optimization-remove <ask-sig>
//
// Requires the broker (node scripts/bridge/run-bridge.cjs) and a renderer
// (a hive tab on localhost with ?claudeBridge=1). Reads are headless — the
// note appears in the tile's notes live; never trust visual confirmation.

const WebSocket = require('ws')
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
// Only needed when driving a REMOTE broker (loopback senders are trusted).
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()
const WS_OPTS = TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined

let counter = 0
const nextId = () => `askdrain-${Date.now()}-${++counter}`

function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE, WS_OPTS)
    const t = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 15_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: nextId() })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      ws.close()
    })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

async function withRenderer(req, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await send(req)
      if (r.ok || r.error !== 'no renderer connected') return r
    } catch (e) { if (i === attempts - 1) throw e }
    await new Promise(r => setTimeout(r, 1500))
  }
  return { ok: false, error: 'renderer never connected' }
}

const parseSegments = (arg) => String(arg ?? '').split(/[\\/]/).map(s => s.trim()).filter(Boolean)

// Pull every ask record once and split it into the three shapes that ride the
// same channel: real asks, chat turns (answered via _chat-reply.cjs), and
// CONTEXT records — follow-ups the participant added from the agent panel
// after asking, each pointing at its parent ask's sig. Context is folded into
// the ask it belongs to, so a responder answers the question as it stands NOW,
// not as it was first typed.
async function fetchAsks() {
  const r = await withRenderer({ op: 'optimization-list', kind: 'ask' })
  if (!r.ok) { console.error('optimization-list failed:', r.error); process.exit(1) }
  const all = r.data?.items ?? []
  const contextByAsk = new Map()
  for (const it of all) {
    if (it.payload?.mode !== 'context') continue
    const of = String(it.payload?.askSig ?? '')
    if (!of) continue
    const bucket = contextByAsk.get(of) ?? []
    bucket.push({ sig: it.sig, text: String(it.payload?.prompt ?? ''), addedAt: it.payload?.askedAt ?? 0 })
    contextByAsk.set(of, bucket)
  }
  const asks = all
    .filter(it => it.payload?.mode !== 'context')
    .map(it => ({
      sig: it.sig,
      mode: it.payload?.mode ?? '',
      prompt: it.payload?.prompt ?? '',
      model: it.payload?.model ?? '',
      targets: it.payload?.targets ?? [],
      segments: it.payload?.segments ?? [],
      appliesTo: it.appliesTo ?? [],
      askedAt: it.payload?.askedAt ?? 0,
      context: (contextByAsk.get(it.sig) ?? []).sort((a, b) => a.addedAt - b.addedAt),
    }))
  return { asks, contextByAsk }
}

async function list() {
  const { asks } = await fetchAsks()
  console.log(JSON.stringify(asks, null, 2))
}

// Tell the hive what this ask's bee is DOING. Pure UI signal — writes nothing,
// so report as often as the work has something to say.
//   _ask-drain.cjs progress <ask-sig> "reading 12 notes" [working|done|failed]
async function progress(askSig, text, status) {
  if (!askSig || !text) {
    console.error('Usage: _ask-drain.cjs progress <ask-sig> "<activity>" [status]')
    process.exit(1)
  }
  const r = await withRenderer({ op: 'agent-progress', cell: askSig, text, kind: status || 'working' }, 2)
  if (!r.ok) { console.error('agent-progress failed:', r.error); process.exit(1) }
  console.log(`[ask-drain] ${askSig.slice(0, 12)}… ${text}`)
}

async function answer(askSig, cellPath, text) {
  if (!askSig || !cellPath || !text) {
    console.error('Usage: _ask-drain.cjs answer <ask-sig> <cell-path> "<answer text>"')
    process.exit(1)
  }
  const segs = parseSegments(cellPath)
  if (segs.length === 0) { console.error('cell-path must resolve to at least one segment'); process.exit(1) }
  const cell = segs[segs.length - 1]
  const parent = segs.slice(0, -1)

  // CARRY THE QUESTION INTO THE NOTE. An answer alone reads as a floating
  // statement months later — and the routine that reads notes as instructions
  // has no idea what prompted it. Look the ask up by sig and prefix its
  // question, so every answer note is self-documenting. Best-effort: if the
  // record can't be read, the answer still lands (never lose an answer over
  // provenance).
  let question = ''
  let contextRecords = []
  try {
    const { asks, contextByAsk } = await fetchAsks()
    const found = asks.find(it => it.sig === askSig)
    question = String(found?.prompt ?? '').trim()
    contextRecords = contextByAsk.get(askSig) ?? []
  } catch { /* unreadable — fall through to a bare answer */ }
  const added = contextRecords.map(c => c.text).filter(Boolean)
  const asked = question
    ? added.length
      ? `Asked: ${question}\n\nAlso: ${added.join('\n\n')}`
      : `Asked: ${question}`
    : ''
  const body = asked ? `${asked}\n\n${text}` : text

  const noteRes = await withRenderer({ op: 'note-add', segments: parent, cell, text: body })
  if (!noteRes.ok) { console.error('note-add failed:', noteRes.error); process.exit(1) }

  // Retire the context records BEFORE the ask: `optimization-remove` of the
  // ask is what emits `ask:answered` (the bee lands, the pill drops), so it
  // goes last and any leftover follow-up is already gone.
  for (const record of contextRecords) {
    const gone = await withRenderer({ op: 'optimization-remove', sig: record.sig }, 2)
    if (!gone.ok) console.error('context record not retired:', record.sig, gone.error)
  }

  const rm = await withRenderer({ op: 'optimization-remove', sig: askSig })
  if (!rm.ok) { console.error('optimization-remove failed (note was written):', rm.error); process.exit(1) }

  console.log(`[ask-drain] answered /${segs.join('/')} and retired ask ${askSig.slice(0, 12)}…`)
}

// Retire an ask WITHOUT writing a note — the chat-turn path (the reply went
// through _chat-reply.cjs instead) or an undeliverable ask.
async function retire(askSig) {
  if (!askSig) { console.error('Usage: _ask-drain.cjs retire <ask-sig>'); process.exit(1) }
  const rm = await withRenderer({ op: 'optimization-remove', sig: askSig })
  if (!rm.ok) { console.error('optimization-remove failed:', rm.error); process.exit(1) }
  console.log(`[ask-drain] retired ${askSig.slice(0, 12)}…`)
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'list') return list()
  if (cmd === 'answer') return answer(rest[0], rest[1], rest[2])
  if (cmd === 'retire') return retire(rest[0])
  if (cmd === 'progress') return progress(rest[0], rest[1], rest[2])
  console.error('Usage:\n  _ask-drain.cjs list\n  _ask-drain.cjs answer <ask-sig> <cell-path> "<answer>"\n  _ask-drain.cjs retire <ask-sig>\n  _ask-drain.cjs progress <ask-sig> "<activity>" [working|done|failed]')
  process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
