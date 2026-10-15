// say.cjs — speak one sentence to the hive, the way a participant types it.
//
//   node scripts/bridge/say.cjs "<sentence>" [--file <path>]... [--listen <ms>]
//
// The sentence goes to the hive's own command line (the remote door), where
// the same words a person types run under the same admission rules. Nothing
// else is sent: no raw ops. See documentation/speak-dont-bridge.md.
//
// FILES RIDE WITH THE SENTENCE, the remote twin of a drop: each --file is sent
// with the line, stored by its SHA-256 before the line runs, and named in the
// sentence by that signature. Write `{<file name>}` in the sentence and it is
// replaced with the file's signature, computed here:
//
//   say.cjs "website page {meetups.html}" --file page/meetups.html
//
// The reply prints the outcome, the files as stored, and what the hive SAID
// while the line ran (activity lines and toasts) — which is how a session
// reads: a word that answers (`opens meetups`) answers here.
//
// Git Bash rewrites a leading `/` into a Windows path: run with
// MSYS_NO_PATHCONV=1, or say the word without its slash.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'

const args = process.argv.slice(2)
let sentence = ''
const files = []
let listen = 1500
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file') files.push(args[++i])
  else if (args[i] === '--listen') listen = Number(args[++i])
  else sentence = sentence ? `${sentence} ${args[i]}` : args[i]
}
if (!sentence.trim()) {
  console.error('usage: say.cjs "<sentence>" [--file <path>]... [--listen <ms>]')
  process.exit(2)
}

const riding = files.map(file => {
  const bytes = fs.readFileSync(file)
  return {
    name: path.basename(file),
    sig: crypto.createHash('sha256').update(bytes).digest('hex'),
    base64: bytes.toString('base64'),
  }
})
for (const f of riding) sentence = sentence.split(`{${f.name}}`).join(f.sig)
const unfilled = sentence.match(/\{[^{}\s]+\}/)
if (unfilled) {
  console.error(`no --file named ${unfilled[0]} rides with this sentence`)
  process.exit(2)
}

const ws = new WebSocket(BRIDGE, { maxPayload: 128 * 1024 * 1024 })
const id = `say-${Date.now()}`
const timer = setTimeout(() => { console.error('the hive did not answer'); process.exit(1) }, listen + 120_000)
ws.on('error', e => { console.error('cannot reach the hive:', e.message); process.exit(1) })
ws.on('open', () => ws.send(JSON.stringify({
  id, op: 'submit', text: sentence, listen,
  files: riding.map(({ name, sig, base64 }) => ({ name, sig, base64 })),
})))
ws.on('message', raw => {
  let m; try { m = JSON.parse(String(raw)) } catch { return }
  if (m.id !== id) return
  clearTimeout(timer)
  ws.close()
  if (!m.ok) { console.error('refused before it ran:', m.error); process.exit(1) }
  const d = m.data || {}
  console.log(`said: ${sentence}`)
  console.log(`  ${d.summary || JSON.stringify(d.outcome)}`)
  for (const f of d.files || []) console.log(`  file ${f.name} → ${f.sig} (${f.size} bytes)`)
  for (const h of d.heard || []) console.log(`  hive: ${h.text}`)
  const kind = d.outcome && d.outcome.kind
  process.exit(kind === 'refused' || kind === 'ambiguous' ? 1 : 0)
})
