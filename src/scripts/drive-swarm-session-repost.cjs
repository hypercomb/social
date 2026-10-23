// scripts/drive-swarm-session-repost.cjs
//
// THE START NOTICE OUTLIVES ITS MEETING POINT (sharing/room-notice.ts). The
// meeting point keeps a notice in memory only, so while the host stays in the
// room its hive posts the notice again; and a meeting point closes a socket it
// hears nothing from, so every listener renews its listen. This proves:
//
//   - a re-post is the SAME signed event (same id — no listener of any
//     version takes it for a new start), and is never a second toast
//   - a listener renews its listen (live only) and its socket stays open
//   - a host who reloads mid-session resumes announcing the same session
//   - after the meeting point restarts (its memory wiped), the host's next
//     re-post puts the notice back, and a guest who opens their hive then is
//     told — once
//   - a host who leaves the room stops posting
//
// It runs its OWN scratch relay (so it can restart it) and speeds up only the
// two timers it waits on — the 5-minute re-post and the 45-second renewal —
// in its own pages.
//
//   node scripts/drive-swarm-session-repost.cjs --url http://localhost:4251/ [--relay-port 7803]

const H = require('./drive-swarm-connectivity.cjs')

const PORT = Number((process.argv.find((a, i) => process.argv[i - 1] === '--relay-port')) || 7803)
const ROOM = `repost-${Date.now().toString(36)}`
const SECRET = 'secret-' + Math.random().toString(36).slice(2, 10)
const REPOST_MS = 15_000
const RENEW_MS = 8_000
const TITLE = 'A session is starting'

/** Only the notice's two timers run fast; every other interval is untouched. */
const fastTimers = ({ repost, renew }) => {
  const real = window.setInterval.bind(window)
  window.setInterval = (fn, ms, ...rest) => real(fn, ms === 300_000 ? repost : ms === 45_000 ? renew : ms, ...rest)
}

const word = (c, text) => H.evalSafe(() => c.page.evaluate((text) => {
  window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').emitEffect('command-line:remote-submit', { text }); return true
}, text))
const joined = (c) => H.evalSafe(() => c.page.evaluate(() => localStorage.getItem('hc:mesh-public') === 'true'))
const button = (c, label) => H.evalSafe(() => c.page.evaluate((label) =>
  [...document.querySelectorAll('button')].some(b => (b.textContent || '').trim().toLowerCase() === label), label))
const clickSheetJoin = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const b = [...document.querySelectorAll('hc-confirm-dialog button')].find(b => (b.textContent || '').trim().toLowerCase() === 'join')
  b?.click(); return !!b
}))
/** The notice toasts this page holds, and whether one is on screen. */
const notices = (c) => H.evalSafe(() => c.page.evaluate((title) => ({
  held: (window.ioc?.get?.('@diamondcoreprocessor.com/ToastDrone')?.toasts ?? []).filter(t => t.title === title).length,
  shown: (document.querySelector('hc-toast')?.textContent ?? '').split(title).length - 1,
}), TITLE))

/** Every frame this page's notice sockets send, kept on the client object. */
function tapNoticeSockets(c) {
  c.frames = []
  c.page.on('websocket', ws => {
    ws.on('framesent', f => {
      const text = String(f.payload ?? '')
      if (text.includes('"REQ"') && text.includes('"notice-')) c.frames.push({ at: Date.now(), text })
    })
  })
}

/** Every notice the host's own sockets send (EVENT kind 30569), by id. */
function tapNoticePosts(c) {
  c.posts = []
  c.page.on('websocket', ws => {
    ws.on('framesent', f => {
      let msg
      try { msg = JSON.parse(String(f.payload ?? '')) } catch { return }
      if (Array.isArray(msg) && msg[0] === 'EVENT' && msg[1]?.kind === 30569) c.posts.push({ at: Date.now(), id: msg[1].id })
    })
  })
}

/** What the meeting point holds at the notice address: the newest post. */
function probe(relay, address) {
  return new Promise(resolve => {
    let newest = null
    const ws = new WebSocket(relay)
    const done = (v) => { try { ws.close() } catch { /* gone */ } resolve(v) }
    const timer = setTimeout(() => done(newest), 8000)
    ws.onopen = () => ws.send(JSON.stringify(['REQ', 'probe', { kinds: [30569], '#x': [address] }]))
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data))
      if (msg[0] === 'EVENT' && (!newest || msg[2].created_at > newest.created_at)) newest = msg[2]
      if (msg[0] === 'EOSE') { clearTimeout(timer); done(newest) }
    }
    ws.onerror = () => { clearTimeout(timer); done(null) }
  })
}

async function boot(c, label) {
  await H.waitForShell(c.page); await H.installIfNeeded(c.page, label)
  if (!(await H.waitForReady(c.page))) throw new Error(`${label}: not ready`)
  await H.settle(c.page)
}

;(async () => {
  const relay = await H.startScratchRelay(PORT, 'swarm')
  const la = H.launcherFor('chromium')
  const speed = { repost: REPOST_MS, renew: RENEW_MS }

  // THE HOST, in the room.
  const hostBrowser = await la.type.launch({ headless: !H.HEADED })
  const host = await H.newClient(hostBrowser, 'Host', { room: ROOM, secret: SECRET, relay, seed: { 'hc:swarm:sticky': '1', ...H.swarmSeed(relay) } })
  await host.ctx.addInitScript(fastTimers, speed)
  tapNoticePosts(host)
  await host.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await boot(host, 'Host')
  await word(host, '/join')
  H.check('the host is in the room', (await H.waitFor(() => joined(host), v => v, 30000, 500)).ok)

  // TWO GUESTS join by the link and leave: A keeps its page open, B closes it.
  const link = `${new URL(H.URL_).origin}/#meet=${encodeURIComponent(ROOM)}/${encodeURIComponent(SECRET)}&relay=${encodeURIComponent(relay)}`
  const guestBrowser = await la.type.launch({ headless: !H.HEADED })
  const guests = {}
  for (const label of ['A', 'B']) {
    const g = await H.newClientNoZone(guestBrowser, label, relay)
    await g.ctx.addInitScript(fastTimers, speed)
    tapNoticeSockets(g)
    await g.page.goto(link, { waitUntil: 'domcontentloaded' })
    await H.waitForShell(g.page); await H.installIfNeeded(g.page, label)
    await H.waitFor(() => button(g, 'join'), v => v, 60000, 1000)
    await clickSheetJoin(g)
    const inRoom = (await H.waitFor(() => joined(g), v => v, 30000, 500)).ok
    await word(g, '/leave')
    const left = (await H.waitFor(() => joined(g), v => v === false, 30000, 500)).ok
    H.check(`guest ${label} joined by the link, then left`, inRoom && left)
    guests[label] = g
  }
  const { A, B } = guests
  const addressSeen = await H.waitFor(async () => A.frames.map(f => JSON.parse(f.text)[2]?.['#x']?.[0]).find(Boolean), v => !!v, 30000, 1000)
  const address = addressSeen.value
  H.check('guest A listens at the notice address', !!address, address?.slice(0, 12))
  await B.page.close()

  // THE START.
  await word(host, 'room start')
  const announcing = await H.waitFor(() => H.evalSafe(() => host.page.evaluate(() =>
    window.ioc.get('@diamondcoreprocessor.com/RoomNoticeDrone')?.announcing?.())), v => !!v, 20000, 500)
  H.check('`room start` — the host is announcing', announcing.ok, JSON.stringify(announcing.value))
  const first = await H.waitFor(() => probe(relay, address), v => !!v, 20000, 1000)
  H.check('the meeting point holds the notice', !!first.value)
  const toldA = await H.waitFor(() => notices(A), v => v?.shown === 1, 30000, 1000)
  H.check('guest A is told, on screen', toldA.ok, JSON.stringify(toldA.value))

  // RE-POSTS, and the renewals beside them.
  const renewFrom = Date.now()
  await H.sleep(REPOST_MS * 2 + 5000)
  const sent = host.posts.filter(p => p.id === first.value.id).length
  H.check('the host posted it again', sent >= 3, `${sent} posts of ${first.value.id.slice(0, 8)}`)
  H.check('…the same signed event every time', host.posts.every(p => p.id === first.value.id), JSON.stringify([...new Set(host.posts.map(p => p.id.slice(0, 8)))]))
  const afterReposts = await notices(A)
  H.check('…and guest A is not told twice', afterReposts?.held === 1 && afterReposts?.shown === 1, JSON.stringify(afterReposts))
  const renewals = A.frames.filter(f => f.at >= renewFrom && f.text.includes('"limit":0'))
  H.check('guest A renews its listen, live only', renewals.length >= 2, `${renewals.length} renewals`)

  // THE HOST RELOADS mid-session: still in the room, still announcing.
  const before = announcing.value
  await host.page.reload({ waitUntil: 'domcontentloaded' })
  await boot(host, 'Host')
  const resumed = await H.waitFor(() => H.evalSafe(() => host.page.evaluate(() =>
    window.ioc.get('@diamondcoreprocessor.com/RoomNoticeDrone')?.announcing?.() ?? null)), v => !!v, 30000, 1000)
  H.check('a host who reloads is still announcing — the same session', resumed.ok && resumed.value.startedSec === before.startedSec && resumed.value.address === before.address,
    JSON.stringify({ before, after: resumed.value }))
  const postsAtReload = host.posts.length
  await H.sleep(REPOST_MS + 5000)
  const afterReload = host.posts.slice(postsAtReload)
  H.check('…and keeps posting the same event', afterReload.length >= 1 && afterReload.every(p => p.id === first.value.id), `${afterReload.length} posts after the reload`)

  // THE MEETING POINT RESTARTS — its memory is gone.
  H.stopScratchRelay()
  await H.startScratchRelay(PORT, 'swarm')
  const wiped = await probe(relay, address)
  H.check('after a restart the meeting point holds nothing', !wiped, wiped ? `still ${wiped.id?.slice(0, 8)}` : '')
  const back = await H.waitFor(() => probe(relay, address), v => !!v, 90000, 3000)
  H.check('the host\'s next re-post puts the notice back — the same event', back.ok && back.value.id === first.value.id, back.value ? back.value.id.slice(0, 8) : '')

  // B opens their hive now: told once. A heard the re-post too: still once.
  const b2 = await B.ctx.newPage()
  B.page = b2
  await b2.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(b2)
  const toldB = await H.waitFor(() => notices(B), v => v?.shown === 1, 60000, 1000)
  const bState = toldB.ok ? '' : await H.evalSafe(() => b2.evaluate(() => JSON.stringify({
    ioc: !!window.ioc, drone: !!window.ioc?.get?.('@diamondcoreprocessor.com/RoomNoticeDrone'),
    listening: window.ioc?.get?.('@diamondcoreprocessor.com/RoomNoticeDrone')?.listening?.(),
    rooms: (JSON.parse(localStorage.getItem('hc:rooms') || '[]')).map(r => r.room + '@' + r.relay),
    seen: sessionStorage.getItem('hc:room-notice-seen'), url: location.href,
  })))
  H.check('guest B, opening their hive after the restart, is told', toldB.ok, JSON.stringify(toldB.value) + (bState ? ' ' + bState : ''))
  await H.sleep(REPOST_MS + 3000)
  const stillOnce = await notices(A)
  H.check('guest A, who heard the restart\'s re-post, is still told once', stillOnce?.held === 1, JSON.stringify(stillOnce))

  // THE HOST LEAVES: no more posts.
  await word(host, '/leave')
  await H.waitFor(() => joined(host), v => v === false, 30000, 500)
  const stopped = await H.waitFor(() => H.evalSafe(() => host.page.evaluate(() =>
    window.ioc.get('@diamondcoreprocessor.com/RoomNoticeDrone')?.announcing?.() ?? null)), v => v === null, REPOST_MS * 2 + 5000, 1000)
  H.check('a host who leaves stops announcing', stopped.ok)
  const postsAtStop = host.posts.length
  await H.sleep(REPOST_MS * 2)
  H.check('…and posts nothing more', host.posts.length === postsAtStop, `${postsAtStop} → ${host.posts.length}`)

  console.log('\n========== session start: re-post ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  for (const b of [hostBrowser, guestBrowser]) { try { await b.close() } catch { /* gone */ } }
  H.stopScratchRelay()
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); H.stopScratchRelay(); process.exit(1) })
