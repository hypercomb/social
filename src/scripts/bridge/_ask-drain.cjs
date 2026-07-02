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
const BRIDGE = 'ws://localhost:2401'

let counter = 0
const nextId = () => `askdrain-${Date.now()}-${++counter}`

function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
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

async function list() {
  const r = await withRenderer({ op: 'optimization-list', kind: 'ask' })
  if (!r.ok) { console.error('optimization-list failed:', r.error); process.exit(1) }
  const items = (r.data?.items ?? []).map(it => ({
    sig: it.sig,
    prompt: it.payload?.prompt ?? '',
    model: it.payload?.model ?? '',
    targets: it.payload?.targets ?? [],
    segments: it.payload?.segments ?? [],
    appliesTo: it.appliesTo ?? [],
    askedAt: it.payload?.askedAt ?? 0,
  }))
  console.log(JSON.stringify(items, null, 2))
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

  const noteRes = await withRenderer({ op: 'note-add', segments: parent, cell, text })
  if (!noteRes.ok) { console.error('note-add failed:', noteRes.error); process.exit(1) }

  const rm = await withRenderer({ op: 'optimization-remove', sig: askSig })
  if (!rm.ok) { console.error('optimization-remove failed (note was written):', rm.error); process.exit(1) }

  console.log(`[ask-drain] answered /${segs.join('/')} and retired ask ${askSig.slice(0, 12)}…`)
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'list') return list()
  if (cmd === 'answer') return answer(rest[0], rest[1], rest[2])
  console.error('Usage:\n  _ask-drain.cjs list\n  _ask-drain.cjs answer <ask-sig> <cell-path> "<answer>"')
  process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
