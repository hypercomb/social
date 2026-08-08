// scripts/drive-swarm-connectivity.cjs
//
// Swarm connectivity harness — two independent clients, real join gesture.
//
// Supersedes drive-swarm-sync-test.cjs, which pre-dates the 2026-07-22 rule
// "a refresh always lands private". That harness set `hc:mesh-public` in
// localStorage before reload; both shells now force it back to 'false' at
// boot (hypercomb-dev/src/app/app.ts, hypercomb-web/src/app/core-adapter.ts),
// so the flag was gone before the mesh ever read it and every run reported a
// dead swarm that was actually working as designed. Joining is a per-session
// GESTURE, so the harness performs the gesture: the same `mesh.togglePublic`
// keymap command the swarm control and the keyboard shortcut emit.
//
// Each client is its own Playwright context = its own OPFS = its own pubkey,
// which is what makes them genuinely different clients rather than two tabs
// sharing one hive.
//
// Usage:
//   node scripts/drive-swarm-connectivity.cjs                         # dev 4250
//   node scripts/drive-swarm-connectivity.cjs --url https://hypercomb.io/
//   node scripts/drive-swarm-connectivity.cjs --headed                # watch it
//
// Options:
//   --url <origin>     shell to drive          (default http://localhost:4250/)
//   --relay <ws url>   relay override          (default: the shell's own default)
//   --headed           show the browsers
//   --keep             leave browsers open at the end

const { chromium, webkit, firefox } = require('playwright')

// Two clients can be two isolated contexts (own OPFS, own identity — already
// genuinely separate participants) or two different BROWSERS. --engine-b puts
// B on another engine or another installed browser so the check also covers
// "my laptop's Edge cannot see my desktop's Chrome".
//   chromium (default) | webkit | firefox | msedge | chrome
function launcherFor(name) {
  switch (name) {
    case 'webkit': return { type: webkit, opts: {} }
    case 'firefox': return { type: firefox, opts: {} }
    case 'msedge': return { type: chromium, opts: { channel: 'msedge' } }
    case 'chrome': return { type: chromium, opts: { channel: 'chrome' } }
    default: return { type: chromium, opts: {} }
  }
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback
}
const URL_ = arg('url', 'http://localhost:4250/')
const RELAY = arg('relay', null)
const ENGINE_A = arg('engine-a', 'chromium')
const ENGINE_B = arg('engine-b', 'chromium')
const HEADED = process.argv.includes('--headed')
const KEEP = process.argv.includes('--keep')

// One zone per run so a shared relay's stored history can never leak in.
const ROOM = 'swarm-check-' + Date.now().toString(36)
const SECRET = 'secret-' + Math.random().toString(36).slice(2, 10)

const ts = () => new Date().toISOString().slice(11, 23)
const log = (tag, ...a) => console.log(`[${ts()}] [${tag}]`, ...a)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function newClient(browser, label) {
  const ctx = await browser.newContext()
  // Seed the zone BEFORE any page script runs, on every navigation.
  //
  // Writing localStorage after goto() races the boot: RoomStore/SecretStore
  // read their key once in the constructor and cache it, and the loopback
  // dev default then seeds 'downtown' over a secret that looked unset at
  // construction time. That race made two clients disagree on the secret —
  // same room, different sig, no swarm — which reads exactly like a broken
  // relay. addInitScript puts the values in place before the stores exist,
  // which is also the state a returning client actually boots into.
  await ctx.addInitScript(({ room, secret, relay }) => {
    localStorage.setItem('hc:room', room)
    localStorage.setItem('hc:secret', secret)
    if (relay) {
      localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([relay]))
      localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
    }
  }, { room: ROOM, secret: SECRET, relay: RELAY })
  const page = await ctx.newPage()
  page.on('pageerror', e => log(label, 'PAGE ERROR:', String(e).slice(0, 200)))
  // The shell fires several router navigations while it boots, and IoC is
  // populated BEFORE they finish — so "ready" is not "safe to drive". Every
  // one of them destroys the evaluate context; settle() below waits them out.
  page.__lastNavAt = Date.now()
  page.on('framenavigated', f => { if (f === page.mainFrame()) page.__lastNavAt = Date.now() })
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    // The headless runner has no GPU; Pixi cannot build its mesh scene.
    // That is the harness environment, not the swarm — the whole check
    // runs against IoC state, which does not need a painted canvas.
    if (t.includes('WebGL') || t.includes('WebGPU') || t.includes('PixiJS')) return
    log(label, '[console.error]', t.slice(0, 200))
  })
  return { label, ctx, page }
}

async function waitForShell(page, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@hypercomb.social/Lineage') &&
      window.ioc?.get?.('@hypercomb.social/Navigation')
    )).catch(() => false)
    if (ok) return true
    await sleep(300)
  }
  return false
}

async function waitForReady(page, timeoutMs = 45000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone') &&
      window.ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone') &&
      window.ioc?.get?.('@hypercomb.social/Lineage') &&
      window.ioc?.get?.('@hypercomb.social/Navigation')
    )).catch(() => false)
    if (ok) return true
    await sleep(300)
  }
  return false
}

// A deployed shell loads its drones from OPFS, and a first-time visitor has
// none: ensure-install reports "no cached install + no sentinel — surfacing
// install-needed" and WAITS for the participant (push-only contract — boot
// never installs by itself). Until that is accepted there is no SwarmDrone
// at all, so a swarm check would be measuring an empty shell.
//
// window.upgradeHypercomb is the install prompt's own handler, exposed by
// hypercomb-web/src/app/app.ts for exactly this — so this is the button, not
// a back door. It reloads the shell on success. The dev shell imports its
// drones directly and never needs any of this.
async function installIfNeeded(page, label) {
  // The prompt's handler is published by the App constructor, which runs
  // AFTER the runtime registers Lineage/Navigation — so a single sample can
  // catch the window where the shell is up, the drones are absent, and the
  // install button does not exist yet. Poll for whichever settles first.
  const deadline = Date.now() + 45000
  let need = { missing: true, canInstall: false }
  while (Date.now() < deadline) {
    need = await page.evaluate(() => ({
      missing: !window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone'),
      canInstall: typeof window.upgradeHypercomb === 'function',
    })).catch(() => ({ missing: true, canInstall: false }))
    if (!need.missing || need.canInstall) break
    await sleep(1000)
  }
  if (!need.missing) return 'already-installed'
  if (!need.canInstall) return 'no-install-affordance'
  log(label, 'shell has no drones — accepting the install prompt')
  await page.evaluate(() => window.upgradeHypercomb()).catch(() => null)
  // It reloads itself when the install lands; wait for drones, not a timer.
  const start = Date.now()
  while (Date.now() - start < 240000) {
    const ok = await page.evaluate(() =>
      !!window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')).catch(() => false)
    if (ok) { log(label, `install complete after ${Math.round((Date.now() - start) / 1000)}s`); return 'installed' }
    await sleep(3000)
  }
  return 'install-timeout'
}

/** Wait until the page has stopped navigating for `quietMs`. */
async function settle(page, quietMs = 3000, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (Date.now() - page.__lastNavAt >= quietMs) return true
    await sleep(250)
  }
  return false
}

// THE JOIN GESTURE. Identical to the swarm control and the keymap binding:
// flip the flag, tell the mesh, announce it. Emitted through a live bee so
// it travels the real EffectBus rather than a harness-only side channel.
async function joinSwarm(page) {
  return page.evaluate(() => {
    const bee = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    if (!bee?.emitEffect) return { ok: false, reason: 'no SwarmDrone' }
    bee.emitEffect('keymap:invoke', { cmd: 'mesh.togglePublic', binding: null, event: null })
    return { ok: true }
  })
}

async function meshState(page) {
  return page.evaluate(() => {
    const mesh = window.ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone')
    if (!mesh) return { err: 'no mesh' }
    const d = mesh.getDebug?.() ?? {}
    return {
      networkEnabled: mesh.isNetworkEnabled?.() ?? null,
      meshPublic: localStorage.getItem('hc:mesh-public'),
      sockets: (d.sockets ?? []).map(s => ({ relay: s.relay ?? s.url, readyState: s.readyState })),
      stats: d.stats ?? null,
      buckets: Array.isArray(d.buckets) ? d.buckets.length : null,
    }
  })
}

async function swarmState(page) {
  return page.evaluate(() => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    if (!swarm) return { err: 'no swarm' }
    let dbg = {}
    try { dbg = swarm.debug?.() ?? {} } catch (e) { dbg = { debugThrew: String(e) } }
    const tiles = swarm.peerTilesAtCurrentSig?.() ?? []
    return {
      currentSig: dbg.currentSig ?? null,
      // The exact bytes that produced currentSig. Two clients at the same
      // place in the same zone MUST agree here; when they do not, this
      // line names the field that diverged.
      syncKey: dbg.lastSyncInput?.key ?? null,
      subsBySig: dbg.subsBySig ?? null,
      room: dbg.room ?? null,
      secretSet: dbg.secretSet ?? null,
      peerLayerCount: dbg.peerLayersBySig
        ? Object.keys(dbg.peerLayersBySig).length
        : (dbg.peerLayers ?? null),
      peerTiles: tiles.map(t => ({ name: t.name, peer: t.peerPubkey?.slice(0, 8) ?? null })),
    }
  })
}

async function pubkeyOf(page) {
  return page.evaluate(async () => {
    const s = window.ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')
    return s?.getPublicKeyHex ? await s.getPublicKeyHex() : null
  })
}

async function addTile(page, name) {
  return page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input')
      || document.querySelector('input[type="text"]')
    if (!input) return { ok: false, reason: 'no command line input' }
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return { ok: true }
  }, name)
}

async function ownChildren(page) {
  return page.evaluate(async () => {
    const lineage = window.ioc?.get?.('@hypercomb.social/Lineage')
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history) return { err: 'no lineage/history' }
    const segments = lineage.explorerSegments?.() ?? []
    const sig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(sig)
    const names = []
    for (const cs of (Array.isArray(layer?.children) ? layer.children : [])) {
      try { const c = await history.getLayerBySig(cs); if (c?.name) names.push(c.name) } catch { /* skip */ }
    }
    return { segments, names: names.sort() }
  })
}

async function adopt(page, label) {
  return page.evaluate((cellLabel) => {
    const bee = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    if (!bee?.emitEffect) return { ok: false, reason: 'no SwarmDrone' }
    bee.emitEffect('tile:action', { action: 'adopt', label: cellLabel, q: 0, r: 0, index: 0 })
    return { ok: true }
  }, label)
}

// Poll instead of sleeping on a guess — a slow relay should read as slow,
// not as broken.
async function waitFor(fn, predicate, timeoutMs, everyMs = 500) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    last = await fn()
    if (predicate(last)) return { ok: true, value: last, waitedMs: Date.now() - start }
    await sleep(everyMs)
  }
  return { ok: false, value: last, waitedMs: Date.now() - start }
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  log('check', (ok ? '✓ PASS  ' : '✗ FAIL  ') + name + (detail ? '  — ' + detail : ''))
}

async function main() {
  log('boot', `url=${URL_} relay=${RELAY ?? '(shell default)'} zone=${ROOM}`)
  log('boot', `clients: A=${ENGINE_A} B=${ENGINE_B}`)
  const la = launcherFor(ENGINE_A)
  const lb = launcherFor(ENGINE_B)
  const browserA = await la.type.launch({ headless: !HEADED, ...la.opts })
  // Same engine and same options: one browser process, two isolated contexts
  // (still separate OPFS + identity). Different engine: a second process, so
  // the two clients are different BROWSERS in the way a user means it.
  const sameBrowser = ENGINE_A === ENGINE_B
  const browserB = sameBrowser ? browserA : await lb.type.launch({ headless: !HEADED, ...lb.opts })
  const browsers = sameBrowser ? [browserA] : [browserA, browserB]
  const A = await newClient(browserA, 'A')
  const B = await newClient(browserB, 'B')

  for (const c of [A, B]) await c.page.goto(URL_, { waitUntil: 'domcontentloaded' })

  for (const c of [A, B]) {
    await waitForShell(c.page)
    const installed = await installIfNeeded(c.page, c.label)
    if (installed === 'no-install-affordance') log(c.label, 'no install prompt — treating as a source-loaded shell')
    if (!(await waitForReady(c.page))) {
      check(`${c.label}: shell reaches IoC ready`, false, `install=${installed}`)
      return finish(browsers)
    }
  }
  for (const c of [A, B]) await settle(c.page)
  check('both shells boot to IoC ready', true)

  // A hive stores its tiles in OPFS. A browser without it can still RECEIVE a
  // swarm, but it can never author or adopt — so say that plainly instead of
  // letting it surface as three unexplained failures. (Playwright's WebKit
  // build ships without navigator.storage.getDirectory; Safari itself has it.)
  for (const c of [A, B]) {
    const hasOpfs = await c.page.evaluate(
      () => typeof navigator?.storage?.getDirectory === 'function').catch(() => false)
    if (!hasOpfs) {
      check(`${c.label}: browser provides OPFS`, false,
        `${c.label === 'A' ? ENGINE_A : ENGINE_B} has no navigator.storage.getDirectory — it cannot author or adopt`)
    }
  }

  const [pkA, pkB] = [await pubkeyOf(A.page), await pubkeyOf(B.page)]
  log('boot', `pubkeys A=${pkA?.slice(0, 8)} B=${pkB?.slice(0, 8)}`)
  check('clients have distinct identities', !!pkA && !!pkB && pkA !== pkB,
    pkA === pkB ? 'same pubkey — contexts are not isolated' : null)

  // A refresh must land private. Measured as SWARM SILENCE — no zone sig,
  // no subscriptions — not as "no socket": the feedback channel legitimately
  // raises the mesh socket at boot (persist=false, feedback-channel.drone
  // #ensureActive), so an open socket says nothing about whether this hive
  // is broadcasting.
  const preA = await meshState(A.page)
  const preSwarmA = await swarmState(A.page)
  check('a fresh boot broadcasts nothing',
    preA.meshPublic !== 'true' && !preSwarmA.currentSig && (preSwarmA.subsBySig ?? []).length === 0,
    `meshPublic=${preA.meshPublic} sig=${preSwarmA.currentSig || '(none)'} subs=${(preSwarmA.subsBySig ?? []).length}`)

  log('join', 'both clients perform the join gesture')
  log('A', 'join:', JSON.stringify(await joinSwarm(A.page)))
  log('B', 'join:', JSON.stringify(await joinSwarm(B.page)))

  const openA = await waitFor(() => meshState(A.page), s => (s.sockets ?? []).some(x => x.readyState === 1), 30000)
  const openB = await waitFor(() => meshState(B.page), s => (s.sockets ?? []).some(x => x.readyState === 1), 30000)
  log('A', 'mesh:', JSON.stringify(openA.value))
  log('B', 'mesh:', JSON.stringify(openB.value))
  check('A opens a relay socket', openA.ok, openA.ok ? `${openA.waitedMs}ms` : JSON.stringify(openA.value?.sockets))
  check('B opens a relay socket', openB.ok, openB.ok ? `${openB.waitedMs}ms` : JSON.stringify(openB.value?.sockets))

  if (!openA.ok || !openB.ok) return finish(browsers)

  log('tiles', 'A adds alpha+bravo, B adds charlie+delta')
  await addTile(A.page, 'alpha'); await sleep(800)
  await addTile(A.page, 'bravo'); await sleep(800)
  await addTile(B.page, 'charlie'); await sleep(800)
  await addTile(B.page, 'delta'); await sleep(1500)

  const localA = await ownChildren(A.page)
  const localB = await ownChildren(B.page)
  check('A created its own tiles locally', (localA.names ?? []).includes('alpha'), JSON.stringify(localA.names))
  check('B created its own tiles locally', (localB.names ?? []).includes('charlie'), JSON.stringify(localB.names))

  const seesB = await waitFor(() => swarmState(A.page),
    s => (s.peerTiles ?? []).some(t => t.name === 'charlie'), 30000)
  const seesA = await waitFor(() => swarmState(B.page),
    s => (s.peerTiles ?? []).some(t => t.name === 'alpha'), 30000)
  log('A', 'swarm:', JSON.stringify(seesB.value))
  log('B', 'swarm:', JSON.stringify(seesA.value))
  check('A loads B\'s swarm tiles', seesB.ok,
    seesB.ok ? `${seesB.waitedMs}ms` : JSON.stringify(seesB.value?.peerTiles))
  check('B loads A\'s swarm tiles', seesA.ok,
    seesA.ok ? `${seesA.waitedMs}ms` : JSON.stringify(seesA.value?.peerTiles))

  if (seesA.ok) {
    log('adopt', 'B adopts alpha')
    log('B', 'adopt:', JSON.stringify(await adopt(B.page, 'alpha')))
    const folded = await waitFor(() => ownChildren(B.page),
      c => (c.names ?? []).includes('alpha'), 30000)
    check('a swarm tile is adoptable', folded.ok,
      folded.ok ? `${folded.waitedMs}ms` : JSON.stringify(folded.value?.names))
  } else {
    check('a swarm tile is adoptable', false, 'skipped — no swarm tiles arrived')
  }

  // ── the dead-swarm regression ──────────────────────────────────────
  // A client with no zone (what every visitor to a bare-domain origin has:
  // nothing seeds a room there) takes the keyboard shortcut to go public.
  // It must NOT end up flagged public with a swarm that can never reach
  // anyone — the state that reads as "the swarm is broken".
  const C = await newClientNoZone(browserA, 'C')
  await C.page.goto(URL_, { waitUntil: 'domcontentloaded' })
  await waitForShell(C.page, 120000)
  const cInstall = await installIfNeeded(C.page, 'C')
  log('C', 'install:', cInstall)
  if (await waitForReady(C.page, 120000) && await settle(C.page)) {
    const zone = await C.page.evaluate(() => ({
      room: (window.ioc?.get?.('@hypercomb.social/RoomStore'))?.value ?? '',
      secret: (window.ioc?.get?.('@hypercomb.social/SecretStore'))?.value ?? '',
    }))
    log('C', 'zone as a fresh visitor gets it:', JSON.stringify(zone))
    if (zone.room && zone.secret) {
      log('C', 'origin seeds a complete zone — dead-swarm state unreachable here, skipping')
    } else {
      await joinSwarm(C.page)
      await sleep(4000)
      const m = await meshState(C.page)
      const s = await swarmState(C.page)
      const deadSwarm = m.meshPublic === 'true' && !s.currentSig
      check('an incomplete zone never lands in a dead swarm', !deadSwarm,
        `meshPublic=${m.meshPublic} sig=${s.currentSig || '(none)'}`)
    }
  } else {
    check('an incomplete zone never lands in a dead swarm', false,
      `client C never reached IoC ready (install=${cInstall})`)
  }

  return finish(browsers)
}

// Same as newClient but with no zone seeded — a first-time visitor.
async function newClientNoZone(browser, label) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('pageerror', e => log(label, 'PAGE ERROR:', String(e).slice(0, 200)))
  page.__lastNavAt = Date.now()
  page.on('framenavigated', f => { if (f === page.mainFrame()) page.__lastNavAt = Date.now() })
  return { label, ctx, page }
}

async function finish(browsers) {
  const failed = results.filter(r => !r.ok)
  console.log('\n========== ' + URL_ + ' ==========')
  for (const r of results) console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.detail ? '  — ' + r.detail : ''))
  console.log(`========== ${results.length - failed.length}/${results.length} passed ==========\n`)
  if (!KEEP) for (const b of browsers) await b.close()
  else log('boot', 'left open (--keep)')
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error('[fatal]', e); process.exit(1) })
