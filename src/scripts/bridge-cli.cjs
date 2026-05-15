// Tiny CLI for the Hypercomb bridge.
// Usage:
//   node scripts/bridge-cli.cjs list
//   node scripts/bridge-cli.cjs list <segments-with-slashes>
//   node scripts/bridge-cli.cjs inspect <cell> [segments]
//   node scripts/bridge-cli.cjs history [segments]
//   node scripts/bridge-cli.cjs do "<command-line text>"
//   node scripts/bridge-cli.cjs note <cell> "<text>" [segments]
//   node scripts/bridge-cli.cjs add <cell> [<cell> ...] [--in segments]
const WebSocket = require('ws')

const BRIDGE = 'ws://localhost:2401'
const TIMEOUT_MS = 10_000
let counter = 0
const nextId = () => `cli-${Date.now()}-${++counter}`

function send(req) {
  return new Promise((resolve, reject) => {
    const id = nextId()
    const msg = { ...req, id }
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT_MS)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('bad response')) }
      ws.close()
    })
    ws.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

function parseSegments(arg) {
  if (!arg) return []
  return arg.split(/[\\/]/).filter(Boolean)
}

async function main() {
  const [, , cmd, ...rest] = process.argv
  if (!cmd) { console.error('no command'); process.exit(1) }

  if (cmd === 'list') {
    // segments are *the parent path* — bridge `list` always lists at the renderer's
    // current location, segments are not supported there. So we just call list as-is.
    const r = await send({ op: 'list' })
    if (!r.ok) { console.error(r.error); process.exit(1) }
    for (const c of r.data ?? []) console.log(`  ${c}`)
    console.log(`(${(r.data ?? []).length} tiles at current location)`)
    return
  }

  if (cmd === 'inspect') {
    const [cell] = rest
    if (!cell) { console.error('inspect <cell>'); process.exit(1) }
    const r = await send({ op: 'inspect', cell })
    console.log(JSON.stringify(r, null, 2))
    return
  }

  if (cmd === 'history') {
    const r = await send({ op: 'history' })
    if (!r.ok) { console.error(r.error); process.exit(1) }
    for (const op of r.data ?? []) {
      console.log(`  ${new Date(op.at).toISOString()}  ${String(op.op).padEnd(8)} ${op.cell}`)
    }
    console.log(`(${(r.data ?? []).length} ops)`)
    return
  }

  if (cmd === 'do') {
    const text = rest.join(' ')
    if (!text) { console.error('do "<text>"'); process.exit(1) }
    const r = await send({ op: 'submit', text })
    console.log(JSON.stringify(r, null, 2))
    return
  }

  if (cmd === 'note') {
    // node scripts/bridge-cli.cjs note <cell> "text" [segments]
    const [cell, text, segArg] = rest
    if (!cell || !text) { console.error('note <cell> "text" [segments]'); process.exit(1) }
    const segments = parseSegments(segArg)
    const r = await send({ op: 'note-add', segments, cell, text })
    console.log(JSON.stringify(r, null, 2))
    return
  }

  if (cmd === 'add') {
    let segments = []
    const cells = []
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--in') { segments = parseSegments(rest[i+1]); i++; continue }
      cells.push(rest[i])
    }
    if (!cells.length) { console.error('add <cell> [...] [--in segments]'); process.exit(1) }
    const r = await send({ op: 'add', segments, cells })
    console.log(JSON.stringify(r, null, 2))
    return
  }

  console.error(`unknown command: ${cmd}`)
  process.exit(1)
}

main().catch(err => { console.error(err.message); process.exit(2) })
