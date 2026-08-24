// ONE autonomous drain tick — answer pending hive asks without a parked session,
// with WHICHEVER frontier CLI the ask asked for.
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
//   3. Some pending → invoke the RIGHT CLI once per bridge, headless, pointed
//      at the bridge-listen skill, which answers and retires them.
//
// WHICH CLI. The ask carries a model hint (`/opus`, `/gemini`, `/codex`).
// `agent-roster.cjs` maps that hint to the bridge that owns the model and to
// the exact argv that CLI wants (data, in agent-bridges.json). A hint nobody
// claims — or an ask for a bridge not installed here — falls back to the first
// installed bridge rather than going unanswered, and says so in the log: a
// question answered by a different model beats a question dropped.
//
// So the interval buys latency, not spend. Failing to reach the broker (tab
// closed, broker down) is also free and silent — asks persist in the pool
// until something can answer them.
//
// Env:
//   BRIDGE_URL              broker (default ws://localhost:2401)
//   HYPERCOMB_BRIDGE_TOKEN  only needed for a REMOTE broker
//   DRAIN_MODEL             force one model for every run, whatever was asked
//   DRAIN_AGENT             force one bridge id (claude-bridge, codex-bridge…)
//   DRAIN_LOG               append a line per tick here (default: no log)

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')
const roster = require('./agent-roster.cjs')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()
// The ask carries a model HINT (/opus, /gemini, /codex, …). The ROSTER maps it
// to the bridge that owns that model and to that CLI's own argv — so adding a
// vendor is an entry in agent-bridges.json, and this file never learns a name.
const MODEL_OVERRIDE = String(process.env.DRAIN_MODEL || '').trim()
const AGENT_OVERRIDE = String(process.env.DRAIN_AGENT || '').trim()
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

// WHO ANSWERS THIS ASK. Resolved against what is actually installed, so a
// machine with only Claude Code behaves exactly as it did before.
function planFor(hint, installed) {
  const wanted = AGENT_OVERRIDE || hint
  const owner = roster.agentForModel(wanted, installed)
  if (owner) return { agent: owner, model: MODEL_OVERRIDE || hint, fellBack: false }
  // The asked-for bridge is not on this machine (or the hint named nothing the
  // roster knows). Answering with what IS here beats silence — but it is a
  // substitution, and the log has to say so.
  const fallback = installed[0]
  return fallback ? { agent: fallback, model: MODEL_OVERRIDE || '', fellBack: true } : null
}

// Step 2 — the only place model time is spent.
function runAgent(agent, count, modelHint) {
  const prompt = [
    // Vendor-neutral: the skill file is the contract, and any coding agent
    // with repo access can follow it — which is exactly why every frontier
    // CLI can be a bridge without the hive learning its name.
    `${count} hive ask${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} pending on the Hypercomb bridge.`,
    'Read .claude/skills/bridge-listen/SKILL.md and follow its section 3 exactly to answer and retire them.',
    'Work from the repo root. Do not start a Monitor and do not park — answer what is pending, then stop.',
    'Ground each answer by reading the target tile over the bridge first.',
    'Answer only what was asked: never propose or create tiles unless the ask itself asks for that.',
    'If an ask raises a decision rather than a question, mint a dashboard question instead of deciding.',
  ].join(' ')

  // The roster resolves the ABSOLUTE binary (Windows npm ships `.cmd` shims)
  // and substitutes {prompt}/{model} into that CLI's own argv template, so we
  // never need `shell: true` — which mangles argument escaping and warns
  // DEP0190. Every vendor's flags are data, not code: agent-bridges.json.
  const { bin, model, file, spawnArgs, options } = roster.invocation(agent, prompt, modelHint)

  return new Promise(resolve => {
    if (!bin) return resolve({ code: -1, out: `${agent.id}: binary not found on PATH`, model })
    const child = spawn(file, spawnArgs, {
      cwd: REPO,
      shell: false,
      ...options,
      // stdin CLOSED, not inherited: a scheduled task has no console, and the
      // CLI otherwise waits ~3s for stdin that will never arrive.
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let out = ''
    child.stdout.on('data', d => { out += String(d) })
    child.stderr.on('data', d => { out += String(d) })
    child.on('close', code => resolve({ code, out: out.trim().slice(-2000), model }))
    child.on('error', err => resolve({ code: -1, out: String(err), model }))
  })
}

async function main() {
  const items = await pendingAsks()
  if (items === null) { log('bridge unreachable — nothing to do'); return }
  if (items.length === 0) { log('no pending asks'); return }

  const installed = roster.installed()
  if (!installed.length) {
    log('no bridge CLI installed here — run scripts/bridge/bridge-agents.cjs --list')
    return
  }

  // One invocation PER BRIDGE+MODEL: an ask asked with /opus is answered by
  // Claude Code on Opus, one asked with /gemini by the Gemini CLI. Asks that
  // resolve the same way share a run.
  const groups = new Map()
  for (const it of items) {
    const plan = planFor(String(it.payload?.model ?? ''), installed)
    if (!plan) continue
    const key = `${plan.agent.id}::${plan.model}`
    if (!groups.has(key)) groups.set(key, { ...plan, items: [] })
    groups.get(key).items.push(it)
  }

  if (DRY) {
    for (const [, g] of groups) {
      const how = `${g.agent.label}${g.model ? ` (${g.model})` : ''}${g.fellBack ? ' [fallback]' : ''}`
      log(`DRY: ${g.items.length} pending for ${how} — ${g.items.map(it => `${String(it.sig).slice(0, 8)}:${String(it.payload?.prompt ?? '').slice(0, 40)}`).join(' | ')}`)
    }
    return
  }

  for (const [, g] of groups) {
    if (g.fellBack) {
      log(`no bridge for "${g.items[0]?.payload?.model ?? ''}" here — falling back to ${g.agent.label}`)
    }
    log(`${g.items.length} pending — invoking ${g.agent.label}`)
    const { code, out, model } = await runAgent(g.agent, g.items.length, g.model)
    log(`${g.agent.id}${model ? ` (${model})` : ''} exited ${code}${out ? ` — ${out.split('\n').slice(-3).join(' / ')}` : ''}`)
  }
}

main().catch(err => { log(`tick failed: ${String(err)}`); process.exitCode = 0 })
