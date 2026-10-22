// scripts/drive-swarm-arrive.cjs
//
// ARRIVE = JOIN, AT THE ROOM'S DOOR (documentation/swarm-pools.md). The host
// is in a room with a note on its tile; a guest who has never been here opens
// the host's meeting link on the host's swarm door — `swarm.localhost` stands
// in for `swarm.<host>`: the same door rule (core swarmDoorOf), the same
// shell. Then:
//
//   - the link asks before joining, and joins on yes
//   - arriving opens NO window by itself (a window opens only from its own
//     door) — a toast says where everyone's notes are, and carries the door
//   - the toast's button opens the notes desk ON THE ROOM'S TILE, though the
//     guest holds no tile of their own yet, with the host's note in it
//   - the guest's first line there goes to the room
//
//   node scripts/drive-swarm-arrive.cjs --url http://localhost:4251/ --relay ws://localhost:7791

const H = require('./drive-swarm-connectivity.cjs')

const ROOM = `arrive-${Date.now().toString(36)}`
const SECRET = 'secret-' + Math.random().toString(36).slice(2, 10)
const TILE = 'lecture'
const HOST_NOTE = 'Today: energy in the cell'
const GUEST_NOTE = 'question: where does glycolysis happen?'
const DOOR = (() => { const u = new URL(H.URL_); u.hostname = `swarm.${u.hostname}`; return u })()

const word = (c, text) => H.evalSafe(() => c.page.evaluate((text) => {
  window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').emitEffect('command-line:remote-submit', { text }); return true
}, text))

;(async () => {
  const la = H.launcherFor('chromium')

  // THE HOST, in the room, with a note on its tile.
  const hostBrowser = await la.type.launch({ headless: !H.HEADED })
  const host = await H.newClient(hostBrowser, 'Host', { room: ROOM, secret: SECRET, relay: H.RELAY, seed: { 'hc:swarm:sticky': '1', ...H.swarmSeed(H.RELAY) } })
  await host.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(host.page); await H.installIfNeeded(host.page, 'Host')
  if (!(await H.waitForReady(host.page))) throw new Error('host not ready')
  await H.settle(host.page)
  await word(host, '/join')
  H.check('the host is in the room', (await H.waitFor(() => H.evalSafe(() => host.page.evaluate(() => localStorage.getItem('hc:mesh-public') === 'true')), v => v, 30000, 500)).ok)
  await H.addTile(host.page, TILE)
  await H.sleep(2500)
  await H.evalSafe(() => host.page.evaluate(({ tile, note }) => {
    window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').setMyLabel('Ana')
    window.__hypercombEffectBus.emit('note:commit', { cellLabel: tile, text: note, mark: null }); return true
  }, { tile: TILE, note: HOST_NOTE }))
  await H.sleep(4000)

  // THE LINK, as the host's `invite` hands it out: room, secret, the page
  // (the root), and the meeting point.
  const link = `${DOOR.origin}/#meet=${encodeURIComponent(ROOM)}/${encodeURIComponent(SECRET)}&relay=${encodeURIComponent(H.RELAY)}`

  // THE GUEST — never here before, nothing seeded but the relay list — opens
  // it on the swarm door.
  const guestBrowser = await la.type.launch({ headless: !H.HEADED })
  const guest = await H.newClientNoZone(guestBrowser, 'Guest', H.RELAY)
  await guest.ctx.route('**/@vite/client*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const injectQuery = (url) => url; export const createHotContext = () => ({ accept() {}, dispose() {}, prune() {}, on() {}, send() {}, invalidate() {} }); export function updateStyle() {}; export function removeStyle() {}' }))
  await guest.page.goto(link, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(guest.page); await H.installIfNeeded(guest.page, 'Guest')
  const onDoor = await H.evalSafe(() => guest.page.evaluate(() => location.hostname))
  H.check('the guest stands on the swarm door', /^swarm\./.test(onDoor ?? ''), onDoor)

  // The link asks before joining.
  const asked = await H.waitFor(() => H.evalSafe(() => guest.page.evaluate(() =>
    [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim().toLowerCase() === 'join'))), v => v, 60000, 1000)
  H.check('the link asks before joining', asked.ok)
  await H.evalSafe(() => guest.page.evaluate(() => {
    [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim().toLowerCase() === 'join')?.click(); return true
  }))
  const joined = await H.waitFor(() => H.evalSafe(() => guest.page.evaluate(() => localStorage.getItem('hc:mesh-public') === 'true')), v => v, 30000, 500)
  H.check('…and joins on yes', joined.ok)

  // Arriving opens nothing; the toast carries the door.
  const toast = await H.waitFor(() => H.evalSafe(() => guest.page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim().toLowerCase() === 'open the notes')
    return { button: !!btn, desk: !!document.querySelector('hc-notes-strip .notes-strip') }
  })), v => v?.button, 30000, 800)
  H.check('arriving says where the notes are, with a button', toast.ok, JSON.stringify(toast.value))
  H.check('…and opens no window by itself', toast.value && !toast.value.desk, JSON.stringify(toast.value))

  await H.evalSafe(() => guest.page.evaluate(() => {
    [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim().toLowerCase() === 'open the notes')?.click(); return true
  }))
  const desk = await H.waitFor(() => H.evalSafe(() => guest.page.evaluate(() => {
    const el = document.querySelector('hc-notes-strip')
    return {
      tile: el?.querySelector('.cv2-plate-name')?.textContent?.trim() ?? '',
      notes: [...(el?.querySelectorAll('.cv2-list .cv2-note .cv2-note-text') ?? [])].map(n => n.textContent.trim()),
    }
  })), v => v?.tile === TILE && v.notes.includes(HOST_NOTE), 60000, 1500)
  H.check('the button opens the desk on the room\'s tile, though the guest holds none', desk.value?.tile === TILE, JSON.stringify(desk.value))
  H.check('…with the host\'s note in it', !!desk.value?.notes?.includes(HOST_NOTE), JSON.stringify(desk.value?.notes))

  // The guest writes; the line reaches the host.
  await H.evalSafe(() => guest.page.evaluate(({ tile, note }) => {
    window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').setMyLabel('Ben')
    window.__hypercombEffectBus.emit('note:commit', { cellLabel: tile, text: note, mark: null }); return true
  }, { tile: TILE, note: GUEST_NOTE }))
  const back = await H.waitFor(() => H.evalSafe(() => host.page.evaluate(async ({ tile, note }) => {
    const sn = window.ioc.get('@diamondcoreprocessor.com/SwarmNotes')
    await sn.refresh(tile)
    return sn.rootsFor(tile).some(r => r.note.text === note)
  }, { tile: TILE, note: GUEST_NOTE })), v => v, 60000, 2000)
  H.check('the guest\'s first line reaches the host', back.ok)

  console.log('\n========== arrive = join ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  for (const b of [hostBrowser, guestBrowser]) { try { await b.close() } catch { /* gone */ } }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
