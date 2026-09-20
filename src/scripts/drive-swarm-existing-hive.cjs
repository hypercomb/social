// scripts/drive-swarm-existing-hive.cjs
//
// THE CASE THE OTHER HARNESSES NEVER TEST: a hive that already HAS tiles when
// it joins. Every swarm harness here builds its tiles after joining, and a
// tile made in-zone is auto-public — so they all prove a path a real hive
// never walks. Jaime's own hive is full of tiles made long before, and a
// second window in the SAME zone shows "first one here" with nothing on it.
//
// A: makes tiles FIRST, then joins.   B: joins and looks.
// Then A marks the branch public, and B looks again.
//
//   node scripts/drive-swarm-existing-hive.cjs --relay ws://localhost:7777

const H = require('./drive-swarm-connectivity.cjs')

const zone = { room: `existing-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: { 'hc:swarm:sticky': '1' } }

async function boot(label) {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const c = await H.newClient(browser, label, zone); c.browser = browser
  await c.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(c.page); await H.installIfNeeded(c.page, label)
  if (!(await H.waitForReady(c.page))) throw new Error(`${label}: not ready`)
  await H.settle(c.page)
  return c
}

const join = async (c) => {
  await H.joinSwarm(c.page)
  const open = await H.waitFor(() => H.meshState(c.page), s => (s.sockets ?? []).some(x => x.readyState === 1), 30000)
  const sig = await H.waitFor(() => H.swarmState(c.page), s => !!s.currentSig, 15000)
  return open.ok && sig.ok
}

/** What this client believes about the zone: its own sig, who it can see. */
const zoneView = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const swarm = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
  const d = swarm?.debug?.() ?? {}
  return {
    sig: d.currentSig ?? null,
    peers: (swarm?.participantsAtCurrentSig?.() ?? []).length,
    peerTiles: (swarm?.peerTilesAtCurrentSig?.() ?? []).map(t => t.name),
  }
}))

/** The public marks this hive carries — the flags that decide what is shared. */
const publicMarks = (c) => H.evalSafe(() => c.page.evaluate(() => ({
  tiles: Object.keys(localStorage).filter(k => k.startsWith('hc:public-tiles')),
  branches: localStorage.getItem('hc:public-branches'),
})))

const markBranchPublic = (c, label) => H.evalSafe(() => c.page.evaluate((label) => {
  const bee = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
  bee.emitEffect('tile:action', { action: 'make-branch-public', label, q: 0, r: 0, index: 0 })
  return true
}, label))

;(async () => {
  const a = await boot('A'), b = await boot('B')

  // A BUILDS ITS HIVE BEFORE JOINING — the ordinary case for anyone who has
  // been using Hypercomb for a while.
  for (const n of ['howard', 'dolphin', 'diagrams']) {
    await H.addTile(a.page, n)
    await H.waitFor(() => H.ownChildren(a.page), o => (o.names ?? []).includes(n), 15000)
  }
  const own = await H.ownChildren(a.page)
  H.check('A has a hive before it joins', (own.names ?? []).length >= 3, JSON.stringify(own.names))
  H.log('A marks', JSON.stringify(await publicMarks(a)))

  H.check('A joins', await join(a))
  H.check('B joins', await join(b))
  await H.sleep(4000)

  const av = await zoneView(a), bv = await zoneView(b)
  H.log('A view', JSON.stringify(av))
  H.log('B view', JSON.stringify(bv))
  H.check('both compose the same zone signature', !!av.sig && av.sig === bv.sig, `${String(av.sig).slice(0, 12)} vs ${String(bv.sig).slice(0, 12)}`)
  H.check('B can see A is here (presence)', (bv.peers ?? 0) >= 1, `${bv.peers} participant(s)`)

  const saw = await H.waitFor(() => H.peerTilesNow(b.page), t => t.length > 0, 20000, 500)
  H.check('B sees the tiles A already had', saw.ok, saw.ok ? JSON.stringify(saw.value) : 'NONE — an existing hive shares nothing')

  // The remedy the doctrine names: make the branch public at the tile.
  await markBranchPublic(a, 'howard')
  await H.sleep(1500)
  H.log('A marks after', JSON.stringify(await publicMarks(a)))
  const after = await H.waitFor(() => H.peerTilesNow(b.page), t => t.includes('howard'), 30000, 500)
  H.check('after marking it public, B sees it', after.ok, `${after.waitedMs}ms — ${JSON.stringify(after.value)}`)

  console.log('\n========== existing hive ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } }
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
