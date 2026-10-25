// tell.cjs — a harness's way to talk to the hive: stream text straight into a
// conversation, in natural language. No command line, no slash grammar.
//
//   node scripts/bridge/tell.cjs <tile route | conversation id> "<text>" [--name <handle>] [--open] [--no-wait]
//
//   tell.cjs /work "Tidy the invoices" --name tidy --open
//       starts — or, the next time, RECONNECTS TO — the conversation about /work
//       named `tidy`: its id is chat:tile:/work::tidy, the same every time, so
//       nothing needs remembering to come back to it.
//   tell.cjs chat:tile:/work::tidy "Also the receipts"
//       carries on a conversation by its id.
//
// The conversation is the tile's own, in its list, where the participant can
// open and read it; it is NOT trusted, so what it wants to change runs under
// the participant's own Execution rules, else waits there for a hand. `--open`
// brings the participant's chat to it while it works.
//
// WHAT COMES BACK is the conversation id and how the turn ended. A turn held
// for a hand says so, with the lines — and the conversation keeps going: come
// back to it later with the same route and --name (or the id) and read it with
// manager.cjs thread <id>. `--no-wait` posts and returns at once, for a
// harness that picks the answer up periodically.
//
// BRIDGE_URL overrides the broker (default ws://localhost:2401).
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const args = process.argv.slice(2)
const flag = name => args.includes(name)
const valueOf = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined }
const positional = args.filter((arg, at) => !arg.startsWith('--') && args[at - 1] !== '--name')
const [target, ...words] = positional
const text = words.join(' ').trim()
if (!target || !text) {
  console.error('usage: tell.cjs <tile route | conversation id> "<text>" [--name <handle>] [--open] [--no-wait]')
  process.exit(2)
}

const send = request => new Promise((resolve, reject) => {
  const ws = new WebSocket(BRIDGE)
  const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 15_000)
  ws.on('open', () => ws.send(JSON.stringify({ id: `tell-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...request })))
  ws.on('message', raw => { clearTimeout(timer); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } ws.close() })
  ws.on('error', error => { clearTimeout(timer); reject(error) })
})

const main = async () => {
  const asked = await send({
    op: 'chat-ask', cell: target, text,
    payload: { trust: false, open: flag('--open'), ...(valueOf('--name') ? { name: valueOf('--name') } : {}) },
  })
  if (!asked.ok) { console.error(asked.error); process.exit(1) }
  const { askId, convoId } = asked.data
  if (flag('--no-wait')) { console.log(JSON.stringify({ convoId, askId, posted: true }, null, 1)); return }
  const deadline = Date.now() + Number(process.env.TELL_WAIT_MS || 600_000)
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 2_000))
    const reply = await send({ op: 'chat-asked', cell: askId })
    if (!reply.ok) { console.error(reply.error); process.exit(1) }
    if (!reply.data?.done) continue
    const { outcome, held, answer, error, rounds, tokens } = reply.data
    console.log(JSON.stringify({ convoId, outcome, ...(held ? { held, note: 'waiting for the participant in Execution; come back to this conversation later' } : {}), rounds, tokens, ...(error ? { error } : {}), answer }, null, 1))
    return
  }
  console.log(JSON.stringify({ convoId, askId, outcome: 'pending', note: 'still running; read it later with manager.cjs thread <convoId>' }, null, 1))
}

main().catch(error => { console.error(error.message); process.exit(1) })
