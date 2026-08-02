// ONE autonomous drain tick — answer pending hive asks without a parked session.
//
//   node scripts/bridge/drain-tick.cjs           run one tick
//   node scripts/bridge/drain-tick.cjs --dry     report what it WOULD do, spend nothing
//
// Meant to be driven by an OS scheduler (Windows Task Scheduler / cron). The
// bridge-listen skill covers the session-parked case — instant, but only while
// a session is open. This covers the other case: nobody is watching, and asks
// should still get answered.
//
// COST SHAPE — the point of this file. Model time is only spent when there is
// real work:
//
//   1. Ask the broker for pending kind:'ask' records. Node only. Free. ~ms.
//   2. None pending → exit 0 silently. The scheduler can fire every couple of
//      minutes forever and this costs nothing.
//   3. Some pending → invoke `claude -p` ONCE, headless, pointed at the
//      bridge-listen skill, which answers and retires them.
//
// So the interval buys latency, not spend. Failing to reach the broker (tab
// closed, broker down) is also free and silent — asks persist in the pool
// until something can answer them.
//
// Env:
//   BRIDGE_URL              broker (default ws://localhost:2401)
//   HYPERCOMB_BRIDGE_TOKEN  only needed for a REMOTE broker
//   DRAIN_MODEL             model for the headless run (default haiku — asks
//                           are small; the model hint in the ask is advisory)
//   DRAIN_LOG               append a line per tick here (default: no log)

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()
// The ask carries a model HINT (/opus, /sonnet, /haiku, /fable). Map it to a
// real model id so an unattended drain answers with the model that was asked
// for. DRAIN_MODEL overrides everything when set.
const MODEL_IDS = {
  fable: 'claude-fable-5',
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
}
const MODEL_OVERRIDE = String(process.env.DRAIN_MODEL || '').trim()
const modelFor = (hint) =>
  MODEL_OVERRIDE || MODEL_IDS[String(hint || '').toLowerCase()] || MODEL_IDS.haiku
const LOG = process.env.DRAIN_LOG || ''
const DRY = process.argv.includes('--dry')
const REPO = path.resolve(__dirname, '..', '..')

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`
  console.log(stamped)
  if (LOG) { try { fs.appendFileSync(LOG, stamped + '\n') } catch { /* logging is best-effort */ } }
}

// Step 1 — the free look. Never throws: an unreachable broker is a normal
// resting state (tab closed), not an error worth waking anyone for.
function pendingAsks() {
  return new Promise(resolve => {
    const opts = TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined
    let ws
    try { ws = new WebSocket(BRIDGE, opts) } catch { return resolve(null) }
    const done = (v) => { clearTimeout(t); try { ws.close() } catch {} ; resolve(v) }
    const t = setTimeout(() => done(null), 10_000)
    ws.on('open', () => ws.send(JSON.stringify({ op: 'optimization-list', kind: 'ask', id: `drain-${Date.now()}` })))
    ws.on('message', raw => {
      try {
        const r = JSON.parse(String(raw))
        // `mode:'stop'` records are tombstones for asks the participant
        // stopped — never work to do. The ask they name is already gone.
        const items = (r.data?.items ?? []).filter(it => it?.payload?.mode !== 'stop')
        done(r.ok ? items : null)
      } catch { done(null) }
    })
    ws.on('error', () => done(null))
  })
}

// Step 2 — the only place model time is spent.
function runClaude(count, model) {
  const prompt = [
    `${count} hive ask${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} pending on the Claude Bridge.`,
    'Read .claude/skills/bridge-listen/SKILL.md and follow its section 3 exactly to answer and retire them.',
    'Work from the repo root. Do not start a Monitor and do not park — answer what is pending, then stop.',
    'Ground each answer by reading the target tile over the bridge first.',
    'Answer only what was asked: never propose or create tiles unless the ask itself asks for that.',
    'If an ask raises a decision rather than a question, mint a dashboard question instead of deciding.',
  ].join(' ')

  return new Promise(resolve => {
    // Windows npm installs a `claude.cmd` shim; naming it directly lets us
    // skip `shell:true` (which mangles argument escaping and warns DEP0190).
    const bin = process.platform === 'win32' ? 'claude.cmd' : 'claude'
    const child = spawn(bin, [
      '-p', prompt,
      '--model', model,
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Bash Read Grep Glob',
      '--output-format', 'text',
    ], {
      cwd: REPO,
      shell: false,
      // stdin CLOSED, not inherited: a scheduled task has no console, and the
      // CLI otherwise waits ~3s for stdin that will never arrive.
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let out = ''
    child.stdout.on('data', d => { out += String(d) })
    child.stderr.on('data', d => { out += String(d) })
    child.on('close', code => resolve({ code, out: out.trim().slice(-2000) }))
    child.on('error', err => resolve({ code: -1, out: String(err) }))
  })
}

async function main() {
  const items = await pendingAsks()
  if (items === null) { log('bridge unreachable — nothing to do'); return }
  if (items.length === 0) { log('no pending asks'); return }

  // One invocation PER MODEL: an ask asked with /opus is answered by Opus, an
  // ask asked with /fable by Fable. Batches of the same model share a run.
  const groups = new Map()
  for (const it of items) {
    const model = modelFor(it.payload?.model)
    if (!groups.has(model)) groups.set(model, [])
    groups.get(model).push(it)
  }

  if (DRY) {
    for (const [model, group] of groups) {
      log(`DRY: ${group.length} pending for ${model} — ${group.map(it => `${String(it.sig).slice(0, 8)}:${String(it.payload?.prompt ?? '').slice(0, 40)}`).join(' | ')}`)
    }
    return
  }

  for (const [model, group] of groups) {
    log(`${group.length} pending — invoking claude (${model})`)
    const { code, out } = await runClaude(group.length, model)
    log(`claude exited ${code}${out ? ` — ${out.split('\n').slice(-3).join(' / ')}` : ''}`)
  }
}

main().catch(err => { log(`tick failed: ${String(err)}`); process.exitCode = 0 })
