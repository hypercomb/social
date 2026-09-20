// scripts/drive-swarm-scale.cjs
//
// MANY PARTICIPANTS, EVERY TIME. N clients in one fresh zone, each in its OWN
// browser process (from the third context in one headless process the dev
// shell's boot stalls before its post-paint work — see drive-swarm-join-order),
// each publishing one tile at root. Then:
//
//   1. convergence   every client sees every other client's tile, and we
//                    record how long each took — the "sparse / takes a while"
//                    complaint is a convergence-time complaint.
//   2. late joiner   an (N+1)th participant boots into the crowded zone and
//                    must see all N tiles at once: "immediate when
//                    participants connect".
//   3. bytes         a resource only ONE participant holds must reach a
//                    stranger over the mesh through Store.getResource — the
//                    Store → broker → mesh path that was severed for weeks —
//                    both cold (no claim) and claimed (a peer announced it,
//                    which races the mesh and lifts any miss window).
//   4. stand-down    with N holders of the same bytes, the number that
//                    actually PUBLISH a copy must stay small — the crowd
//                    converges to ~1x, not N× (drive-swarm-connectivity's
//                    two-client run cannot see this at all).
//   5. repeat        the byte path is exercised several times with fresh
//                    sigs; every one must land, and the slow tail is reported.
//
//   node scripts/drive-swarm-scale.cjs --relay ws://localhost:7777 [--n 8] [--rounds 5]

const H = require('./drive-swarm-connectivity.cjs')

const N = Number((() => { const i = process.argv.indexOf('--n'); return i >= 0 ? process.argv[i + 1] : 8 })())
const ROUNDS = Number((() => { const i = process.argv.indexOf('--rounds'); return i >= 0 ? process.argv[i + 1] : 5 })())
const ENGINE = (() => { const i = process.argv.indexOf('--engine-a'); return i >= 0 ? process.argv[i + 1] : 'chromium' })()

const zone = {
  room: `scale-${Date.now().toString(36)}`,
  secret: 'secret-' + Math.random().toString(36).slice(2, 10),
  relay: H.RELAY,
  seed: { 'hc:swarm:sticky': '1' },
}

async function boot(label) {
  const la = H.launcherFor(ENGINE)
  const browser = await la.type.launch({ headless: !H.HEADED, ...la.opts })
  const c = await H.newClient(browser, label, zone)
  c.browser = browser
  await c.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(c.page)
  await H.installIfNeeded(c.page, label)
  if (!(await H.waitForReady(c.page))) throw new Error(`${label}: never reached IoC ready`)
  await H.settle(c.page)
  // Count every byte RESPONSE this participant publishes (kind 30401) — the
  // stand-down check reads these across the crowd.
  await H.evalSafe(() => c.page.evaluate(() => {
    const mesh = window.ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone')
    if (!mesh?.publish || mesh.__counted) return
    const orig = mesh.publish
    window.__responsesPublished = 0
    // BYTE responses only: a joining participant's visuals recovery makes
    // every peer publish a kind-30401 visuals answer too, one each, which is
    // exactly the shape a failed stand-down would have.
    mesh.publish = (kind, sig, payload, tags, ...rest) => {
      const isBytes = Number(kind) === 30401 && Array.isArray(tags) && tags.some(t => t[0] === 't' && (t[1] === 'resource' || t[1] === 'layer'))
      if (isBytes) window.__responsesPublished++
      return orig(kind, sig, payload, tags, ...rest)
    }
    mesh.__counted = true
  }))
  return c
}

async function join(c) {
  await H.joinSwarm(c.page)
  const open = await H.waitFor(() => H.meshState(c.page), s => (s.sockets ?? []).some(x => x.readyState === 1), 30000)
  const sig = await H.waitFor(() => H.swarmState(c.page), s => !!s.currentSig, 15000)
  return open.ok && sig.ok
}

const responsesOf = (c) => H.evalSafe(() => c.page.evaluate(() => window.__responsesPublished ?? 0))

async function putBytes(c, size) {
  return H.evalSafe(() => c.page.evaluate(async (n) => {
    const store = window.ioc?.get?.('@hypercomb.social/Store')
    const bytes = new Uint8Array(n)
    crypto.getRandomValues(bytes)
    const sig = await store.putResource(new Blob([bytes]), { emit: false })
    return sig
  }, size))
}

async function fetchBytes(c, sig, claimFrom) {
  return H.evalSafe(() => c.page.evaluate(async ({ sig, claimFrom }) => {
    const store = window.ioc?.get?.('@hypercomb.social/Store')
    const broker = window.ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone')
    const wired = !!window.ioc?.get?.('@ContentBrokerDrone')
    if (claimFrom) broker?.notePeerLiveness?.(claimFrom, [sig])
    const t0 = performance.now()
    const blob = await store.getResource(sig)
    return { wired, ms: Math.round(performance.now() - t0), size: blob ? blob.size : null }
  }, { sig, claimFrom }))
}

async function main() {
  H.log('boot', `url=${H.URL_} relay=${H.RELAY} n=${N} rounds=${ROUNDS} zone=${zone.room}`)
  const clients = []
  try {
    // ── boot + join the crowd, sequentially (each is its own browser) ──
    for (let i = 0; i < N; i++) {
      const c = await boot(`P${i}`)
      clients.push(c)
      await H.addTile(c.page, `tile-${i}`)
      await H.waitFor(() => H.ownChildren(c.page), o => (o.names ?? []).includes(`tile-${i}`), 15000)
      const ok = await join(c)
      H.check(`P${i} joins the zone`, ok)
    }
    const names = clients.map((_, i) => `tile-${i}`)

    // ── 1. convergence ──
    const times = []
    for (let i = 0; i < N; i++) {
      const want = names.filter(n => n !== `tile-${i}`)
      const r = await H.waitFor(() => H.peerTilesNow(clients[i].page), t => want.every(n => t.includes(n)), 60000, 250)
      times.push(r.waitedMs)
      H.check(`P${i} sees all ${N - 1} peer tiles`, r.ok, r.ok ? `${r.waitedMs}ms` : `has ${JSON.stringify(r.value)}`)
    }
    H.log('converge', `per-client wait ms: ${JSON.stringify(times)} max=${Math.max(...times)}`)

    // ── 2. late joiner ──
    const late = await boot('LATE')
    clients.push(late)
    const t0 = Date.now()
    const okJoin = await join(late)
    const r = await H.waitFor(() => H.peerTilesNow(late.page), t => names.every(n => t.includes(n)), 30000, 200)
    H.check(`late joiner sees all ${N} tiles on connect`, okJoin && r.ok, `${Date.now() - t0}ms after the join gesture; has ${r.value?.length ?? 0}/${N}`)

    // ── 3 + 5. bytes, cold and claimed, repeated ──
    const holder = clients[0]
    const holderKey = await H.pubkeyOf(holder.page)
    const wired = await fetchBytes(late, 'f'.repeat(64), null)
    H.check('Store can reach the broker (runtime contract key registered)', wired.wired, `'@ContentBrokerDrone' → ${wired.wired}`)
    const cold = [], claimed = []
    for (let k = 0; k < ROUNDS; k++) {
      const sigA = await putBytes(holder, 40_000)
      const a = await fetchBytes(late, sigA, null)
      cold.push(a.ms)
      H.check(`round ${k}: cold fetch lands (${a.size ?? 'null'} bytes)`, a.size === 40_000, `${a.ms}ms`)

      const sigB = await putBytes(holder, 40_000)
      const b = await fetchBytes(late, sigB, holderKey)
      claimed.push(b.ms)
      H.check(`round ${k}: claimed fetch lands (${b.size ?? 'null'} bytes)`, b.size === 40_000, `${b.ms}ms`)
    }
    const sorted = (a) => [...a].sort((x, y) => x - y)
    H.log('bytes', `cold ms ${JSON.stringify(sorted(cold))} | claimed ms ${JSON.stringify(sorted(claimed))}`)

    // ── 4. stand-down: everyone holds it, few should publish it ──
    // Spread the bytes to every participant first (each fetches once, which
    // also writes through), then a fresh stranger asks and we count publishers.
    const sigC = await putBytes(holder, 40_000)
    for (const c of clients.slice(1, N)) await fetchBytes(c, sigC, null)
    // Stand-down delays a holder's reply by up to two slots; let the replies to
    // the spread itself land before the baseline is taken, or they are counted
    // against the stranger's ask.
    await H.sleep(3000)
    const before = await Promise.all(clients.map(responsesOf))
    const asker = await boot('ASKER')
    clients.push(asker)
    await join(asker)
    const got = await fetchBytes(asker, sigC, null)
    await H.sleep(2500)   // let any late stand-down publishers commit
    const after = await Promise.all(clients.map(responsesOf))
    const publishers = clients.map((c, i) => [c.label, after[i] - before[i]]).filter(([, d]) => d > 0)
    H.check(`stranger gets bytes ${N} participants hold`, got.size === 40_000, `${got.ms}ms`)
    H.check(`crowd converges — ${N} holders, few publishers`, publishers.length <= 3, `publishers=${JSON.stringify(publishers)}`)
  } catch (e) {
    H.check('scale run reached the end', false, String(e).slice(0, 300))
  } finally {
    console.log('\n========== scale n=' + N + ' ==========')
    for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
    console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
    if (!H.KEEP) for (const c of clients) { try { await c.browser.close() } catch { /* gone */ } }
    process.exit(H.results.every(r => r.ok) ? 0 : 1)
  }
}

main()
