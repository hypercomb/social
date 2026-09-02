// scripts/drive-swarm-join-order.cjs
//
// JOIN-ORDER INDEPENDENCE — discovery must never depend on who got there
// first. Four orderings, each in a FRESH zone with two isolated clients
// (own OPFS, own identity), all driven through the real join gesture:
//
//   1. late joiner      A joins and publishes, THEN B joins — the relay's
//                       replay (and the recovery query) must hand B what
//                       was said before it arrived.
//   2. early joiner     B joins first and waits at root, THEN A joins and
//                       publishes — B's live subscription must carry it.
//   3. publisher deep   A publishes at root and WALKS INTO a tile, then B
//                       joins at root. Publishing is page-only, so nothing
//                       of A's is being refreshed at root any more; B can
//                       only recover it through the ROOT drill. `--slow`
//                       waits out the 90s slot expiry first, so the relay
//                       has genuinely forgotten A's root before B asks.
//   4. leave + rejoin   A leaves (tombstone) and rejoins inside the TTL —
//                       B must drop A's tiles and then see them come back.
//
// Usage:
//   node scripts/drive-swarm-join-order.cjs                        # dev 4250
//   node scripts/drive-swarm-join-order.cjs --relay ws://localhost:7777 --slow
// Options are the connectivity harness's (--url, --relay, --engine-a,
// --headed, --keep) plus --slow.

const H = require('./drive-swarm-connectivity.cjs')

const SLOW = process.argv.includes('--slow')
// --mode sticky|ephemeral — seeds hc:swarm:sticky in every client. Sticky
// (the default) keeps visited pages announced, so scenario 3 passes on the
// re-announce alone; ephemeral makes the ROOT DRILL the only way back.
const MODE = (() => { const i = process.argv.indexOf('--mode'); return i >= 0 ? String(process.argv[i + 1]) : 'sticky' })()
const ENGINE = (() => { const i = process.argv.indexOf('--engine-a'); return i >= 0 ? process.argv[i + 1] : 'chromium' })()

function zone(tag) {
  return {
    room: `join-order-${tag}-${Date.now().toString(36)}`,
    secret: 'secret-' + Math.random().toString(36).slice(2, 10),
    relay: H.RELAY,
    seed: { 'hc:swarm:sticky': MODE === 'ephemeral' ? '0' : '1' },
  }
}

async function boot(browser, label, z) {
  const c = await H.newClient(browser, label, z)
  await c.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(c.page)
  const installed = await H.installIfNeeded(c.page, label)
  if (!(await H.waitForReady(c.page))) throw new Error(`${label}: shell never reached IoC ready (install=${installed})`)
  await H.settle(c.page)
  return c
}

/** The join gesture, then wait for a live socket AND a composed sig. */
async function join(c) {
  H.log(c.label, 'join:', JSON.stringify(await H.joinSwarm(c.page)))
  const open = await H.waitFor(() => H.meshState(c.page), s => (s.sockets ?? []).some(x => x.readyState === 1), 30000)
  const sig = await H.waitFor(() => H.swarmState(c.page), s => !!s.currentSig, 15000)
  H.log(c.label, `socket=${open.ok} sig=${sig.value?.currentSig ?? '(none)'} key=${JSON.stringify(sig.value?.syncKey ?? null)}`)
  if (!open.ok) H.log(c.label, 'mesh at failure:', JSON.stringify(open.value))
  return open.ok && sig.ok
}

/** The same keymap command the swarm control emits — a TOGGLE, so this is
 *  how a client leaves. (joinSwarm is the same emit plus the ungated flag.) */
async function togglePublic(page) {
  return H.evalSafe(() => page.evaluate(() => {
    const bee = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    if (!bee?.emitEffect) return { ok: false, reason: 'no SwarmDrone' }
    bee.emitEffect('keymap:invoke', { cmd: 'mesh.togglePublic', binding: null, event: null })
    return { ok: true, meshPublic: localStorage.getItem('hc:mesh-public') }
  }))
}

async function sees(c, names, timeoutMs) {
  return H.waitFor(() => H.swarmState(c.page),
    s => names.every(n => (s.peerTiles ?? []).some(t => t.name === n)), timeoutMs)
}

async function lacks(c, names, timeoutMs) {
  return H.waitFor(() => H.swarmState(c.page),
    s => names.every(n => !(s.peerTiles ?? []).some(t => t.name === n)), timeoutMs)
}

/** The drill tunnel's own diagnostics — which path was asked for / served. */
async function drillState(page) {
  return H.evalSafe(() => page.evaluate(() => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const d = swarm?.debug?.() ?? {}
    return { request: d.lastDrillRequest ?? null, served: d.lastDrillServed ?? null }
  }))
}

const tiles = (s) => JSON.stringify((s?.peerTiles ?? []).map(t => t.name))

async function closeAll(...clients) {
  if (H.KEEP) return
  for (const c of clients) { try { await c.ctx.close() } catch { /* already gone */ } }
}

async function scenario(name, fn) {
  H.log('scenario', '── ' + name)
  try { await fn() }
  catch (e) { H.check(`${name}: ran to completion`, false, String(e).slice(0, 200)) }
}

async function main() {
  H.log('boot', `url=${H.URL_} relay=${H.RELAY ?? '(shell default)'} slow=${SLOW} mode=${MODE} engine=${ENGINE}`)
  const la = H.launcherFor(ENGINE)
  const browser = await la.type.launch({ headless: !H.HEADED, ...la.opts })

  // ── 1. late joiner ────────────────────────────────────────────────
  await scenario('late joiner', async () => {
    const z = zone('late')
    const A = await boot(browser, 'A1', z)
    H.check('1: A joins', await join(A))
    await H.addTile(A.page, 'apple'); await H.sleep(800)
    await H.addTile(A.page, 'apricot'); await H.sleep(2500)
    const B = await boot(browser, 'B1', z)
    H.check('1: B joins after A published', await join(B))
    const got = await sees(B, ['apple', 'apricot'], 45000)
    H.check('1: the late joiner sees everything published before it arrived', got.ok,
      got.ok ? `${got.waitedMs}ms` : tiles(got.value))
    await H.addTile(B.page, 'banana'); await H.sleep(500)
    const back = await sees(A, ['banana'], 45000)
    H.check('1: the first client sees what the late joiner adds', back.ok,
      back.ok ? `${back.waitedMs}ms` : tiles(back.value))
    await closeAll(A, B)
  })

  // ── 2. early joiner ───────────────────────────────────────────────
  await scenario('early joiner', async () => {
    const z = zone('early')
    const B = await boot(browser, 'B2', z)
    H.check('2: B joins an empty zone', await join(B))
    await H.sleep(3000)
    const A = await boot(browser, 'A2', z)
    H.check('2: A joins second', await join(A))
    await H.addTile(A.page, 'cherry'); await H.sleep(500)
    const got = await sees(B, ['cherry'], 45000)
    H.check('2: the early joiner sees what arrives after it', got.ok,
      got.ok ? `${got.waitedMs}ms` : tiles(got.value))
    const keyA = (await H.swarmState(A.page)).syncKey
    const keyB = (await H.swarmState(B.page)).syncKey
    H.check('2: both clients composed the same zone key', !!keyA && keyA === keyB, `A=${JSON.stringify(keyA)} B=${JSON.stringify(keyB)}`)
    await closeAll(A, B)
  })

  // ── 3. publisher already deep ─────────────────────────────────────
  await scenario('publisher deep', async () => {
    const z = zone('deep')
    const A = await boot(browser, 'A3', z)
    H.check('3: A joins', await join(A))
    await H.addTile(A.page, 'date'); await H.sleep(800)
    await H.addTile(A.page, 'dill'); await H.sleep(2500)
    await H.navTo(A.page, ['date']); await H.sleep(1500)
    const where = await H.locationNow(A.page)
    H.check('3: A has walked into a tile (root no longer refreshed)', JSON.stringify(where) === '["date"]', JSON.stringify(where))
    if (SLOW) { H.log('A3', 'waiting 100s so the relay forgets the root slot (EVENT_TTL_SECS=90)'); await H.sleep(100000) }
    const B = await boot(browser, 'B3', z)
    H.check('3: B joins at root while A is deep', await join(B))
    const got = await sees(B, ['date', 'dill'], 60000)
    H.check(`3: B recovers the root (${MODE === 'ephemeral' ? 'root drill only' : 'sticky re-announce + root drill'})${SLOW ? ' after the slot expired' : ''}`, got.ok,
      got.ok ? `${got.waitedMs}ms` : tiles(got.value))
    const dA = await drillState(A.page)
    const dB = await drillState(B.page)
    H.log('A3', 'drill served:', JSON.stringify(dA.served))
    H.log('B3', 'drill request:', JSON.stringify(dB.request))
    H.check('3: B asked for root (empty path)', dB.request?.stage === 'sent' && Array.isArray(dB.request?.share) && dB.request.share.length === 0,
      JSON.stringify(dB.request))
    H.check('3: A served the root drill', dA.served?.stage === 'served' && Array.isArray(dA.served?.at) && dA.served.at.length === 0,
      JSON.stringify(dA.served))
    await closeAll(A, B)
  })

  // ── 4. leave and rejoin ───────────────────────────────────────────
  await scenario('leave and rejoin', async () => {
    const z = zone('rejoin')
    const A = await boot(browser, 'A4', z)
    H.check('4: A joins', await join(A))
    await H.addTile(A.page, 'elder'); await H.sleep(1500)
    const B = await boot(browser, 'B4', z)
    H.check('4: B joins', await join(B))
    const first = await sees(B, ['elder'], 45000)
    H.check('4: B sees A before the leave', first.ok, first.ok ? `${first.waitedMs}ms` : tiles(first.value))
    H.log('A4', 'leave:', JSON.stringify(await togglePublic(A.page)))
    const gone = await lacks(B, ['elder'], 20000)
    H.check('4: the tombstone drops the tiles at once', gone.ok, gone.ok ? `${gone.waitedMs}ms` : tiles(gone.value))
    await H.sleep(2000)
    H.check('4: A rejoins inside the TTL', await join(A))
    const again = await sees(B, ['elder'], 45000)
    H.check('4: the tiles come back after the rejoin', again.ok, again.ok ? `${again.waitedMs}ms` : tiles(again.value))
    await closeAll(A, B)
  })

  return H.finish([browser])
}

main().catch(e => { console.error('[fatal]', e); process.exit(1) })
