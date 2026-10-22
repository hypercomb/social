// scripts/drive-swarm-room-step-six.cjs
//
// STEP SIX (documentation/swarm-pools.md): what a room ASKS of whoever joins,
// and TAKE HOME. A host's room tile asks for `notes` and `keep-alive`; a guest
// arrives on the swarm door (swarm.localhost stands in for swarm.<host>):
//
//   - arriving says what the room asks, with one button per asked behaviour —
//     and turns nothing on by itself
//   - the keep-alive button runs the word, as typing it would
//   - the guest writes on the room's tile, names their own hive once
//     (`room home <address>`) and says `room home`
//   - the closure goes to the room's host and a sticky toast offers
//     "Open my hive"; it opens their hive at `#take=…`, which reads the
//     bundle from the host and offers the tile, its head on the host
//
//   node scripts/drive-swarm-room-step-six.cjs --url http://localhost:4251/ --relay ws://localhost:7791

const H = require('./drive-swarm-connectivity.cjs')

const ROOM = `six-${Date.now().toString(36)}`
const SECRET = 'secret-' + Math.random().toString(36).slice(2, 10)
const TILE = 'lecture'
const HOST_NOTE = 'Today: energy in the cell'
const GUEST_NOTE = 'my question: where does glycolysis happen?'
const DOOR = (() => { const u = new URL(H.URL_); u.hostname = `swarm.${u.hostname}`; return u })()
const HOME = new URL(H.URL_).origin
const VITE_STUB = 'export const injectQuery = (url) => url; export const createHotContext = () => ({ accept() {}, dispose() {}, prune() {}, on() {}, send() {}, invalidate() {} }); export function updateStyle() {}; export function removeStyle() {}'

const word = (c, text) => H.evalSafe(() => c.page.evaluate((text) => {
  window.__hypercombEffectBus.emit('command-line:remote-submit', { text }); return true
}, text))
const buttons = (page) => H.evalSafe(() => page.evaluate(() =>
  [...document.querySelectorAll('button')].map(b => (b.textContent || '').trim().toLowerCase()).filter(Boolean)))
const press = (page, label) => H.evalSafe(() => page.evaluate((label) => {
  const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim().toLowerCase() === label)
  b?.click(); return !!b
}, label))

;(async () => {
  const la = H.launcherFor('chromium')

  // THE HOST: a room tile with a note, asking for notes and keep-alive.
  const hostBrowser = await la.type.launch({ headless: !H.HEADED })
  const host = await H.newClient(hostBrowser, 'Host', { room: ROOM, secret: SECRET, relay: H.RELAY, seed: { 'hc:swarm:sticky': '1', ...H.swarmSeed(H.RELAY) } })
  await host.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(host.page); await H.installIfNeeded(host.page, 'Host')
  if (!(await H.waitForReady(host.page))) throw new Error('host not ready')
  await H.settle(host.page)
  await word(host, 'join')
  H.check('the host is in the room', (await H.waitFor(() => H.evalSafe(() => host.page.evaluate(() => localStorage.getItem('hc:mesh-public') === 'true')), v => v, 30000, 500)).ok)
  await H.addTile(host.page, TILE)
  await H.sleep(2500)
  await H.evalSafe(() => host.page.evaluate(({ tile, note }) => {
    window.__hypercombEffectBus.emit('note:commit', { cellLabel: tile, text: note, mark: null }); return true
  }, { tile: TILE, note: HOST_NOTE }))
  await H.sleep(2000)
  await H.evalSafe(() => host.page.evaluate((tile) => { window.ioc.get('@diamondcoreprocessor.com/SelectionService').add(tile); return true }, TILE))
  await word(host, 'room asks notes keep-alive')
  const asked = await H.waitFor(() => H.evalSafe(() => host.page.evaluate(async (tile) => {
    const h = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
    const layer = await h.currentLayerAt(await h.sign({ explorerSegments: () => [tile] }))
    return layer?.asks ?? null
  }, TILE)), v => Array.isArray(v) && v.join() === 'notes,keep-alive', 20000, 800)
  H.check('`room asks` puts the asks on the room tile', asked.ok, JSON.stringify(asked.value))
  await H.sleep(5000)

  // THE GUEST arrives on the door by the link.
  const link = `${DOOR.origin}/#meet=${encodeURIComponent(ROOM)}/${encodeURIComponent(SECRET)}&relay=${encodeURIComponent(H.RELAY)}`
  const guestBrowser = await la.type.launch({ headless: !H.HEADED })
  const guest = await H.newClientNoZone(guestBrowser, 'Guest', H.RELAY)
  await guest.ctx.route('**/@vite/client*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: VITE_STUB }))
  await guest.page.goto(link, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(guest.page); await H.installIfNeeded(guest.page, 'Guest')
  await H.waitFor(() => buttons(guest.page), v => (v ?? []).includes('join'), 60000, 1000)
  await press(guest.page, 'join')
  H.check('the guest joins on the door', (await H.waitFor(() => H.evalSafe(() => guest.page.evaluate(() => localStorage.getItem('hc:mesh-public') === 'true')), v => v, 30000, 500)).ok)

  const offered = await H.waitFor(() => buttons(guest.page), v => (v ?? []).includes('turn on keep-alive'), 60000, 1500)
  H.check('arriving says what the room asks, a button per behaviour', offered.ok, JSON.stringify((offered.value ?? []).filter(b => /turn on|open the notes/.test(b))))
  if (!offered.ok) {
    console.log('DIAG', JSON.stringify(await H.evalSafe(() => guest.page.evaluate(async () => {
      const sw = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
      const h = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
      const tiles = sw.peerTilesAtCurrentSig?.() ?? []
      const out = []
      for (const t of tiles) out.push({ name: t.name, template: !!t.template, sig: String(t.layerSig ?? '').slice(0, 10), asks: (await (async () => { const sig = String(t.layerSig ?? ''); let l = await h.getLayerBySig(sig).catch(() => null); if (!l) { await window.ioc.get('@diamondcoreprocessor.com/ContentBrokerDrone')?.fetchBySig?.(sig, 'layer', 8000).catch(() => null); l = await h.getLayerBySig(sig).catch(() => null) } return l })())?.asks ?? null })
      return { drone: !!window.ioc.get('@diamondcoreprocessor.com/RoomAsksDrone'), joined: localStorage.getItem('hc:mesh-public'), zone: window.__hypercombEffectBus.lastValue?.has?.('swarm:zone-complete'), tiles: out }
    }))))
  }
  const keptBefore = await H.evalSafe(() => guest.page.evaluate(() => window.__hypercombEffectBus.lastValue?.get('swarm:keep-alive')?.on === true))
  H.check('…and turns nothing on by itself', keptBefore === false, String(keptBefore))
  await press(guest.page, 'turn on keep-alive')
  const kept = await H.waitFor(() => H.evalSafe(() => guest.page.evaluate(() => window.__hypercombEffectBus.lastValue?.get('swarm:keep-alive')?.on === true)), v => v, 15000, 500)
  H.check('the button runs the word: keep-alive is on', kept.ok)

  // The guest writes on the room's tile, names home, and takes it home.
  await H.evalSafe(() => guest.page.evaluate(({ tile, note }) => {
    window.__hypercombEffectBus.emit('note:commit', { cellLabel: tile, text: note, mark: null }); return true
  }, { tile: TILE, note: GUEST_NOTE }))
  await H.sleep(6000)
  await word(guest, `room home ${HOME}`)
  await H.sleep(800)
  const homeSet = await H.evalSafe(() => guest.page.evaluate(() => localStorage.getItem('hc:my-hive')))
  H.check('`room home <address>` remembers the home', homeSet === HOME, homeSet)
  await H.evalSafe(() => guest.page.evaluate((tile) => { window.ioc.get('@diamondcoreprocessor.com/SelectionService').add(tile); return true }, TILE))
  await word(guest, 'room home')
  const ready = await H.waitFor(() => buttons(guest.page), v => (v ?? []).includes('open my hive'), 60000, 1500)
  H.check('`room home` puts it on the room\'s host and offers "Open my hive"', ready.ok)

  const [home] = await Promise.all([
    guest.ctx.waitForEvent('page', { timeout: 30000 }),
    press(guest.page, 'open my hive'),
  ])
  H.check('the button opens the home hive with the take link', /#take=|^http:\/\/localhost/.test(home.url()), home.url().slice(0, 90))
  await home.waitForLoadState('domcontentloaded')
  const offer = await H.waitFor(() => H.evalSafe(() => home.evaluate(() => window.__hypercombEffectBus?.lastValue?.get('community:offer') ?? null)), v => v?.name === TILE, 90000, 2000)
  H.check('home reads the bundle and is offered the tile', offer.ok, JSON.stringify(offer.value && { name: offer.value.name, head: String(offer.value.head).slice(0, 12), hosts: offer.value.hosts }))
  const reach = await H.evalSafe(() => home.evaluate(async (head) => {
    const scheme = 'http'
    const offerHosts = window.__hypercombEffectBus.lastValue.get('community:offer').hosts
    const res = await fetch(`${scheme}://${offerHosts[0]}/${head}`)
    if (!res.ok) return { ok: false, status: res.status }
    const layer = JSON.parse(await res.text())
    return { ok: true, name: layer.name, notes: (layer.notes ?? []).length }
  }, offer.value?.head))
  H.check('the tile\'s head is on the room\'s host, with its notes', reach?.ok && reach.name === TILE && reach.notes >= 1, JSON.stringify(reach))

  console.log('\n========== step six ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  for (const b of [hostBrowser, guestBrowser]) { try { await b.close() } catch { /* gone */ } }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
