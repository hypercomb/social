// scripts/drive-swarm-session-start.cjs
//
// THE SESSION START NOTICE (sharing/room-notice.ts). A guest who has been in
// a room is told when its host starts a session, even after leaving it:
//
//   - joining by the host's link remembers the room on the guest's device
//   - the guest leaves; the room is still heard
//   - the host says `room start`; the guest gets a toast with a Join button,
//     the host gets none of its own
//   - Join asks as the link did, and joins on yes
//
//   node scripts/drive-swarm-session-start.cjs --url http://localhost:4251/ --relay ws://localhost:7791

const H = require('./drive-swarm-connectivity.cjs')

const ROOM = `start-${Date.now().toString(36)}`
const SECRET = 'secret-' + Math.random().toString(36).slice(2, 10)

const word = (c, text) => H.evalSafe(() => c.page.evaluate((text) => {
  window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').emitEffect('command-line:remote-submit', { text }); return true
}, text))
const joined = (c) => H.evalSafe(() => c.page.evaluate(() => localStorage.getItem('hc:mesh-public') === 'true'))
const button = (c, label) => H.evalSafe(() => c.page.evaluate((label) =>
  [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim().toLowerCase() === label), label))
const click = (c, label) => H.evalSafe(() => c.page.evaluate((label) => {
  const all = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim().toLowerCase() === label)
  all[all.length - 1]?.click(); return all.length
}, label))
const noticeShown = (c) => H.evalSafe(() => c.page.evaluate(() => /a session is starting/i.test(document.body.innerText || '')))

;(async () => {
  const la = H.launcherFor('chromium')

  const hostBrowser = await la.type.launch({ headless: !H.HEADED })
  const host = await H.newClient(hostBrowser, 'Host', { room: ROOM, secret: SECRET, relay: H.RELAY, seed: { 'hc:swarm:sticky': '1', ...H.swarmSeed(H.RELAY) } })
  await host.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(host.page); await H.installIfNeeded(host.page, 'Host')
  if (!(await H.waitForReady(host.page))) throw new Error('host not ready')
  await H.settle(host.page)
  await word(host, '/join')
  H.check('the host is in the room', (await H.waitFor(() => joined(host), v => v, 30000, 500)).ok)

  // The guest joins by the host's link.
  const link = `${new URL(H.URL_).origin}/#meet=${encodeURIComponent(ROOM)}/${encodeURIComponent(SECRET)}&relay=${encodeURIComponent(H.RELAY)}`
  const guestBrowser = await la.type.launch({ headless: !H.HEADED })
  const guest = await H.newClientNoZone(guestBrowser, 'Guest', H.RELAY)
  await guest.page.goto(link, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(guest.page); await H.installIfNeeded(guest.page, 'Guest')
  H.check('the link asks before joining', (await H.waitFor(() => button(guest, 'join'), v => v, 60000, 1000)).ok)
  await click(guest, 'join')
  H.check('…and joins on yes', (await H.waitFor(() => joined(guest), v => v, 30000, 500)).ok)

  const remembered = await H.evalSafe(() => guest.page.evaluate(() => JSON.parse(localStorage.getItem('hc:rooms') || '[]').map(r => r.room)))
  H.check('joining remembers the room on this device', (remembered ?? []).includes(ROOM), JSON.stringify(remembered))

  // The guest leaves; the room is still heard.
  await word(guest, '/leave')
  H.check('the guest leaves the room', (await H.waitFor(() => joined(guest), v => v === false, 30000, 500)).ok)
  const hears = await H.waitFor(() => H.evalSafe(() => guest.page.evaluate(() =>
    window.ioc.get('@diamondcoreprocessor.com/RoomNoticeDrone')?.listening?.() ?? [])), v => (v ?? []).length > 0, 30000, 1000)
  H.check('…and still hears it', hears.ok, JSON.stringify(hears.value))
  await H.sleep(2000)

  // The host starts the session.
  await word(host, 'room start')
  const told = await H.waitFor(() => noticeShown(guest), v => v, 30000, 1000)
  H.check('`room start` tells the guest, though they left', told.ok)
  H.check('…with a Join button', !!(await button(guest, 'join')))
  await H.sleep(1500)
  H.check('the host is not told of its own start', !(await noticeShown(host)))

  // Join asks, as the link did, and joins on yes.
  await click(guest, 'join')
  const sheet = await H.waitFor(() => H.evalSafe(() => guest.page.evaluate(() => /join the room/i.test(document.body.innerText || ''))), v => v, 15000, 500)
  H.check('Join asks before joining', sheet.ok)
  await H.evalSafe(() => guest.page.evaluate(() => {
    const b = [...document.querySelectorAll('hc-confirm-dialog button')].find(b => (b.textContent || '').trim().toLowerCase() === 'join')
    b?.click(); return !!b
  }))
  const back = await H.waitFor(() => joined(guest), v => v, 30000, 500)
  const state = back.ok ? '' : await H.evalSafe(() => guest.page.evaluate(() => JSON.stringify({ zone: sessionStorage.getItem('hc:mesh-zone'), pub: localStorage.getItem('hc:mesh-public'), text: document.body.innerText.slice(-400) })))
  H.check('…and the guest is back in the room', back.ok, state)

  console.log('\n========== session start ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  for (const b of [hostBrowser, guestBrowser]) { try { await b.close() } catch { /* gone */ } }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
