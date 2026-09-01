// orchestrator-sweep.cjs — the REPO-SIDE half of the orchestrator.
//
// The in-hive orchestrator (essentials/…/assistant/orchestrator.drone.ts)
// watches agents: what stalled, what went silent, what overlapped. It cannot
// see the things that only exist outside the browser, which is where work
// actually goes rogue quietly:
//
//   logs        stray *.log / debug output a run left behind in the repo
//
// Findings are printed as JSON (so a parked Claude Code can act on them) AND
// pushed onto the orchestrator's bee via the `agent-progress` bridge op, so
// the hive shows repo drift in the same place it shows a stalled ask.
//
//   node scripts/bridge/orchestrator-sweep.cjs           → sweep + report
//   node scripts/bridge/orchestrator-sweep.cjs --dry     → print only, no push
//   node scripts/bridge/orchestrator-sweep.cjs --clear   → clear pushed findings
//
// Read-only against the repo and the hive: it writes no file, no layer, no
// note. Reporting is the whole job — deciding what to do about a finding is
// the participant's, exactly like the in-hive half.

const WebSocket = require('ws')
const { execSync } = require('node:child_process')
const { readdirSync, statSync } = require('node:fs')
const { resolve } = require('node:path')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()
const WS_OPTS = TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined
const ORCHESTRATOR_ID = 'orchestrator'
const SWEEP_PREFIX = 'sweep: '
const DRY = process.argv.includes('--dry')
const CLEAR = process.argv.includes('--clear')

// Repo root = two levels up from scripts/bridge.
const ROOT = resolve(__dirname, '..', '..')

let counter = 0
function send(req) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(BRIDGE, WS_OPTS)
    const t = setTimeout(() => { try { ws.close() } catch {} ; rej(new Error('bridge timeout')) }, 60_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `sweep-${Date.now()}-${++counter}` })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { res(JSON.parse(String(raw))) } catch (e) { rej(e) }
      ws.close()
    })
    ws.on('error', e => { clearTimeout(t); rej(e) })
  })
}

// ── logs ──────────────────────────────────────────────────────────────
// Only files git can SEE (tracked or untracked-but-not-ignored) count: a log
// under an ignored build dir is nobody's problem, and reporting it every run
// would train the reader to ignore the whole sweep.

function strayLogs() {
  let listed = ''
  try {
    listed = execSync('git ls-files --cached --others --exclude-standard', { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch { return [] }
  return listed.split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(path => /(^|\/)(npm-debug|yarn-error|lerna-debug)\.log$|\.log$|(^|\/)nohup\.out$/i.test(path))
    .filter(path => !path.includes('node_modules/'))
}

// ── report ────────────────────────────────────────────────────────────

async function push(text) {
  if (DRY) return
  try {
    const r = await send({ op: 'agent-progress', cell: ORCHESTRATOR_ID, text: SWEEP_PREFIX + text, kind: 'working' })
    if (!r.ok) console.error('[sweep] push failed:', r.error)
  } catch (e) { console.error('[sweep] push failed:', e.message) }
}

async function main() {
  if (CLEAR) {
    await send({ op: 'agent-progress', cell: ORCHESTRATOR_ID, text: SWEEP_PREFIX + 'clear', kind: 'pending' })
    console.log('[sweep] cleared')
    return
  }

  const findings = []
  for (const path of strayLogs()) findings.push({ kind: 'logs', text: `stray log file in the repo: ${path}` })

  console.log(JSON.stringify({ findings, counts: {
    logs: findings.filter(f => f.kind === 'logs').length,
  } }, null, 2))

  // Clear first so a fixed finding actually disappears, then push what stands.
  if (!DRY) await send({ op: 'agent-progress', cell: ORCHESTRATOR_ID, text: SWEEP_PREFIX + 'clear', kind: 'pending' })
    .catch(() => {})
  // Cap what reaches the bee: a panel with 200 lines in it is not a report.
  for (const finding of findings.slice(0, 12)) await push(finding.text)
  if (findings.length > 12) await push(`…and ${findings.length - 12} more (run the sweep for the full list)`)
}

main().catch(err => { console.error(String(err && err.message || err)); process.exit(1) })
