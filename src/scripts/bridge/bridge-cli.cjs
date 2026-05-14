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

  if (cmd === 'notes') {
    // node scripts/bridge-cli.cjs notes <segments-with-slashes>
    // segments include the cell label as the last segment
    const [segArg] = rest
    if (!segArg) { console.error('notes <segments>'); process.exit(1) }
    const segments = parseSegments(segArg)
    const r = await send({ op: 'note-list', segments })
    console.log(JSON.stringify(r, null, 2))
    return
  }

  if (cmd === 'children') {
    // node scripts/bridge-cli.cjs children <segments-with-slashes>
    const [segArg] = rest
    const segments = parseSegments(segArg)
    const r = await send({ op: 'list-at', segments })
    if (!r.ok) { console.error(r.error); process.exit(1) }
    for (const c of r.data ?? []) console.log(`  ${c}`)
    console.log(`(${(r.data ?? []).length} tiles at ${segments.join('/') || '/'})`)
    return
  }

  if (cmd === 'inflate') {
    // node scripts/bridge-cli.cjs inflate <sig|segments>
    // - 64-hex string → inflate that sig
    // - anything else → treat as a segments path
    const [arg] = rest
    if (!arg) { console.error('inflate <sig|segments>'); process.exit(1) }
    const isSig = /^[0-9a-f]{64}$/.test(arg)
    const req = isSig ? { op: 'inflate', cell: arg } : { op: 'inflate', segments: parseSegments(arg) }
    const r = await send(req)
    if (!r.ok) { console.error(r.error); process.exit(1) }
    console.log(JSON.stringify(r.data, null, 2))
    return
  }

  if (cmd === 'put-resource' || cmd === 'put') {
    // node scripts/bridge-cli.cjs put-resource <text>            # short literal
    // node scripts/bridge-cli.cjs put-resource @<path>           # read file as text
    // node scripts/bridge-cli.cjs put-resource --base64 @<path>  # read file as bytes
    // Reads stdin if no arg.
    let mode = 'text'
    let arg = rest[0]
    if (arg === '--base64' || arg === '--bytes') { mode = 'base64'; arg = rest[1] }
    let payload
    if (!arg) {
      const { readFileSync } = require('fs')
      payload = readFileSync(0)  // stdin
      if (mode !== 'base64') payload = String(payload)
    } else if (arg.startsWith('@')) {
      const { readFileSync } = require('fs')
      payload = readFileSync(arg.slice(1))
      if (mode !== 'base64') payload = String(payload)
    } else {
      payload = arg
    }
    const req = mode === 'base64'
      ? { op: 'put-resource', base64: Buffer.from(payload).toString('base64') }
      : { op: 'put-resource', text: String(payload) }
    const r = await send(req)
    if (!r.ok) { console.error(r.error); process.exit(1) }
    console.log(r.data.sig)  // print just the sig so $(...) capture works
    return
  }

  if (cmd === 'get-resource' || cmd === 'get') {
    // node scripts/bridge-cli.cjs get-resource <sig> [--base64]
    const [sig, flag] = rest
    if (!sig) { console.error('get-resource <sig> [--base64]'); process.exit(1) }
    const req = { op: 'get-resource', sig }
    if (flag === '--base64' || flag === '--bytes') req.text = 'base64'
    const r = await send(req)
    if (!r.ok) { console.error(r.error); process.exit(1) }
    if (r.data.encoding === 'text') {
      process.stdout.write(r.data.text)
    } else {
      process.stdout.write(r.data.base64 + '\n')
    }
    return
  }

  if (cmd === 'bag-add' || cmd === 'bag-remove') {
    // node scripts/bridge-cli.cjs bag-add <segments> <sig> [--slot <name>]
    const [segArg, sig, ...flags] = rest
    if (!segArg || !sig) { console.error(`${cmd} <segments> <sig> [--slot <name>]`); process.exit(1) }
    const req = {
      op: cmd,
      segments: parseSegments(segArg),
      sig,
    }
    const slotIdx = flags.indexOf('--slot')
    if (slotIdx >= 0 && flags[slotIdx + 1]) req.slot = flags[slotIdx + 1]
    const r = await send(req)
    if (!r.ok) { console.error(r.error); process.exit(1) }
    console.log(JSON.stringify(r.data, null, 2))
    return
  }

  if (cmd === 'stamp') {
    // node scripts/bridge-cli.cjs stamp <segments> key=value [key=value ...]
    const [segArg, ...kvs] = rest
    if (!segArg || kvs.length === 0) { console.error('stamp <segments> key=value [...]'); process.exit(1) }
    const layer = {}
    for (const kv of kvs) {
      const eq = kv.indexOf('=')
      if (eq <= 0) { console.error(`bad pair: ${kv}`); process.exit(1) }
      layer[kv.slice(0, eq)] = kv.slice(eq + 1)
    }
    const r = await send({ op: 'stamp', segments: parseSegments(segArg), layer })
    if (!r.ok) { console.error(r.error); process.exit(1) }
    console.log(JSON.stringify(r.data, null, 2))
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
