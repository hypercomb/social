// scripts/drive-swarm-adopt-all-held.cjs
//
// THE ADOPT-ALL DOOR STAYS ON A TILE YOU HOLD WHILE ANYTHING UNDER IT IS
// STILL UNTAKEN — AT ANY DEPTH. A publishes orchard → apple → seed, and
// orchard → pear. B takes only the tile orchard (the one-level take): the door
// must show on B's held orchard. B then takes apple and pear one level in:
// every CHILD is held now, but seed is not, so the door must STAY. B presses
// it, confirms, and the whole branch lands — seed included — and the door goes
// out.
//
//   node scripts/drive-swarm-adopt-all-held.cjs --relay ws://localhost:7777

const H = require('./drive-swarm-connectivity.cjs')

const zone = { room: `held-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: { 'hc:swarm:sticky': '1' } }

async function boot(label) {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const c = await H.newClient(browser, label, zone); c.browser = browser
  await c.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(c.page); await H.installIfNeeded(c.page, label)
  if (!(await H.waitForReady(c.page))) throw new Error(`${label}: not ready`)
  await H.settle(c.page)
  await H.joinSwarm(c.page)
  await H.waitFor(() => H.meshState(c.page), s => (s.sockets ?? []).some(x => x.readyState === 1), 30000)
  await H.waitFor(() => H.swarmState(c.page), s => !!s.currentSig, 15000)
  return c
}

/** The one-level take — the item only, never its children. */
const takeOne = (c, label) => H.evalSafe(() => c.page.evaluate((label) => {
  window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
    .emitEffect('tile:action', { action: 'adopt', label, q: 0, r: 0, index: 0 })
  return true
}, label))

/** Is the adopt-all door among the icons the overlay would give this tile? */
const doorOn = (c, label) => H.evalSafe(() => c.page.evaluate((label) => {
  const overlay = window.ioc.get('@diamondcoreprocessor.com/TileOverlayDrone')
  return (overlay?.actionsForTile?.(label) ?? []).map(d => d.name).includes('adopt-branch')
}, label))

const pressDoor = (c, label) => H.evalSafe(() => c.page.evaluate((label) => {
  window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
    .emitEffect('tile:action', { action: 'adopt-branch', label, q: 0, r: 0, index: 0 })
  return true
}, label))

/** The door asks through its own dialog (adopt-branch-picker.ts), not the
 *  shared confirm bus — answer it the way a participant does: its button. */
const confirmDialog = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const go = document.querySelector('.hc-bp-x.go')
  if (!go) return false
  go.click()
  return true
}))

const childrenAt = (c, segments) => H.evalSafe(() => c.page.evaluate(async (segs) => {
  const history = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
  const sig = await history.sign({ explorerSegments: () => segs })
  const layer = await history.currentLayerAt(sig)
  const names = []
  for (const cs of (Array.isArray(layer?.children) ? layer.children : [])) {
    try { const k = await history.getLayerBySig(cs); if (k?.name) names.push(k.name) } catch { /* cold */ }
  }
  return names.sort()
}, segments))

async function build(a, path, names) {
  await H.navTo(a.page, path)
  await H.settle(a.page, 1500)
  for (const n of names) {
    await H.addTile(a.page, n)
    await H.waitFor(() => H.ownChildren(a.page), o => (o.names ?? []).includes(n), 15000)
  }
}

;(async () => {
  const a = await boot('A'), b = await boot('B')

  await build(a, [], ['orchard'])
  await build(a, ['orchard'], ['apple', 'pear'])
  await build(a, ['orchard', 'apple'], ['seed'])
  await H.navTo(a.page, [])
  await H.settle(a.page, 1500)

  const seen = await H.waitFor(() => H.peerTilesNow(b.page), t => t.includes('orchard'), 30000)
  H.check("B sees A's orchard", seen.ok, `${seen.waitedMs}ms`)

  // ── the parent alone ──
  await takeOne(b, 'orchard')
  const held = await H.waitFor(() => H.ownChildren(b.page), o => (o.names ?? []).includes('orchard'), 30000)
  H.check('B holds orchard (the tile only)', held.ok, `${held.waitedMs}ms`)
  const onParent = await H.waitFor(() => doorOn(b, 'orchard'), v => v === true, 45000, 1000)
  H.check('the adopt-all door shows on the held parent', onParent.ok, `${onParent.waitedMs}ms`)

  // ── every child held, the grandchild not ──
  await H.navTo(b.page, ['orchard'])
  await H.settle(b.page, 1500)
  const kidsSeen = await H.waitFor(() => H.peerTilesNow(b.page), t => t.includes('apple') && t.includes('pear'), 30000)
  H.check("B sees A's apple and pear inside orchard", kidsSeen.ok, JSON.stringify(kidsSeen.value))
  await takeOne(b, 'apple')
  await H.waitFor(() => H.ownChildren(b.page), o => (o.names ?? []).includes('apple'), 30000)
  await takeOne(b, 'pear')
  const kids = await H.waitFor(() => H.ownChildren(b.page), o => ['apple', 'pear'].every(n => (o.names ?? []).includes(n)), 30000)
  H.check('B holds every child of orchard', kids.ok, JSON.stringify(kids.value?.names))
  const seedHere = await childrenAt(b, ['orchard', 'apple'])
  H.check("B does not hold apple's seed yet", !(seedHere ?? []).includes('seed'), JSON.stringify(seedHere))
  await H.navTo(b.page, [])
  await H.settle(b.page, 1500)
  // Let the scan re-judge at the root with every child held.
  await H.sleep(12000)
  const stays = await H.waitFor(() => doorOn(b, 'orchard'), v => v === true, 45000, 1000)
  H.check('the door STAYS on orchard while a grandchild is untaken', stays.ok, `${stays.waitedMs}ms`)

  // ── the door takes the rest ──
  await pressDoor(b, 'orchard')
  const asked = await H.waitFor(() => confirmDialog(b), v => v === true, 20000, 250)
  H.check('pressing it asks first', asked.ok, `${asked.waitedMs}ms`)
  const seed = await H.waitFor(() => childrenAt(b, ['orchard', 'apple']), n => (n ?? []).includes('seed'), 45000, 1000)
  H.check('pressing it lands the grandchild', seed.ok, JSON.stringify(seed.value))
  const out = await H.waitFor(() => doorOn(b, 'orchard'), v => v === false, 45000, 1000)
  H.check('the door goes out once nothing is left to take', out.ok, `${out.waitedMs}ms`)

  console.log('\n========== adopt-all on a held tile ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
