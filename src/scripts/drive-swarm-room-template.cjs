// scripts/drive-swarm-room-template.cjs
//
// THE ROOM'S TEMPLATE (documentation/swarm-pools.md, step three). The HOST —
// the key a relay publishes as `_` at /.well-known/nostr.json — shares a page
// in the room; the room pool keeps its word as a member signed by that key.
// That member IS the room's template:
//
//   - a participant who arrives AFTER the host left still gets the tile,
//     marked as the template, with its notes, and can take it
//   - the template never counts as somebody present
//
//   node scripts/drive-swarm-room-template.cjs --url http://localhost:4251/ [--relay-port 7793]

const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const H = require('./drive-swarm-connectivity.cjs')

const PORT = Number((process.argv.find((a, i) => process.argv[i - 1] === '--relay-port')) || 7793)
const RELAY = `ws://localhost:${PORT}`
const HOST_SECRET = '00000000000000000000000000000000000000000000000000000000000000a7'
const TILE = 'agenda'
const NOTE = 'Agenda: energy in the cell — glycolysis, Krebs, the electron transport chain'

let relay
async function startHostRelay(hostPubkey) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-room-template-'))
  relay = spawn(process.execPath, [path.join(__dirname, '..', 'hypercomb-relay', 'relay.js'), '--port', String(PORT), '--content-dir', dir,
    '--writers', hostPubkey, '--primary', hostPubkey, '--domain', 'localhost', '--allow-participants'], { stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch { /* not yet */ }
    await H.sleep(100)
  }
  throw new Error('host relay did not start')
}

const zoneFor = (seed = {}) => ({ room: 'template-room', secret: 'template-secret', relay: RELAY, seed: { 'hc:swarm:sticky': '1', ...H.swarmSeed(RELAY), ...seed } })

async function boot(label, seed) {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const c = await H.newClient(browser, label, zoneFor(seed)); c.browser = browser
  await c.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(c.page); await H.installIfNeeded(c.page, label)
  if (!(await H.waitForReady(c.page))) throw new Error(`${label}: not ready`)
  await H.settle(c.page)
  return c
}

const word = (c, text) => H.evalSafe(() => c.page.evaluate((t) => {
  window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').emitEffect('command-line:remote-submit', { text: t }); return true
}, text))
const joined = (c) => H.evalSafe(() => c.page.evaluate(() => localStorage.getItem('hc:mesh-public') === 'true'))

;(async () => {
  const hostPubkey = await (async () => {
    const { getPublicKey } = await import('nostr-tools/pure')
    return getPublicKey(Uint8Array.from(Buffer.from(HOST_SECRET, 'hex')))
  })()
  await startHostRelay(hostPubkey)
  const named = await (await fetch(`http://localhost:${PORT}/.well-known/nostr.json?name=_`)).json()
  H.check('the relay names its host as _', named?.names?._ === hostPubkey, JSON.stringify(named))

  // THE HOST prepares the room: shares an agenda tile with a note, then leaves.
  const host = await boot('Host', { 'hc:nostr:secret-key': HOST_SECRET })
  await word(host, '/join')
  H.check('the host joined', (await H.waitFor(() => joined(host), j => j, 30000, 500)).ok)
  await H.addTile(host.page, TILE)
  await H.sleep(2000)
  await H.evalSafe(() => host.page.evaluate(({ tile, note }) => {
    window.__hypercombEffectBus.emit('note:commit', { cellLabel: tile, text: note, mark: null }); return true
  }, { tile: TILE, note: NOTE }))
  const pool = await H.evalSafe(() => host.page.evaluate(async () => await window.ioc.get('@diamondcoreprocessor.com/RoomPool').address()))
  const listed = await H.waitFor(async () => {
    const res = await fetch(`http://localhost:${PORT}/${pool}/`)
    return res.ok ? (await res.text()).split('\n').filter(Boolean).length : 0
  }, n => n > 0, 60000, 1000)
  H.check('the host\'s share is a member of the room pool', listed.ok, `${listed.waitedMs}ms`)
  await H.sleep(8000) // let the latest word (with the note) settle into the pool
  await word(host, '/leave')
  await H.sleep(2000)
  try { await host.browser.close() } catch { /* gone */ }

  // A PARTICIPANT arrives after the host has gone.
  const guest = await boot('Guest')
  await word(guest, '/join')
  H.check('the guest joined', (await H.waitFor(() => joined(guest), j => j, 30000, 500)).ok)
  const seen = await H.waitFor(() => H.evalSafe(() => guest.page.evaluate(async () => {
    await window.ioc.get('@diamondcoreprocessor.com/RoomPool').read()
    const sw = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
    return {
      tiles: sw.peerTilesAtCurrentSig().map(t => ({ name: t.name, template: !!t.template, by: t.peerPubkey.slice(0, 8) })),
      people: sw.participantsInZone().length,
      templates: window.ioc.get('@diamondcoreprocessor.com/RoomPool').templates().length,
    }
  })), v => (v?.tiles ?? []).some(t => t.name === TILE && t.template), 60000, 2000)
  H.check('a late guest gets the template tile though the host is gone', seen.ok, JSON.stringify(seen.value))
  H.check('the template is not counted as someone present', seen.value?.people === 0, JSON.stringify({ people: seen.value?.people }))

  const notes = await H.waitFor(() => H.evalSafe(() => guest.page.evaluate(async (tile) => {
    const sn = window.ioc.get('@diamondcoreprocessor.com/SwarmNotes')
    await sn.refresh(tile)
    return sn.rootsFor(tile).map(r => r.note.text)
  }, TILE)), v => (v ?? []).includes(NOTE), 60000, 2000)
  H.check('the template tile carries its notes to the guest', notes.ok, JSON.stringify(notes.value))

  console.log('\n========== the room template ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  try { await guest.browser.close() } catch { /* gone */ }
  relay.kill()
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); try { relay?.kill() } catch {}; process.exit(1) })
