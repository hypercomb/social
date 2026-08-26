// bridge-agents.cjs — WHO CAN ANSWER THE HIVE, and telling the hive so.
//
//   node scripts/bridge/agent-bridges.cjs            (alias) same as --list
//   node scripts/bridge/bridge-agents.cjs --list     probe PATH, print a report
//   node scripts/bridge/bridge-agents.cjs --json     the same, machine-readable
//   node scripts/bridge/bridge-agents.cjs --announce probe, then register the
//                                                    installed ones with the hive
//   node scripts/bridge/bridge-agents.cjs --announce --all
//                                                    announce every declared
//                                                    bridge, installed or not
//                                                    (for a machine that will
//                                                    install one later)
//
// WHY ANNOUNCE AT ALL. A browser cannot look at your PATH, so the hive has no
// way to know that `gemini` exists on this machine. This script is the one
// place that knowledge crosses over: it probes locally, turns each installed
// CLI into an `llm-provider@1` spec with `transport: 'agent-bridge'`, and
// sends it over the SAME broker every other bridge client uses. The renderer
// registers it and persists it into the `llm:providers` pool, so the bridge
// keeps its row in the providers console across reloads.
//
// After announcing, `/providers` lists (say) Gemini CLI beside the HTTP
// vendors — no key field (the CLI carries its own account), a "reads the
// hive" badge (this tier is the only one that can walk the tree), and its
// model words become things you can type at the command line.
//
// Env: BRIDGE_URL (default ws://localhost:2401), HYPERCOMB_BRIDGE_TOKEN
// (only for a remote broker).

const WebSocket = require('ws')
const roster = require('./agent-roster.cjs')
const { subscriptionUsage } = require('./subscription-usage.cjs')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()
const WS_OPTS = TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined

const ANNOUNCE = process.argv.includes('--announce')
const AS_JSON = process.argv.includes('--json')
const ALL = process.argv.includes('--all')

function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE, WS_OPTS)
    const id = `agents-${Date.now()}-${Math.floor(process.hrtime()[1] / 1000)}`
    const timer = setTimeout(() => { try { ws.close() } catch {} ; reject(new Error('bridge timeout')) }, 15_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id })))
    ws.on('message', raw => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      try { ws.close() } catch {}
    })
    ws.on('error', err => { clearTimeout(timer); reject(err) })
  })
}

async function main() {
  const probed = roster.probeAll()
  const live = probed.filter(a => a.installed)
  const usage = new Map(await Promise.all(live.map(async agent => [agent.id, await subscriptionUsage(agent)])))
  for (const agent of live) agent.subscription = usage.get(agent.id)

  if (AS_JSON) {
    console.log(JSON.stringify(probed.map(a => ({
      id: a.id, label: a.label, vendor: a.vendor, bin: a.bin,
      installed: a.installed, version: a.version,
      models: (a.models ?? []).map(m => m.name),
    })), null, 2))
  } else {
    console.log(`\n  FRONTIER BRIDGES — ${live.length}/${probed.length} installed on this machine\n`)
    for (const a of probed) {
      const mark = a.installed ? '  ●' : '  ○'
      const detail = a.installed
        ? `${a.version || 'installed'}`
        : `not installed — ${a.docsUrl}`
      console.log(`${mark} ${a.label.padEnd(16)} ${String(a.bin || a.id).padEnd(10)} ${detail}`)
      console.log(`     models: ${(a.models ?? []).map(m => m.name).join(', ')}`)
      if (a.installed) {
        const sub = usage.get(a.id)
        const windows = (sub?.windows ?? []).map(w => `${Math.round(w.remainingPercent)}% ${w.label}`).join(', ')
        console.log(`     limits: ${windows || sub?.message || 'not reported'}`)
      }
    }
    console.log('')
  }

  if (!ANNOUNCE) {
    if (!AS_JSON) {
      console.log('  (--announce registers the installed ones with the running hive)\n')
    }
    return
  }

  const announcing = ALL ? probed : live
  if (!announcing.length) {
    console.log('  nothing to announce — no bridge CLI found on PATH')
    return
  }

  const specs = announcing.map(agent => roster.toProviderSpec({
    ...agent,
    subscription: agent.subscription ?? usage.get(agent.id) ?? {
      status: 'unknown', source: `${agent.label} CLI`, checkedAt: Date.now(), windows: [],
      message: 'Usage limits are not reported by this CLI',
    },
  }))
  let reply
  try {
    reply = await send({ op: 'agents-announce', agents: specs })
  } catch (err) {
    console.error(`  bridge unreachable (${BRIDGE}): ${err.message}`)
    console.error('  start the broker and open the hive tab, then re-run with --announce')
    process.exitCode = 1
    return
  }
  if (!reply.ok) {
    console.error(`  announce refused: ${reply.error || 'unknown error'}`)
    process.exitCode = 1
    return
  }
  const data = reply.data ?? {}
  console.log(`  announced ${data.registered ?? specs.length} bridge(s) to the hive`)
  if (Array.isArray(data.rejected) && data.rejected.length) {
    for (const r of data.rejected) console.error(`  rejected ${r.id}: ${r.reason}`)
  }
  console.log('  open /providers in the hive to see them\n')
}

main().catch(err => { console.error(String(err)); process.exit(1) })
