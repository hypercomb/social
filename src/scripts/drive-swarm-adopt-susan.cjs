// scripts/drive-swarm-adopt-susan.cjs
//
// THE SUSAN INCIDENT, ON THE REAL MESH. Two independent clients (own OPFS, own
// identity) meet in one room through a SCRATCH relay (never the operator's live
// relay on 7777). Both own a `susan` tile, built independently, so the two
// layers DIVERGE:
//
//   A (the mother):  susan/{own-1, own-2, shared/{a-only}}
//   B (the newer):   susan/{b-1, b-2, shared/{b-only}}
//
// B is seen by A as a peer; A presses the adopt-branch door (confirm: yes).
// The rule under test: tiles are only additive, the owner's wins, nothing lost.
//
//   after adopt   : A keeps own-1, own-2, shared/a-only, and GAINS b-1, b-2,
//                   shared/b-only; A's own children keep their order first;
//                   every child resolves (no orphan).
//   after reload  : the same, from a cold boot of A.
//   adopt twice   : idempotent — no duplicates, nothing lost.
//
//   node scripts/drive-swarm-adopt-susan.cjs [--url http://localhost:4250/] [--relay-port 7801] [--headed] [--keep]

const H = require('./drive-swarm-connectivity.cjs')

const room = `susan-${Date.now().toString(36)}`
const secret = 'secret-' + Math.random().toString(36).slice(2, 10)

async function boot(label, relay) {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const zone = { room, secret, relay, seed: { ...H.swarmSeed(relay), 'hc:swarm:sticky': '1' } }
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

/** Create `names` as children at `segments`, waiting for each to land. */
async function build(c, segments, names) {
  await H.navTo(c.page, segments); await H.settle(c.page, 1500)
  for (const n of names) {
    await H.addTile(c.page, n)
    const got = await H.waitFor(() => H.ownChildren(c.page), o => (o.names ?? []).includes(n), 15000)
    if (!got.ok) throw new Error(`${c.label}: ${segments.join('/')}/${n} never landed`)
  }
}

/** Children of a layer, in ORDER (ownChildren sorts; adoption order matters here). */
const orderedAt = (c, segments) => H.evalSafe(() => c.page.evaluate(async (segs) => {
  const history = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
  const sig = await history.sign({ explorerSegments: () => segs })
  const layer = await history.currentLayerAt(sig)
  const out = []
  for (const cs of (layer?.children ?? [])) {
    try { const l = await history.getLayerBySig(cs); out.push(l?.name ?? null) } catch { out.push(null) }
  }
  return out
}, segments))

/** The branch door asks with its own overlay (.hc-bp), not confirm:request.
 *  Poll for it and press the real button; record what it said. */
const armConfirm = (c, answer) => H.evalSafe(() => c.page.evaluate((answer) => {
  window.__confirmSeen = null
  const t = setInterval(() => {
    const p = document.querySelector('.hc-bp')
    if (!p) return
    window.__confirmSeen = { title: p.querySelector('.hc-bp-h')?.textContent, message: p.querySelector('.hc-bp-m')?.textContent, warning: p.querySelector('.hc-bp-w')?.textContent ?? null }
    clearInterval(t)
    setTimeout(() => { const b = p.querySelector(answer ? '.hc-bp-x.go' : '.hc-bp-x:not(.go)'); b && b.click() }, 50)
  }, 100)
  setTimeout(() => clearInterval(t), 60000)
  return true
}, answer))

const pressDoor = (c, label) => H.evalSafe(() => c.page.evaluate((label) => {
  const bee = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
  bee.emitEffect('tile:action', { action: 'adopt-branch', label, q: 0, r: 0, index: 0 })
  return true
}, label))

/** Every child reachable under susan resolves (no orphaned sig). */
const orphansUnder = (c) => H.evalSafe(() => c.page.evaluate(async () => {
  const history = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
  const bad = []
  const walk = async (segs, depth) => {
    if (depth > 4) return
    const sig = await history.sign({ explorerSegments: () => segs })
    const layer = await history.currentLayerAt(sig)
    for (const cs of (layer?.children ?? [])) {
      let l = null
      try { l = await history.getLayerBySig(cs) } catch { /* unresolved */ }
      if (!l?.name) { bad.push(`${segs.join('/')}#${String(cs).slice(0, 8)}`); continue }
      await walk([...segs, l.name], depth + 1)
    }
  }
  await walk(['susan'], 0)
  return bad
}))

const ASSERT_OWN = ['own-1', 'own-2', 'shared']
const ASSERT_NEW = ['b-1', 'b-2']

async function verify(c, tag) {
  const kids = await orderedAt(c, ['susan'])
  H.check(`${tag}: her own children are all still there`, ASSERT_OWN.every(n => kids.includes(n)), JSON.stringify(kids))
  H.check(`${tag}: the newer tiles were ADDED`, ASSERT_NEW.every(n => kids.includes(n)), JSON.stringify(kids))
  H.check(`${tag}: her own order leads`, kids.slice(0, 3).join() === ASSERT_OWN.join(), JSON.stringify(kids))
  H.check(`${tag}: no duplicates`, new Set(kids).size === kids.length, JSON.stringify(kids))
  const shared = await orderedAt(c, ['susan', 'shared'])
  H.check(`${tag}: shared keeps a-only AND gains b-only`, shared.includes('a-only') && shared.includes('b-only'), JSON.stringify(shared))
  const bad = await orphansUnder(c)
  H.check(`${tag}: nothing orphaned under susan`, bad.length === 0, JSON.stringify(bad))
}

;(async () => {
  const relay = H.RELAY ?? await H.startScratchRelay()
  if (relay.endsWith(':7777')) throw new Error('refusing to meet on 7777 — that is the live relay')
  const a = await boot('A-mother', relay), b = await boot('B-newer', relay)

  // Independent histories BEFORE they see each other's tile: B builds first and
  // we only look at the wire after both exist.
  await build(a, [], ['susan']); await build(a, ['susan'], ['own-1', 'own-2', 'shared']); await build(a, ['susan', 'shared'], ['a-only'])
  await build(b, [], ['susan']); await build(b, ['susan'], ['b-1', 'b-2', 'shared']); await build(b, ['susan', 'shared'], ['b-only'])
  await H.navTo(a.page, []); await H.navTo(b.page, []); await H.settle(a.page, 1500); await H.settle(b.page, 1500)

  const before = await orderedAt(a, ['susan'])
  H.check('A starts with only her own children', before.join() === ASSERT_OWN.join(), JSON.stringify(before))

  const seen = await H.waitFor(() => H.peerTilesNow(a.page), t => t.includes('susan'), 40000)
  H.check("A sees B's susan", seen.ok, `${seen.waitedMs}ms`)

  const peer = await H.evalSafe(() => a.page.evaluate(() => { const sw = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone'); return (sw?.peerTilesAtCurrentSig?.() ?? []).map(t => ({ name: t.name, layerSig: String(t.layerSig ?? '').slice(0, 12), pk: String(t.pubkey ?? t.pk ?? '').slice(0, 8) })) }))
  H.log('peers@A', JSON.stringify(peer))
  const armed = await H.evalSafe(() => a.page.evaluate(() => !!window.ioc.get('@diamondcoreprocessor.com/AdoptBranchDrone')))
  H.check('adopt-branch door is registered', armed)
  await armConfirm(a, true)
  await pressDoor(a, 'susan')
  const asked = await H.waitFor(() => H.evalSafe(() => a.page.evaluate(() => window.__confirmSeen ?? null)), v => !!v, 20000, 250)
  H.check('the door asked', asked.ok, JSON.stringify(asked.value))
  if (!asked.ok) {
    const dbg = await H.evalSafe(() => a.page.evaluate(() => {
      const sa = window.ioc.get('@diamondcoreprocessor.com/SwarmAdoptDrone')
      const bus = globalThis.__hypercombEffectBus
      let log = null; try { const off = bus.on('activity:log', v => { log = v }); off && off() } catch {}
      return { branch: sa?.peerBranchFor?.('susan') ?? null, hasAdopt: !!sa?.adoptResolvedBranch, log }
    }))
    H.log('dbg', JSON.stringify(dbg))
  }
  const landed = await H.waitFor(() => orderedAt(a, ['susan']), k => ASSERT_NEW.every(n => k.includes(n)), 45000, 500)
  H.check('adopt landed the newer children', landed.ok, `${landed.waitedMs}ms ${JSON.stringify(landed.value)}`)
  await H.settle(a.page, 3000)
  await verify(a, 'after adopt')

  // Adopt again: must be idempotent.
  await armConfirm(a, true); await pressDoor(a, 'susan'); await H.sleep(4000); await H.settle(a.page, 3000)
  await verify(a, 'adopt twice')

  // Cold boot of A (same context = same OPFS): the head must survive a reload.
  await a.page.reload({ waitUntil: 'domcontentloaded' })
  await H.waitForShell(a.page)
  if (!(await H.waitForReady(a.page))) throw new Error('A: not ready after reload')
  await H.settle(a.page, 3000)
  await verify(a, 'after cold reload')

  console.log('\n========== adopt-susan (real mesh) ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) { for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } } H.stopScratchRelay() }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); H.stopScratchRelay(); process.exit(1) })
