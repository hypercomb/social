// scripts/drive-swarm-room-memory.cjs
//
// THE ROOMS A DEVICE REMEMBERS (sharing/room-notice.ts), and the toasts that
// follow membership:
//
//   - a host who joins by `join` (no link) remembers the room too
//   - `room list` shows what this device remembers
//   - on the host's swarm door, the guest's "you're in the room" toast comes
//     down when the guest leaves
//   - a guest who rejoins by `join` (not by the notice's button) sees the
//     room's "a session is starting" toast come down, and stops listening for
//     the room it is in
//   - `room forget` refuses the room you are in (a reload would bring it back)
//   - moving to another room while joined (`use-live-relay`) remembers it
//   - `room forget <room>` stops remembering it, and stops listening for it
//
//   node scripts/drive-swarm-room-memory.cjs --url http://localhost:4257/ [--relay-port 7804]

const H = require('./drive-swarm-connectivity.cjs')

const PORT = Number((process.argv.find((a, i) => process.argv[i - 1] === '--relay-port')) || 7804)
const ROOM = `memory-${Date.now().toString(36)}`
const SECRET = 'secret-' + Math.random().toString(36).slice(2, 10)
const ROOM2 = `${ROOM}-two`
const SECRET2 = 'secret-' + Math.random().toString(36).slice(2, 10)
const DOOR = (() => { const u = new URL(H.URL_); u.hostname = `swarm.${u.hostname}`; return u })()
const NOTICE = 'A session is starting'
const ARRIVAL = 'Joined meeting place'

const word = (c, text) => H.evalSafe(() => c.page.evaluate((text) => {
  window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').emitEffect('command-line:remote-submit', { text }); return true
}, text))
const joined = (c) => H.evalSafe(() => c.page.evaluate(() => localStorage.getItem('hc:mesh-public') === 'true'))
const remembered = (c) => H.evalSafe(() => c.page.evaluate(() => JSON.parse(localStorage.getItem('hc:rooms') || '[]').map(r => r.room)))
const listening = (c) => H.evalSafe(() => c.page.evaluate(() => window.ioc?.get?.('@diamondcoreprocessor.com/RoomNoticeDrone')?.listening?.() ?? []))
/** Toasts on screen with this title (fading ones are on their way out). */
const shown = (c, title) => H.evalSafe(() => c.page.evaluate((title) =>
  (window.ioc?.get?.('@diamondcoreprocessor.com/ToastDrone')?.toasts ?? []).filter(t => t.title === title && !t.fading).length, title))
const toastText = (c) => H.evalSafe(() => c.page.evaluate(() => (document.querySelector('hc-toast')?.textContent ?? '').replace(/\s+/g, ' ')))
const clickSheetJoin = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const b = [...document.querySelectorAll('hc-confirm-dialog button')].find(b => (b.textContent || '').trim().toLowerCase() === 'join')
  b?.click(); return !!b
}))

;(async () => {
  const relay = await H.startScratchRelay(PORT, 'swarm')
  const la = H.launcherFor('chromium')

  // THE HOST joins by the word, on a plain page.
  const hostBrowser = await la.type.launch({ headless: !H.HEADED })
  const host = await H.newClient(hostBrowser, 'Host', { room: ROOM, secret: SECRET, relay, seed: { 'hc:swarm:sticky': '1', ...H.swarmSeed(relay) } })
  await host.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(host.page); await H.installIfNeeded(host.page, 'Host')
  if (!(await H.waitForReady(host.page))) throw new Error('host not ready')
  await H.settle(host.page)
  await word(host, '/join')
  H.check('the host joins by `join`', (await H.waitFor(() => joined(host), v => v, 30000, 500)).ok)
  const hostRooms = await H.waitFor(() => remembered(host), v => (v ?? []).includes(ROOM), 20000, 1000)
  H.check('…and this device remembers the room, though no link was used', hostRooms.ok, JSON.stringify(hostRooms.value))
  await word(host, 'room list')
  const listed = await H.waitFor(() => toastText(host), v => /Rooms this device remembers/.test(v ?? '') && (v ?? '').includes(ROOM), 10000, 500)
  H.check('`room list` shows it', listed.ok, (listed.value ?? '').slice(0, 120))

  // THE GUEST joins by the link on the host's swarm door, then leaves.
  const link = `${DOOR.origin}/#meet=${encodeURIComponent(ROOM)}/${encodeURIComponent(SECRET)}&relay=${encodeURIComponent(relay)}`
  const guestBrowser = await la.type.launch({ headless: !H.HEADED })
  const guest = await H.newClientNoZone(guestBrowser, 'Guest', relay)
  await guest.ctx.route('**/@vite/client*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const injectQuery = (url) => url; export const createHotContext = () => ({ accept() {}, dispose() {}, prune() {}, on() {}, send() {}, invalidate() {} }); export function updateStyle() {}; export function removeStyle() {}' }))
  await guest.page.goto(link, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(guest.page); await H.installIfNeeded(guest.page, 'Guest')
  await H.waitFor(() => H.evalSafe(() => guest.page.evaluate(() => !!document.querySelector('hc-confirm-dialog button'))), v => v, 60000, 1000)
  await clickSheetJoin(guest)
  H.check('the guest joins by the link on the swarm door', (await H.waitFor(() => joined(guest), v => v, 30000, 500)).ok)
  const arrived = await H.waitFor(() => shown(guest, ARRIVAL), v => v === 1, 20000, 500)
  H.check('…and is told they are in the room, until they answer', arrived.ok, String(arrived.value))
  await word(guest, '/leave')
  await H.waitFor(() => joined(guest), v => v === false, 30000, 500)
  const gone = await H.waitFor(() => shown(guest, ARRIVAL), v => v === 0, 15000, 500)
  const why = gone.ok ? '' : await H.evalSafe(() => guest.page.evaluate(() => JSON.stringify({
    toasts: (window.ioc?.get?.('@diamondcoreprocessor.com/ToastDrone')?.toasts ?? []).map(t => [t.title, t.key, t.fading]),
    zone: sessionStorage.getItem('hc:mesh-zone'), session: sessionStorage.getItem('hc:mesh-session'),
  })))
  H.check('leaving takes "you\'re in the room" down', gone.ok, String(gone.value) + (why ? ' ' + why : ''))

  // A SESSION STARTS; the guest rejoins by the word, not the toast's button.
  await H.waitFor(() => listening(guest), v => (v ?? []).length > 0, 20000, 1000)
  await H.sleep(1500)
  await word(host, 'room start')
  const told = await H.waitFor(() => shown(guest, NOTICE), v => v === 1, 30000, 1000)
  H.check('`room start` tells the guest', told.ok, String(told.value))
  await word(guest, '/join')
  const back = (await H.waitFor(() => joined(guest), v => v, 30000, 500)).ok
  const down = await H.waitFor(() => shown(guest, NOTICE), v => v === 0, 20000, 500)
  H.check('rejoining by `join` takes the notice down', back && down.ok, `joined=${back} notices=${down.value}`)
  const notHere = await H.waitFor(() => listening(guest), v => !(v ?? []).includes(ROOM), 15000, 500)
  H.check('…and does not listen for the room it is in', notHere.ok, JSON.stringify(notHere.value))

  // A SESSION THE GUEST WAS IN is never announced to it after it leaves.
  await word(host, 'room start')
  await H.sleep(3000)
  await word(guest, '/leave')
  await H.waitFor(() => joined(guest), v => v === false, 30000, 500)
  const listensAgain = await H.waitFor(() => listening(guest), v => (v ?? []).includes(ROOM), 15000, 500)
  await H.sleep(6000)
  const quiet = await shown(guest, NOTICE)
  H.check('leaving does not announce the session it was in', listensAgain.ok && quiet === 0, `listening=${listensAgain.ok} notices=${quiet}`)
  await word(guest, '/join')
  H.check('…and the guest rejoins', (await H.waitFor(() => joined(guest), v => v, 30000, 500)).ok)

  // NOT THE ROOM YOU ARE IN.
  await word(guest, `room forget ${ROOM}`)
  const refused = await H.waitFor(() => toastText(guest), v => /leave it first/.test(v ?? ''), 10000, 500)
  const kept = await remembered(guest)
  H.check('`room forget` refuses the room you are in', refused.ok && (kept ?? []).includes(ROOM), JSON.stringify(kept))

  // MOVING WHILE JOINED.
  await word(guest, `/use-live-relay ${ROOM2} ${SECRET2} ${relay}`)
  const moved = await H.waitFor(() => remembered(guest), v => (v ?? [])[0] === ROOM2 && (v ?? []).includes(ROOM), 20000, 1000)
  H.check('moving to another room while joined remembers it, first', moved.ok, JSON.stringify(moved.value))
  const listensOld = await H.waitFor(() => listening(guest), v => (v ?? []).includes(ROOM) && !(v ?? []).includes(ROOM2), 15000, 500)
  H.check('…and listens for the room it left, not the one it is in', listensOld.ok, JSON.stringify(listensOld.value))

  // FORGET.
  await word(guest, '/leave')
  await H.waitFor(() => joined(guest), v => v === false, 30000, 500)
  await word(guest, `room forget ${ROOM}`)
  const forgot = await H.waitFor(() => remembered(guest), v => !(v ?? []).includes(ROOM), 10000, 500)
  H.check('`room forget` — this device no longer remembers it', forgot.ok, JSON.stringify(forgot.value))
  const deaf = await H.waitFor(() => listening(guest), v => !(v ?? []).includes(ROOM), 10000, 500)
  H.check('…and no longer listens for it', deaf.ok, JSON.stringify(deaf.value))
  await word(guest, 'room forget no-such-room')
  const missing = await H.waitFor(() => toastText(guest), v => /does not remember/.test(v ?? ''), 10000, 500)
  H.check('forgetting a room it never knew says so', missing.ok)

  console.log('\n========== room memory ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  for (const b of [hostBrowser, guestBrowser]) { try { await b.close() } catch { /* gone */ } }
  H.stopScratchRelay()
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); H.stopScratchRelay(); process.exit(1) })
