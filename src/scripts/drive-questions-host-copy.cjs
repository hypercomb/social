// scripts/drive-questions-host-copy.cjs
//
// THE HOST'S COPY (documentation/hypercomb-q-and-a.md). "There has to be a
// host that allows the answers to show for everybody." The HOST — the key a
// relay publishes as `_` — plays Hypercomb Q and A as the organizer: takes
// the room's questions, takes the answers, tallies. Its shares are the room's
// TEMPLATE on its host (RoomPool, swarm-pools.md step three). A participant
// who arrives after everyone has left still gets the game tile, the category
// inside it, the question inside that, its answer and its tally.
//
//   node scripts/drive-questions-host-copy.cjs --url http://localhost:4253/ [--relay-port 7794]
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const H = require('./drive-swarm-connectivity.cjs')

const PORT = Number((process.argv.find((a, i) => process.argv[i - 1] === '--relay-port')) || 7794)
const RELAY = `ws://localhost:${PORT}`
const HOST_SECRET = '00000000000000000000000000000000000000000000000000000000000000b1'
const GAME = 'hypercomb q and a'
const Q1 = 'what is a bag?'
const ANSWER = 'a bag is a lineage of markers'
let relay

async function startHostRelay(hostPubkey) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-qanda-host-'))
  relay = spawn(process.execPath, [path.join(__dirname, '..', 'hypercomb-relay', 'relay.js'), '--port', String(PORT), '--content-dir', dir,
    '--writers', hostPubkey, '--primary', hostPubkey, '--domain', 'localhost', '--allow-participants'], { stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch { /* not yet */ }
    await H.sleep(100)
  }
  throw new Error('host relay did not start')
}

const zoneFor = (seed = {}) => ({ room: 'qanda-host-room', secret: 'qanda-host-secret', relay: RELAY, seed: { 'hc:swarm:sticky': '1', ...H.swarmSeed(RELAY), ...seed } })

async function boot(label, seed) {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const c = await H.newClient(browser, label, zoneFor(seed)); c.browser = browser
  await c.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(c.page); await H.installIfNeeded(c.page, label)
  if (!(await H.waitForReady(c.page))) throw new Error(`${label}: not ready`)
  await H.settle(c.page)
  await H.evalSafe(() => c.page.evaluate((label) => { window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').setMyLabel(label) }, label))
  return c
}

const slug = (s) => String(s).trim().toLowerCase().replace(/[._\s]+/g, '-').replace(/[^\p{L}\p{N}\-]/gu, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
const has = (list, name) => (list ?? []).some(n => slug(typeof n === 'string' ? n : n.name) === slug(name))

const word = (c, text) => H.evalSafe(() => c.page.evaluate((t) => {
  window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').emitEffect('command-line:remote-submit', { text: t }); return true
}, text))
const joined = (c) => H.evalSafe(() => c.page.evaluate(() => localStorage.getItem('hc:mesh-public') === 'true'))
const segments = (c) => H.evalSafe(() => c.page.evaluate(() => window.ioc.get('@hypercomb.social/Lineage').explorerSegments()))
const goTo = (c, segs) => H.evalSafe(() => c.page.evaluate((segs) => { window.ioc.get('@hypercomb.social/Navigation').goRaw(segs); return true }, segs))
const childrenAt = (c, segs) => H.evalSafe(() => c.page.evaluate(async (segs) => {
  const h = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
  const layer = await h.currentLayerAt(await h.sign({ explorerSegments: () => segs }))
  const names = []
  for (const s of (layer?.children ?? [])) { try { const l = await h.getLayerBySig(s); if (l?.name) names.push(l.name) } catch { /* cold */ } }
  return names
}, segs))
const peerTiles = (c) => H.evalSafe(() => c.page.evaluate(() =>
  (window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').peerTilesAtCurrentSig?.() ?? []).map(t => ({ name: t.name, template: !!t.template }))))
const adopt = (c, label) => H.evalSafe(() => c.page.evaluate((label) => {
  const a = window.ioc.get('@diamondcoreprocessor.com/SwarmAdoptDrone')
  if (!a?.wandEligible?.(label)) return false
  window.__hypercombEffectBus.emit('tile:action', { action: 'adopt', label, q: 0, r: 0, index: 0 })
  return true
}, label))
const settleNow = (c) => H.evalSafe(() => c.page.evaluate(async () => {
  const q = window.ioc.get('@diamondcoreprocessor.com/Questions')
  return q ? await q.settle() : null
}))
const fakeJev = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const sort = async ({ notes, categories }) => ({ placed: notes.map(n => /bag|pool/i.test(n) ? categories.findIndex(k => /storage/i.test(k)) : -1) })
  const jev = window.ioc.get('@hypercomb.social/JevDecision')
  if (jev) { jev.readyForHive = () => true; jev.sort = sort; return 'patched' }
  window.ioc.register('@hypercomb.social/JevDecision', { readyForHive: () => true, sort })
  return 'registered'
}))
const write = (c, cell, text) => H.evalSafe(() => c.page.evaluate(({ cell, text }) => {
  window.__hypercombEffectBus.emit('note:commit', { cellLabel: cell, text, mark: null }); return true
}, { cell, text }))
const roomRoots = (c, cell) => H.evalSafe(() => c.page.evaluate(async (cell) => {
  const sn = window.ioc.get('@diamondcoreprocessor.com/SwarmNotes')
  await sn.refresh(cell)
  return sn.rootsFor(cell).map(r => ({ id: r.note.id, text: r.note.text, holders: r.holders.length }))
}, cell))
const takeNote = (c, cell, id) => H.evalSafe(() => c.page.evaluate(async ({ cell, id }) =>
  (await window.ioc.get('@diamondcoreprocessor.com/SwarmNotes').take(cell, [id])).length === 0, { cell, id }))
const notesAt = (c, segs) => H.evalSafe(() => c.page.evaluate(async (segs) =>
  (await window.ioc.get('@diamondcoreprocessor.com/NotesService').getNotesAtSegments(segs)).map(n => n.text), segs))
const leave = async (c) => { await word(c, '/leave'); await H.sleep(2000); try { await c.browser.close() } catch { /* gone */ } }

;(async () => {
  const hostPubkey = await (async () => {
    const { getPublicKey } = await import('nostr-tools/pure')
    return getPublicKey(Uint8Array.from(Buffer.from(HOST_SECRET, 'hex')))
  })()
  await startHostRelay(hostPubkey)
  const named = await (await fetch(`http://localhost:${PORT}/.well-known/nostr.json?name=_`)).json()
  H.check('the relay names its host as _', named?.names?._ === hostPubkey, JSON.stringify(named))

  // THE HOST organizes the game; a GUEST asks and answers.
  const host = await boot('Host', { 'hc:nostr:secret-key': HOST_SECRET })
  const guest = await boot('Ben')
  for (const c of [host, guest]) {
    await word(c, '/join')
    H.check(`${c.label ?? 'a participant'} joined`, (await H.waitFor(() => joined(c), j => j, 30000, 500)).ok)
  }
  await fakeJev(host)
  await word(host, `/start ${GAME}`)
  const started = await H.waitFor(async () => ({ segs: await segments(host), root: await childrenAt(host, []) }),
    v => JSON.stringify(v.segs) === JSON.stringify([GAME]) && has(v.root, GAME), 30000, 500)
  H.check('the host starts the game', started.ok, JSON.stringify(started.value))
  await H.addTile(host.page, 'storage'); await H.sleep(1500)
  await H.waitFor(() => childrenAt(host, [GAME]), v => has(v, 'storage'), 20000, 500)

  await H.waitFor(() => peerTiles(guest), v => has(v, GAME), 45000, 750)
  await H.waitFor(() => adopt(guest, GAME), ok => ok === true, 30000, 1000)
  await H.waitFor(() => childrenAt(guest, []), v => has(v, GAME), 30000, 500)
  await goTo(guest, [GAME]); await H.sleep(1500)
  await H.waitFor(() => peerTiles(guest), v => has(v, 'storage'), 45000, 750)
  await H.waitFor(() => adopt(guest, 'storage'), ok => ok === true, 30000, 1000)
  await H.waitFor(() => childrenAt(guest, [GAME]), v => has(v, 'storage'), 30000, 500)
  await goTo(guest, [GAME, 'storage']); await H.sleep(1500)
  await word(guest, `/question ${Q1}`)
  const asked = await H.waitFor(() => childrenAt(guest, [GAME, 'storage']), v => has(v, Q1), 30000, 500)
  H.check('the guest asks inside the category', asked.ok, JSON.stringify(asked.value))

  await goTo(host, [GAME, 'storage']); await H.sleep(1500)
  await H.waitFor(() => peerTiles(host), v => has(v, Q1), 45000, 750)
  const taken = await H.waitFor(async () => { await settleNow(host); return childrenAt(host, [GAME, 'storage']) }, v => has(v, Q1), 60000, 3000)
  H.check('the host takes the question', taken.ok, JSON.stringify(taken.value))

  await write(guest, slug(Q1), ANSWER)
  const arrives = await H.waitFor(() => roomRoots(host, slug(Q1)), v => (v ?? []).some(r => r.text === ANSWER), 60000, 1500)
  H.check("the guest's answer reaches the host", arrives.ok, JSON.stringify(arrives.value))
  const id = (arrives.value ?? []).find(r => r.text === ANSWER)?.id
  const took = id ? await takeNote(host, slug(Q1), id) : false
  const mine = await H.waitFor(() => notesAt(host, [GAME, 'storage', slug(Q1)]), v => v.includes(ANSWER), 30000, 500)
  H.check('the host takes the answer', took && mine.ok, JSON.stringify(mine.value))

  await goTo(host, [GAME]); await H.sleep(1500)
  await word(host, '/tally')
  const tallied = await H.waitFor(() => notesAt(host, [GAME, 'storage', slug(Q1)]), v => v.some(t => t.startsWith('Tally ·') && /1 take · Ben/.test(t)), 30000, 750)
  H.check('the host tallies the tree', tallied.ok, JSON.stringify(tallied.value))

  // THE HOST'S SHARES ARE THE ROOM'S TEMPLATE: one member per page it stood on.
  const pool = await H.evalSafe(() => host.page.evaluate(async () => await window.ioc.get('@diamondcoreprocessor.com/RoomPool').address()))
  await goTo(host, [GAME, 'storage']); await H.sleep(1500)   // the tally changed this page's word — let it be announced
  await goTo(host, [GAME]); await H.sleep(1500)
  await goTo(host, []); await H.sleep(1500)
  const listed = await H.waitFor(async () => {
    const res = await fetch(`http://localhost:${PORT}/${pool}/`)
    return res.ok ? (await res.text()).split('\n').filter(Boolean).length : 0
  }, n => n >= 3, 90000, 2000)
  H.check("the host's words for the game's pages are members of the room pool", listed.ok, `${listed.waitedMs}ms — ${listed.value} members`)
  await H.sleep(10000)   // the latest word per page settles into the pool

  await leave(host)
  await leave(guest)

  // A PARTICIPANT ARRIVES AFTER EVERYONE LEFT.
  const late = await boot('Cara')
  await word(late, '/join')
  H.check('a late participant joined', (await H.waitFor(() => joined(late), j => j, 30000, 500)).ok)
  const root = await H.waitFor(() => H.evalSafe(() => late.page.evaluate(async () => {
    await window.ioc.get('@diamondcoreprocessor.com/RoomPool').read()
    return (window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').peerTilesAtCurrentSig() ?? []).map(t => ({ name: t.name, template: !!t.template }))
  })), v => (v ?? []).some(t => slug(t.name) === slug(GAME) && t.template), 60000, 2000)
  H.check('the game tile is there as the template though everyone left', root.ok, JSON.stringify(root.value))
  await H.waitFor(() => adopt(late, GAME), ok => ok === true, 30000, 1000)
  await H.waitFor(() => childrenAt(late, []), v => has(v, GAME), 30000, 500)
  await goTo(late, [GAME]); await H.sleep(1500)
  const inside = await H.waitFor(() => peerTiles(late), v => (v ?? []).some(t => slug(t.name) === 'storage' && t.template), 60000, 2000)
  H.check('the category inside it is there as the template', inside.ok, JSON.stringify(inside.value))
  await H.waitFor(() => adopt(late, 'storage'), ok => ok === true, 30000, 1000)
  await H.waitFor(() => childrenAt(late, [GAME]), v => has(v, 'storage'), 30000, 500)
  await goTo(late, [GAME, 'storage']); await H.sleep(1500)
  const question = await H.waitFor(() => peerTiles(late), v => (v ?? []).some(t => slug(t.name) === slug(Q1) && t.template), 60000, 2000)
  H.check('the question inside the category is there as the template', question.ok, JSON.stringify(question.value))
  const reads = await H.waitFor(() => roomRoots(late, slug(Q1)), v => (v ?? []).some(r => r.text === ANSWER) && (v ?? []).some(r => r.text.startsWith('Tally ·')), 60000, 2000)
  H.check('its answer and its tally read from the host after everyone left', reads.ok, JSON.stringify((reads.value ?? []).map(r => r.text)))

  console.log('\n========== the host\'s copy ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) { try { await late.browser.close() } catch { /* gone */ } }
  relay.kill()
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); try { relay?.kill() } catch { /* gone */ } process.exit(1) })
