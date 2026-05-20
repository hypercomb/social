// Author a Q&A entry through the proper external-optimization channel.
//
//   node scripts/bridge/_ask.cjs <cell-path> "<question>" [--id <qId>]
//
// Writes a `{ kind: 'qa', appliesTo, payload: { qId, question, askedAt },
// mark: 'persistent' }` JSON object into the renderer's OPFS
// `__optimization__/` directory via the bridge `optimization-add` op.
//
// This path does NOT touch the layer. The cell whose path is passed is
// only referenced as `appliesTo` — no layer slot is written, no
// resources are added to any cell's bag. See
// `feedback_layer_purity_optimizations_external.md` and
// `project_optimization_substrate.md` in user memory for the rule.

const WebSocket = require('ws')
const BRIDGE = 'ws://localhost:2401'

let counter = 0
const nextId = () => `ask-${Date.now()}-${++counter}`

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

function parseSegments(arg) {
  return String(arg ?? '').split(/[\\/]/).map(s => s.trim()).filter(Boolean)
}

function parseArgs(argv) {
  const positional = []
  let qId = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--id') { qId = argv[++i]; continue }
    positional.push(argv[i])
  }
  return { cellPath: positional[0], question: positional[1], qId }
}

async function main() {
  const { cellPath, question, qId: providedQid } = parseArgs(process.argv.slice(2))
  if (!cellPath || !question) {
    console.error('Usage: node scripts/bridge/_ask.cjs <cell-path> "<question>" [--id <qId>]')
    process.exit(1)
  }
  const segments = parseSegments(cellPath)
  if (segments.length === 0) {
    console.error('cell-path must resolve to at least one segment')
    process.exit(1)
  }

  const qId = providedQid || `mp${Date.now().toString(36)}`
  const optimization = {
    kind: 'qa',
    appliesTo: segments,
    payload: {
      qId,
      question: question.trim(),
      askedAt: Date.now(),
    },
    mark: 'persistent',
  }
  const text = JSON.stringify(optimization)

  const add = await withRenderer({ op: 'optimization-add', text })
  if (!add.ok) { console.error('optimization-add failed:', add.error); process.exit(1) }
  console.log(`[ask] optimization minted: sig=${add.data.sig.slice(0, 12)}… (${add.data.bytes} bytes)`)
  console.log(`[ask] kind=qa  appliesTo=/${segments.join('/')}  qId=${qId}  mark=persistent`)
}

main().catch(err => { console.error(err); process.exit(1) })
