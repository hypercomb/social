// Send one hand-written bridge request.
//
// This is the path every act that is not a plain single-target answer goes
// through — multi-target answers, break-apart, expand, organize — and it is
// exactly where a run field would be forgotten, because the request is typed
// out per call rather than built by a client. So it is NOT typed here:
// export HYPERCOMB_RUN_ASK once per ask and every request this script sends
// is recorded as a step of that run. An explicit run in the JSON wins; no
// env var and no run means nothing is recorded, exactly as before.
const WebSocket = require('ws')
const { runFromEnv } = require('./loop-run.cjs')
const req = JSON.parse(process.argv[2])
req.id = 'probe-' + Date.now()
if (!req.run) {
  const run = runFromEnv()
  if (run) req.run = run
}
const ws = new WebSocket('ws://localhost:2401')
const t = setTimeout(() => { console.error('timeout'); process.exit(1) }, 25000)
ws.on('open', () => ws.send(JSON.stringify(req)))
ws.on('message', (raw) => { clearTimeout(t); console.log(String(raw)); ws.close(); process.exit(0) })
ws.on('error', (e) => { console.error(String(e)); process.exit(1) })
