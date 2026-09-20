// scripts/drive-swarm-adopt-branch.cjs
//
// THE BRANCH DOOR ASKS, THEN TAKES EVERYTHING. A builds a tile with children
// under it and publishes; B presses the peer tile's adopt-branch door (the
// same `tile:action` the overlay icon emits). The door must resolve the
// branch, count the tiles under it, name the publisher, ASK through the
// confirm dialog — and, answered yes, fold the whole branch into B's hive so
// the children exist at B's path. Answered no, nothing lands.
//
//   node scripts/drive-swarm-adopt-branch.cjs --relay ws://localhost:7777

const H = require('./drive-swarm-connectivity.cjs')

const zone = { room: `branch-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: { 'hc:swarm:sticky': '1' } }

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

/** Arm a listener for the NEXT confirm:request and answer it. Returns what
 *  the dialog was asked to show, so the count and provenance can be judged. */
const armConfirm = (c, answer) => H.evalSafe(() => c.page.evaluate((answer) => {
  const bus = globalThis.__hypercombEffectBus
  window.__confirmSeen = null
  // The bus replays the LAST confirm request to a new listener — only a
  // request that arrives after arming counts.
  const armedAt = Date.now()
  let off = null
  off = bus.on('confirm:request', (req) => {
    if (!req?.id || window.__confirmSeen) return
    if (window.__confirmAnswered?.has?.(req.id)) return
    window.__confirmAnswered = window.__confirmAnswered ?? new Set()
    window.__confirmAnswered.add(req.id)
    window.__confirmSeen = { title: req.title, message: req.message, params: req.messageParams, warning: req.warning ?? null, danger: req.danger, armedAt }
    if (off) off()
    setTimeout(() => bus.emit('confirm:response', { id: req.id, confirmed: answer }), 50)
  })
  return true
}, answer))

const confirmSeen = (c) => H.evalSafe(() => c.page.evaluate(() => window.__confirmSeen ?? null))

const pressDoor = (c, label) => H.evalSafe(() => c.page.evaluate((label) => {
  const bee = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
  bee.emitEffect('tile:action', { action: 'adopt-branch', label, q: 0, r: 0, index: 0 })
  return true
}, label))

const doorArmed = (c) => H.evalSafe(() => c.page.evaluate(() => !!window.ioc.get('@diamondcoreprocessor.com/AdoptBranchDrone')))

;(async () => {
  const a = await boot('A'), b = await boot('B')
  H.check('the branch door is registered', await doorArmed(b))

  // A: a tile with three children, then back to root.
  await H.addTile(a.page, 'orchard')
  await H.waitFor(() => H.ownChildren(a.page), o => (o.names ?? []).includes('orchard'), 15000)
  await H.navTo(a.page, ['orchard'])
  await H.settle(a.page, 1500)
  for (const n of ['apple', 'pear', 'plum']) {
    await H.addTile(a.page, n)
    await H.waitFor(() => H.ownChildren(a.page), o => (o.names ?? []).includes(n), 15000)
  }
  await H.navTo(a.page, [])
  await H.settle(a.page, 1500)

  const seen = await H.waitFor(() => H.peerTilesNow(b.page), t => t.includes('orchard'), 30000)
  H.check('B sees A\'s branch root', seen.ok, `${seen.waitedMs}ms`)

  // ── diagnosis: can B resolve A's branch layer at all? ──
  const diag = await H.evalSafe(() => b.page.evaluate(async () => {
    const swarm = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
    const tile = (swarm?.peerTilesAtCurrentSig?.() ?? []).find(t => t.name === 'orchard')
    const layerSig = tile?.layerSig ?? null
    const broker = window.ioc.get('@diamondcoreprocessor.com/ContentBrokerDrone')
    const t0 = performance.now()
    const bytes = layerSig ? await broker.fetchBySig(layerSig, 'layer', 10000) : null
    const ms = Math.round(performance.now() - t0)
    let parsed = null
    try { parsed = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null } catch {}
    const stats = layerSig ? await broker.adopt(layerSig, { layersOnly: true, silent: true, quiet: true }) : null
    return { layerSig, fetched: bytes ? bytes.byteLength : null, ms, keys: parsed ? Object.keys(parsed) : null, children: parsed?.children ?? null, stats: stats ? { layers: stats.layers, failed: stats.failed, unresolved: stats.unresolved?.slice(0, 5) } : null }
  }))
  H.log('diag B', JSON.stringify(diag))
  const diagA = await H.evalSafe(() => a.page.evaluate(async (sig) => {
    const store = window.ioc.get('@hypercomb.social/Store')
    const local = sig ? await store.getLayerLocalBytes(sig) : null
    return { sig, localLayerBytes: local ? local.byteLength : null }
  }, diag.layerSig))
  H.log('diag A', JSON.stringify(diagA))

  // ── declined: nothing lands ──
  await armConfirm(b, false)
  await pressDoor(b, 'orchard')
  const asked = await H.waitFor(() => confirmSeen(b), v => !!v, 20000, 250)
  H.check('the door asks before taking', asked.ok, JSON.stringify(asked.value))
  const p = asked.value?.params ?? {}
  H.check('the dialog counts the tiles under the root', Number(p.count) === 3, `count=${p.count}`)
  H.check('the dialog names the publisher', typeof p.publisher === 'string' && p.publisher.length > 0, `publisher=${p.publisher}`)
  await H.sleep(2000)
  const after = await H.ownChildren(b.page)
  H.check('declined — nothing was added', !(after.names ?? []).includes('orchard'), JSON.stringify(after.names))

  // ── accepted: the whole branch lands ──
  await armConfirm(b, true)
  await pressDoor(b, 'orchard')
  const held = await H.waitFor(() => H.ownChildren(b.page), o => (o.names ?? []).includes('orchard'), 30000, 500)
  H.check('accepted — the root tile is B\'s now', held.ok, `${held.waitedMs}ms`)
  const kids = await H.waitFor(() => H.evalSafe(() => b.page.evaluate(async () => {
    const history = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
    const sig = await history.sign({ explorerSegments: () => ['orchard'] })
    const layer = await history.currentLayerAt(sig)
    const names = []
    for (const cs of (layer?.children ?? [])) { try { const c = await history.getLayerBySig(cs); if (c?.name) names.push(c.name) } catch {} }
    return names.sort()
  })), n => ['apple', 'pear', 'plum'].every(x => n.includes(x)), 30000, 500)
  H.check('accepted — the children are at B\'s path too', kids.ok, JSON.stringify(kids.value))

  console.log('\n========== adopt-branch ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
