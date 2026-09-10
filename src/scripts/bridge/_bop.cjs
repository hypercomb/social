// Send one hand-written bridge request.
//
//   node scripts/bridge/_bop.cjs '<request json>' [--ask <askSig>]
//
// This is the path every act that is not a plain single-target answer goes
// through — multi-target answers, break-apart, expand, organize, reads such
// as get-resource — and it is exactly where a run field would be forgotten,
// because the request is typed out per call rather than built by a client.
// So it is NOT typed in the JSON: pass `--ask <sig>` (the ask this work
// answers) and the request carries `run: { ask }`, which the renderer
// resolves to the right ledger itself — a chat ask's conversation, anything
// else `agent:<sig>` (documentation/chat-route.md §3.1). An explicit run in
// the JSON wins; without the flag, HYPERCOMB_RUN_ASK in the environment is
// the fallback; with neither, nothing is recorded, exactly as before.
//
// BRIDGE_URL env overrides the broker (default ws://localhost:2401);
// HYPERCOMB_BRIDGE_TOKEN is the bearer for a remote broker — the same two
// knobs every other script in this directory honours.
const WebSocket = require('ws')
const { runFromEnv } = require('./loop-run.cjs')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
// Only needed when driving a REMOTE broker (loopback senders are trusted).
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()
const WS_OPTS = TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined

const SIG_RE = /^[0-9a-f]{64}$/
const USAGE = 'Usage: _bop.cjs \'<request json>\' [--ask <askSig>]'

// Flags may sit on either side of the JSON; the one positional is the request.
const argv = process.argv.slice(2)
let json = ''
let ask = ''
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '--ask') {
    ask = String(argv[++i] ?? '').trim()
    if (!SIG_RE.test(ask)) { console.error('--ask must be the 64-hex signature of the ask'); console.error(USAGE); process.exit(1) }
  } else if (arg.startsWith('--')) {
    console.error(`unknown flag ${arg}`); console.error(USAGE); process.exit(1)
  } else if (json) {
    console.error('one request per call — quote the JSON as one argument'); console.error(USAGE); process.exit(1)
  } else {
    json = arg
  }
}
if (!json) { console.error(USAGE); process.exit(1) }

let req
try { req = JSON.parse(json) } catch (err) { console.error(`request is not JSON: ${err.message}`); process.exit(1) }
if (!req || typeof req !== 'object' || Array.isArray(req)) { console.error('request must be a JSON object'); process.exit(1) }
req.id = 'probe-' + Date.now()
if (!req.run) {
  const run = ask ? { ask } : runFromEnv()
  if (run) req.run = run
}

const ws = new WebSocket(BRIDGE, WS_OPTS)
const t = setTimeout(() => { console.error('timeout'); process.exit(1) }, 25000)
ws.on('open', () => ws.send(JSON.stringify(req)))
ws.on('message', (raw) => { clearTimeout(t); console.log(String(raw)); ws.close(); process.exit(0) })
ws.on('error', (e) => { console.error(String(e)); process.exit(1) })
