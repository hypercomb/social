// Read the live swarm in one call — the bridge op `swarm-debug`
// (hypercomb-essentials/src/assistant/swarm-debug.ts).
//
//   npm run bridge:swarm                         # a summary, then the snapshot
//   node scripts/bridge/swarm-debug.cjs          # the same
//   node scripts/bridge/swarm-debug.cjs --json   # the snapshot alone, as JSON
//
// READ-ONLY: one request, and the renderer answers it without emitting,
// writing or dialling anything. The snapshot never carries the room secret,
// the access code, a key, a token, a bridge code or a private tile name — the
// renderer redacts before it answers. This is the read for a live failure on a
// hive tab you must not open a second tab on (a second tab is a second member
// and changes what it measures).
//
// BRIDGE_URL overrides the broker (default ws://localhost:2401). It sends no
// bridge code: like bridge-cli, it serves this machine only.
const WebSocket = require('ws')

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const TIMEOUT_MS = 15_000
const asJson = process.argv.includes('--json')
const unknown = process.argv.slice(2).filter(a => a !== '--json')
if (unknown.length) { console.error(`usage: node scripts/bridge/swarm-debug.cjs [--json]  (unknown: ${unknown.join(' ')})`); process.exit(1) }

const READY = ['connecting', 'open', 'closing', 'closed']
const ago = (ms) => typeof ms === 'number' && ms > 0 ? `${Math.round((Date.now() - ms) / 1000)}s ago` : '—'
const yes = (v) => v === true ? 'yes' : v === false ? 'no' : '?'
const val = (v) => v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)
/** A list's real length: the renderer caps lists at 64 and ends them with "… N more". */
const counted = (list) => (Array.isArray(list) ? list : []).reduce((n, x) => {
  const more = /^… (\d+) more$/.exec(String(x))
  return n + (more ? Number(more[1]) : 1)
}, 0)

function summary(d) {
  const lines = []
  const m = d.membership ?? {}
  const z = m.zone
  lines.push(`member  joined ${yes(m.joined)}` + (z
    ? ` · room ${val(z.room)} · relay ${z.relay ? z.relay : "— (the page's own list)"} · host ${val(z.host)} · secret ${z.hasSecret ? 'set' : 'none'} · code ${z.hasCode ? 'set' : 'none'}`
    : ' · no zone'))

  const mesh = d.mesh ?? {}
  if (mesh.available === false) lines.push(`mesh    not loaded · last connection ${val(mesh.connection?.state)}`)
  else {
    const c = mesh.connection ?? {}
    const sockets = (mesh.sockets ?? []).map(s => `${s.url} ${READY[s.readyState] ?? s.readyState}`).join(', ') || 'none'
    const relays = Array.isArray(mesh.relays)
      ? `${mesh.relays.slice(0, 4).join(' ') || 'none'}${counted(mesh.relays) > 4 ? ` (+${counted(mesh.relays) - 4} more)` : ''}`
      : 'unreadable'
    const st = mesh.stats ?? {}
    lines.push(`mesh    ${val(c.state)}${c.refused ? ` (refused: ${c.refused})` : ''} · attempt ${val(c.attempt)} · since ${ago(c.since)} · network ${yes(mesh.networkEnabled)} · addressed ${yes(mesh.relaysAddressed)}`)
    // The banner's "Can't reach {host}" names THIS: the meeting relay, never
    // an upload host. With no zone relay and no hc:nostrmesh:relays, a real
    // host meets at the built-in wss://jwize.com.
    lines.push(`        meets at ${val(mesh.swarmHost)} · relays ${relays} · sockets: ${mesh.sockets === null ? 'unreadable' : sockets}`)
    if (c.state && c.state !== 'open') lines.push(`        not open — a banner "Can't reach ${val(mesh.swarmHost)}" is this meeting relay, not an upload host (see share below)`)
    lines.push(`        sent ${val(st.eventSent)} events / ${val(st.reqSent)} REQs · in ${val(st.msgIn)} · rejected ${val(st.rejected)} · retried ${val(st.retrySent)}`)
  }

  const s = d.swarm ?? {}
  if (s.available === false) lines.push('swarm   not loaded')
  else {
    if (s.debugAvailable === false) lines.push('swarm   this package has no debug(): the fields below read null')
    else if (Array.isArray(s.debugMissing) && s.debugMissing.length) lines.push(`swarm   debug() did not report: ${s.debugMissing.join(' ')} (null below, not empty)`)
    const fa = s.firstAnnounce
    lines.push(`swarm   sig ${val(s.currentSig)} · page /${(s.lastSyncInput?.segments ?? []).join('/')} · subs ${val(s.subsCount)} · peers here ${val(s.participantsAtCurrentSig)} · in zone ${val(s.participantsInZone)} · peer tiles ${val(s.peerTilesAtCurrentSigCount)}`)
    lines.push(`        joined ${ago(s.joinedAtMs)} · first announce ${fa ? `${val(fa.page)} +${val(fa.afterJoinMs)}ms after join` : 'none yet'}`)
    const f = s.inFlight ?? {}
    lines.push(`        in flight: pages ${(f.pages ?? []).join(' ') || 'none'} · channel ${val(f.channel)} · questions ${val(f.questions)} · seals ${val(f.seals)}`)
    // Newest last: the five most recent of the walks this tab remembers.
    const walks = (Array.isArray(s.walks) ? s.walks : []).filter(w => w && typeof w === 'object').slice(-5)
    lines.push(s.walksCount === null || s.walksCount === undefined
      ? '        walks not reported by this swarm package'
      : `        walks remembered ${val(s.walksCount)}${walks.length ? ', newest last:' : ''}`)
    for (const w of walks) {
      lines.push(`        walk ${val(w.page)}: ${val(w.outcome)} in ${val(w.ms)}ms · full ${val(w.full)} previous ${val(w.previous)} placeholder ${val(w.placeholder)} private ${val(w.private)}`)
    }
  }

  const share = d.share ?? {}
  const ss = share.shareStatus
  if (ss) lines.push(`page    ${val(ss.location)} · offered ${val(ss.offered)} · uploading ${val(ss.uploading)} · name-only ${val(ss.nameOnly)} · private ${val(ss.private)} · host ${val(ss.host)} (${val(ss.hostSource)}) ${val(ss.hostState)}${ss.reason ? ` — ${ss.reason}` : ''}`)
  for (const [host, w] of Object.entries(share.syncByHost ?? {})) {
    const trouble = share.hostTrouble?.[host]
    lines.push(`upload  ${host}: ${val(w?.status)}${w?.swarm ? ` (swarm, ${val(w?.source)})` : ''} · pending ${val(w?.pending)} · heard ${w?.heardAtMs ? ago(w.heardAtMs) : 'before the bridge loaded'}${w?.reason ? ` — ${w.reason}` : ''}${trouble ? ` · trouble ${val(trouble.why)}` : ''}`)
  }
  // A host in trouble that no sync word named (the zone's, the share line's).
  for (const [host, trouble] of Object.entries(share.hostTrouble ?? {})) {
    if (trouble && !(host in (share.syncByHost ?? {}))) lines.push(`upload  ${host}: trouble ${val(trouble.why)} — ${val(trouble.reason)}`)
  }
  const t = share.targets
  if (t) lines.push(`targets backup ${yes(t.backupEnabled)} · public host ${yes(t.publicHostEnabled)} (${val(t.publicHostDomain)}) · publish nodes ${(Array.isArray(t.publishNodes) ? t.publishNodes : []).join(' ') || 'none'}`)
  return lines.join('\n')
}

const id = `swarm-debug-${Date.now()}`
const ws = new WebSocket(BRIDGE)
const timer = setTimeout(() => { console.error(`timeout: no answer from ${BRIDGE} in ${TIMEOUT_MS / 1000}s`); process.exit(1) }, TIMEOUT_MS)
ws.on('open', () => ws.send(JSON.stringify({ id, op: 'swarm-debug' })))
ws.on('message', (raw) => {
  let res
  try { res = JSON.parse(String(raw)) } catch { return }
  if (res?.id !== id) return
  clearTimeout(timer)
  ws.close()
  if (!res.ok) { console.error(`swarm-debug failed: ${res.error ?? 'unknown error'}`); process.exit(1) }
  if (asJson) console.log(JSON.stringify(res.data, null, 2))
  else console.log(`${summary(res.data ?? {})}\n\n${JSON.stringify(res.data, null, 2)}`)
  process.exit(0)
})
ws.on('error', (e) => { clearTimeout(timer); console.error(`bridge unreachable at ${BRIDGE}: ${e.message || e}`); process.exit(1) })
