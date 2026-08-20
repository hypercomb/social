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
//   --shots <dir>      save PNGs of the swarm page (shaded, then added)

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
const SHOTS = arg('shots', null)   // dir: save what the swarm LOOKS like
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
// The availability gate is bypassed the same way the sanctioned setup
// command does it (/use-live-relay sets hc:swarm:ungated — the "reliable
// and simple" ruling, 2026-08-20) so the harness joins like a real
// participant joins today.
async function joinSwarm(page) {
  return evalSafe(() => page.evaluate(() => {
    localStorage.setItem('hc:swarm:ungated', '1')
    const bee = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    if (!bee?.emitEffect) return { ok: false, reason: 'no SwarmDrone' }
    bee.emitEffect('keymap:invoke', { cmd: 'mesh.togglePublic', binding: null, event: null })
    return { ok: true }
  }))
}

async function meshState(page) {
  return evalSafe(() => page.evaluate(() => {
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
  }))
}

async function swarmState(page) {
  return evalSafe(() => page.evaluate(() => {
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
  }))
}

async function pubkeyOf(page) {
  return evalSafe(() => page.evaluate(async () => {
    const s = window.ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')
    return s?.getPublicKeyHex ? await s.getPublicKeyHex() : null
  }))
}

async function addTile(page, name) {
  return evalSafe(() => page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input')
      || document.querySelector('input[type="text"]')
    if (!input) return { ok: false, reason: 'no command line input' }
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return { ok: true }
  }, name))
}

async function ownChildren(page) {
  return evalSafe(() => page.evaluate(async () => {
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
  }))
}

/** Where a tile IS on screen. The render's own numbers, inverted: the
 *  forward hex formula (documented in HexDetector) → mesh-local → the
 *  container's global space → client px. Needed because the wand is a
 *  REAL ctrl+press on the canvas, not a synthesized effect — a gesture
 *  that never touches a native pointer proves nothing about the gesture. */
async function tileClientPoint(page, label, offset) {
  return evalSafe(() => page.evaluate(({ name, off: nudge }) => {
    const bus = window.__hypercombEffectBus
    const last = bus?.lastValue
    if (!last) return { ok: false, reason: 'no bus' }
    const host = last.get('render:host-ready')
    const cells = last.get('render:cell-count')
    const off = last.get('render:mesh-offset') ?? { x: 0, y: 0 }
    const flat = !!(last.get('render:set-orientation') ?? {}).flat
    if (!host?.container || !host?.canvas || !host?.renderer) return { ok: false, reason: 'no host' }
    const i = (cells?.labels ?? []).indexOf(name)
    if (i < 0) return { ok: false, reason: 'not rendered', labels: cells?.labels ?? [] }
    const { q, r } = cells.coords[i]
    const detector = window.ioc?.get?.('@diamondcoreprocessor.com/HexDetector')
    const s = detector?.spacing
    if (!s) return { ok: false, reason: 'no detector' }
    const mx = flat ? 1.5 * s * q : Math.sqrt(3) * s * (q + r / 2)
    const my = flat ? Math.sqrt(3) * s * (r + q / 2) : s * 1.5 * r
    const pt = host.container.toGlobal({
      x: mx + off.x + (nudge?.x ?? 0),
      y: my + off.y + (nudge?.y ?? 0),
    })
    const rect = host.canvas.getBoundingClientRect()
    const screen = host.renderer.screen
    return {
      ok: true,
      x: rect.left + pt.x * (rect.width / screen.width),
      y: rect.top + pt.y * (rect.height / screen.height),
    }
  }, { name: label, off: offset ?? null }))
}

/** THE WAND — a real ctrl+press over a witnessed tile. */
async function wandTile(page, label) {
  const at = await tileClientPoint(page, label)
  if (!at.ok) return at
  await page.keyboard.down('Control')
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await sleep(120)
  await page.mouse.up()
  await page.keyboard.up('Control')
  return at
}

/** THE CLICK — a plain left press over a shaded peer tile: it adds the tile
 *  AND walks in. No modifier: this is the gesture a finger performs too. */
async function clickTile(page, label) {
  // ABOVE THE HOVER BAND. The icon block centres on ICON_Y=5 in hex-local
  // units and its buttons cover the hex's exact centre, so a click at the
  // centre lands on an ICON (on a peer tile that is `hide` — which is how an
  // earlier run silently hid the tile it meant to add). Nudge up into the
  // tile body, where a participant aiming at the tile itself clicks.
  const at = await tileClientPoint(page, label, { x: 0, y: -14 })
  if (!at.ok) return at
  await page.mouse.move(at.x, at.y)
  await sleep(80)
  await page.mouse.down()
  await sleep(60)
  await page.mouse.up()
  return at
}

/** Save what the page LOOKS like — the shade is a visual rule, so a run can
 *  hand back the picture as well as the predicate. No-op without --shots. */
async function shot(page, name) {
  if (!SHOTS) return null
  const path = require('path').join(SHOTS, name + '.png')
  try { await page.screenshot({ path }); log('shot', path); return path }
  catch (err) { log('shot', 'failed: ' + String(err).slice(0, 120)); return null }
}

/** Which tiles are dim right now, split by why (swarm vs readiness). */
async function shadeNow(page) {
  return evalSafe(() => page.evaluate(() =>
    window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')?.shadeDebug?.() ?? null))
}

/** Where this client is standing. */
async function locationNow(page) {
  return evalSafe(() => page.evaluate(() =>
    [...(window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])]))
}

/** What the ordinary selection holds — the wand must leave it alone. */
async function selectedNow(page) {
  return evalSafe(() => page.evaluate(() =>
    [...(window.ioc?.get?.('@diamondcoreprocessor.com/SelectionService')?.selected ?? [])]))
}

async function adopt(page, label) {
  return evalSafe(() => page.evaluate((cellLabel) => {
    const bee = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    if (!bee?.emitEffect) return { ok: false, reason: 'no SwarmDrone' }
    bee.emitEffect('tile:action', { action: 'adopt', label: cellLabel, q: 0, r: 0, index: 0 })
    return { ok: true }
  }, label))
}

// Poll instead of sleeping on a guess — a slow relay should read as slow,
// not as broken.
async function waitFor(fn, predicate, timeoutMs, everyMs = 500) {
  const start = Date.now()
  let last = null
  while (Date.now() - start < timeoutMs) {
    last = await evalSafe(fn)
    if (predicate(last)) return { ok: true, value: last, waitedMs: Date.now() - start }
    await sleep(everyMs)
  }
  return { ok: false, value: last, waitedMs: Date.now() - start }
}

// The shell fires router navigations well after boot (and some probes race
// them) — every one destroys the evaluate context mid-flight. Retry the
// probe instead of dying: a destroyed context is a timing artifact of the
// harness, never a swarm verdict.
async function evalSafe(fn, retries = 3) {
  let lastErr = null
  for (let i = 0; i <= retries; i++) {
    try { return await fn() } catch (e) {
      lastErr = e
      const msg = String(e)
      if (!msg.includes('Execution context was destroyed') && !msg.includes('navigation')) throw e
      await sleep(1000)
    }
  }
  throw lastErr
}

/** Navigate a client to an absolute path — the same Navigation service the
 *  shell's own click path rides, so lineage 'change' (and with it the
 *  swarm sync + visit signal) fires exactly like a real gesture. */
async function navTo(page, segments) {
  return evalSafe(() => page.evaluate((segs) => {
    const nav = window.ioc?.get?.('@hypercomb.social/Navigation')
    if (!nav?.go) return { ok: false, reason: 'no Navigation' }
    nav.go(segs)
    return { ok: true }
  }, segments))
}

/** The layer children at an ABSOLUTE path (not the current location). */
async function childrenAt(page, segments) {
  return evalSafe(() => page.evaluate(async (segs) => {
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    if (!history) return { err: 'no history' }
    const sig = await history.sign({ explorerSegments: () => segs })
    const layer = await history.currentLayerAt(sig)
    const names = []
    for (const cs of (Array.isArray(layer?.children) ? layer.children : [])) {
      try { const c = await history.getLayerBySig(cs); if (c?.name) names.push(c.name) } catch { /* skip */ }
    }
    return { names: names.sort() }
  }, segments))
}

/** Peer tile names at the client's CURRENT location. */
async function peerTilesNow(page) {
  return evalSafe(() => page.evaluate(() => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    return (swarm?.peerTilesAtCurrentSig?.() ?? []).map(t => t.name)
  }))
}

/** The visit genome's recorded paths (visit-driven acquisition ledger). */
async function genomePaths(page) {
  return evalSafe(() => page.evaluate(() => {
    try {
      const raw = localStorage.getItem('hc:visit-genome')
      const obj = raw ? JSON.parse(raw) : {}
      return Object.values(obj).map(r => (r.segments ?? []).join('/'))
    } catch { return [] }
  }))
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

  // The FULL set, not just the first arrival: the earlier snapshot race made
  // "only one of two tiles showed" impossible to distinguish from a real
  // rebroadcast loss. Both sides must converge on everything the peer added.
  const fullA = await waitFor(() => swarmState(A.page),
    s => ['charlie', 'delta'].every(n => (s.peerTiles ?? []).some(t => t.name === n)), 60000)
  const fullB = await waitFor(() => swarmState(B.page),
    s => ['alpha', 'bravo'].every(n => (s.peerTiles ?? []).some(t => t.name === n)), 60000)
  check('A converges on B\'s FULL tile set', fullA.ok,
    fullA.ok ? `${fullA.waitedMs}ms` : JSON.stringify(fullA.value?.peerTiles))
  check('B converges on A\'s FULL tile set', fullB.ok,
    fullB.ok ? `${fullB.waitedMs}ms` : JSON.stringify(fullB.value?.peerTiles))

  if (seesA.ok) {
    log('adopt', 'B adopts alpha (programmatic verb — the button is retired)')
    log('B', 'adopt:', JSON.stringify(await adopt(B.page, 'alpha')))
    const folded = await waitFor(() => ownChildren(B.page),
      c => (c.names ?? []).includes('alpha'), 30000)
    check('a swarm tile is adoptable', folded.ok,
      folded.ok ? `${folded.waitedMs}ms` : JSON.stringify(folded.value?.names))
  } else {
    check('a swarm tile is adoptable', false, 'skipped — no swarm tiles arrived')
  }

  // ── THE DRILL TUNNEL — walking a stranger's branch, past the wall ────
  // B builds a deep branch under `delta` (4 levels), then returns to root.
  // B's publish walk only broadcasts MAX_PUBLISH_DEPTH=3 levels below root,
  // so the DEEPEST level is invisible to the initial broadcast — only the
  // drill request/response tunnel (lifecycle-channel ask, publisher answers
  // with that location's layer event) can light it. A then WALKS the path.
  //
  // TAKING IS A GESTURE, NEVER A SIDE EFFECT OF THE URL (2026-08-20): this
  // walk is programmatic (Navigation.go), so A must reach every level
  // WITHOUT holding any of it — the tunnel is driven by the walk, not by
  // ownership — and A's own tree must be untouched when the walk is over.
  // The gestures that DO take are tested after the drill: a real plain
  // CLICK (adds the tile and walks in) and a real ctrl+press (adds without
  // going in).
  if (seesB.ok) {
    log('drill', 'B builds delta/tunnel1/tunnel2/tunnel3/tunnel4, then returns home')
    const levels = ['tunnel1', 'tunnel2', 'tunnel3', 'tunnel4']
    let bAt = ['delta']
    await navTo(B.page, bAt); await sleep(700)
    for (const name of levels) {
      await addTile(B.page, name); await sleep(900)
      bAt = [...bAt, name]
      await navTo(B.page, bAt); await sleep(500)
    }
    await navTo(B.page, []); await sleep(1500)

    // A drills the path level by level. Before each step the tile must be
    // OFFERED at A's current location; after each step it must be FOLDED
    // into A's own layer at the parent.
    const path = ['delta', 'tunnel1', 'tunnel2', 'tunnel3', 'tunnel4']
    let parent = []
    let drillOk = true
    // The wall check must be EARNED: only reaching tunnel4's offer proves the
    // tunnel; an earlier break means the wall was never even tested.
    let wallOk = false
    let detail = ''
    const walked = []
    for (const name of path) {
      const isPastWall = name === 'tunnel4'
      const seen = await waitFor(() => peerTilesNow(A.page), tiles => tiles.includes(name), 60000)
      if (!seen.ok) {
        drillOk = false
        const stages = await evalSafe(() => A.page.evaluate(() => ({
          visit: window.ioc?.get?.('@diamondcoreprocessor.com/SwarmAdoptDrone')?.visitDebug?.() ?? null,
          signal: (window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')?.debug?.() ?? {}).lastVisitSignal ?? null,
          drill: (window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')?.debug?.() ?? {}).lastDrillRequest ?? null,
        }))).catch(() => null)
        detail = `"${name}" never offered at [${parent.join('/')}] — saw ` +
          `${JSON.stringify(seen.value)} stages=${JSON.stringify(stages)}`
        break
      }
      if (isPastWall) { wallOk = true; detail = `deep level offered after ${seen.waitedMs}ms` }
      await navTo(A.page, [...parent, name])
      await sleep(1200)
      walked.push({ parent: [...parent], name })
      parent = [...parent, name]
    }
    check('the drill tunnels past the publisher\'s depth-3 wall', wallOk, detail)
    check('the walk alone reaches every level of a stranger\'s branch', drillOk,
      drillOk ? `path ${parent.join('/')}` : detail)

    // THE WALK KEEPS NOTHING. Every level A just walked must still be
    // somebody else's: nothing in A's own layers, nothing in the genome.
    let keptSomething = null
    for (const step of walked) {
      const mine = await childrenAt(A.page, step.parent)
      if ((mine.names ?? []).includes(step.name)) {
        keptSomething = `"${step.name}" landed in [${step.parent.join('/')}] just from walking`
        break
      }
    }
    const genomeAfterWalk = await genomePaths(A.page)
    const walkedPaths = walked.map(s => [...s.parent, s.name].join('/'))
    const genomeLeak = walkedPaths.filter(p => genomeAfterWalk.includes(p))
    check('a programmatic walk keeps nothing — only a gesture takes', !keptSomething && genomeLeak.length === 0,
      keptSomething || (genomeLeak.length ? `genome recorded ${JSON.stringify(genomeLeak)}` : `${walked.length} levels walked, none kept`))

    // ── THE SHADE IS STANDING, AND A CLICK ADDS THE TILE ──────────────
    // Back at the root with NO modifier held: every tile A doesn't own must
    // already be dim — that is what says "these are somebody else's, and
    // this is what you can add". Then a REAL plain click on `charlie`: it
    // becomes A's AND A walks into it, in one gesture.
    await navTo(A.page, []); await sleep(1500)
    const clickOffered = await waitFor(() => peerTilesNow(A.page),
      tiles => tiles.includes('charlie'), 30000)
    if (clickOffered.ok) {
      const shade = await shadeNow(A.page)
      await shot(A.page, 'swarm-shaded')
      check('a peer\'s tiles are shaded on arrival, no modifier held',
        Array.isArray(shade?.swarm) && shade.swarm.includes('charlie'),
        JSON.stringify(shade))

      // Arm the bus so a miss says WHICH half missed: the click never
      // dispatched (capture silent), a guard ate it (diag:click names the
      // stage), the entry never ran (no tile:navigate-in), or the take never
      // fired (no swarm:wand).
      await evalSafe(() => A.page.evaluate(() => {
        const bus = window.__hypercombEffectBus
        window.__hcClick = { capture: [], diag: [], nav: [], click: [], wand: [] }
        bus.on('diag:click-capture', p => window.__hcClick.capture.push(p))
        bus.on('diag:click', p => window.__hcClick.diag.push(p))
        bus.on('tile:navigate-in', p => window.__hcClick.nav.push(p))
        bus.on('tile:click', p => window.__hcClick.click.push(p))
        bus.on('swarm:wand', p => window.__hcClick.wand.push(p))
      })).catch(() => null)
      const clickAt = await clickTile(A.page, 'charlie')
      const added = await waitFor(() => childrenAt(A.page, []),
        c => (c.names ?? []).includes('charlie'), 30000)
      const clickStages = added.ok ? null : await evalSafe(() => A.page.evaluate((pt) => {
        const cc = window.__hypercombEffectBus?.lastValue?.get('render:cell-count')
        return {
          bus: window.__hcClick ?? null,
          hitTag: pt ? (document.elementFromPoint(pt.x, pt.y) || {}).tagName ?? null : null,
          selected: [...(window.ioc?.get?.('@diamondcoreprocessor.com/SelectionService')?.selected ?? [])],
          rendered: cc?.labels ?? null,
          external: cc?.externalLabels ?? null,
          branch: cc?.branchLabels ?? null,
          visit: window.ioc?.get?.('@diamondcoreprocessor.com/SwarmAdoptDrone')?.visitDebug?.() ?? null,
        }
      }, clickAt.ok ? { x: clickAt.x, y: clickAt.y } : null)).catch(() => null)
      check('a click on a shaded tile ADDS it', added.ok,
        added.ok ? `${added.waitedMs}ms at ${JSON.stringify(clickAt)}`
          : `point=${JSON.stringify(clickAt)} stages=${JSON.stringify(clickStages)}`)

      const where = await waitFor(() => locationNow(A.page),
        segs => Array.isArray(segs) && segs.join('/') === 'charlie', 15000)
      check('the same click walks into the child', where.ok, JSON.stringify(where.value))

      // PERMANENT AND FULLY VISIBLE: back at the root the tile A added is
      // its own — no longer external, so nothing shades it any more.
      await navTo(A.page, []); await sleep(1500)
      const afterShade = await shadeNow(A.page)
      await shot(A.page, 'swarm-after-add')
      check('an added tile stops being shaded — it is yours now',
        Array.isArray(afterShade?.swarm) && !afterShade.swarm.includes('charlie'),
        JSON.stringify(afterShade))
    } else {
      check('a peer\'s tiles are shaded on arrival, no modifier held', false, 'skipped — charlie not offered at root')
      check('a click on a shaded tile ADDS it', false, 'skipped')
      check('the same click walks into the child', false, 'skipped')
      check('an added tile stops being shaded — it is yours now', false, 'skipped')
    }

    // THE CTRL SWEEP TAKES WITHOUT GOING IN. A REAL ctrl+press over the
    // witnessed `delta`: that tile — and only that tile — becomes A's, and
    // A stays where it is.
    const offered = await waitFor(() => peerTilesNow(A.page), tiles => tiles.includes('delta'), 30000)
    if (offered.ok) {
      // Arm a probe on the bus so a miss says WHICH half missed: the
      // gesture (no swarm:wand at all) or the take (event, no fold).
      const pre = await evalSafe(() => A.page.evaluate(() => {
        const bus = window.__hypercombEffectBus
        window.__hcWand = []
        bus.on('swarm:wand', p => window.__hcWand.push(p))
        const cc = bus.lastValue.get('render:cell-count')
        return {
          rendered: (cc?.labels ?? []).includes('delta'),
          external: (cc?.externalLabels ?? []).includes('delta'),
          eligible: window.ioc?.get?.('@diamondcoreprocessor.com/SwarmAdoptDrone')?.wandEligible?.('delta') ?? null,
        }
      })).catch(() => null)
      const at = await wandTile(A.page, 'delta')
      const post = await evalSafe(() => A.page.evaluate((pt) => ({
        events: window.__hcWand ?? null,
        hitTag: pt ? (document.elementFromPoint(pt.x, pt.y) || {}).tagName ?? null : null,
      }), at.ok ? { x: at.x, y: at.y } : null)).catch(() => null)
      log('wand', `pre=${JSON.stringify(pre)} post=${JSON.stringify(post)}`)
      const took = await waitFor(() => childrenAt(A.page, []),
        c => (c.names ?? []).includes('delta'), 30000)
      const stages = took.ok ? null : await evalSafe(() => A.page.evaluate(() => ({
        visit: window.ioc?.get?.('@diamondcoreprocessor.com/SwarmAdoptDrone')?.visitDebug?.() ?? null,
      }))).catch(() => null)
      check('the wand takes the tile under it', took.ok,
        took.ok ? `${took.waitedMs}ms at ${JSON.stringify(at)}`
          : `point=${JSON.stringify(at)} pre=${JSON.stringify(pre)} post=${JSON.stringify(post)} stages=${JSON.stringify(stages)}`)

      // THE ITEM, NOT ITS CHILDREN: delta's own children stay the
      // publisher's until A walks in and wands them there too.
      const inside = await childrenAt(A.page, ['delta'])
      check('the wand takes the ITEM, never its children', (inside.names ?? []).length === 0,
        JSON.stringify(inside.names ?? inside))

      // SELECT STANDS DOWN: the same press must not also build a selection.
      const sel = await selectedNow(A.page)
      check('the wand suppresses the ordinary select', Array.isArray(sel) && sel.length === 0,
        JSON.stringify(sel))

      const genome = await genomePaths(A.page)
      check('what the wand took is recorded in the visit genome', genome.includes('delta'),
        `records: ${JSON.stringify(genome)}`)

      // THE SWEEP DOESN'T TRAVEL: taking with ctrl leaves A standing where
      // it was — that is the whole difference from the click, which adds the
      // tile by walking into it.
      const stayed = await locationNow(A.page)
      check('the ctrl sweep takes without going in', Array.isArray(stayed) && stayed.length === 0,
        JSON.stringify(stayed))
    } else {
      check('the wand takes the tile under it', false, 'skipped — delta not offered at root')
      check('the wand takes the ITEM, never its children', false, 'skipped')
      check('the wand suppresses the ordinary select', false, 'skipped')
      check('what the wand took is recorded in the visit genome', false, 'skipped')
      check('the ctrl sweep takes without going in', false, 'skipped')
    }
  } else {
    check('the drill tunnels past the publisher\'s depth-3 wall', false, 'skipped — no swarm tiles arrived')
    check('the walk alone reaches every level of a stranger\'s branch', false, 'skipped')
    check('a programmatic walk keeps nothing — only a gesture takes', false, 'skipped')
    check('a peer\'s tiles are shaded on arrival, no modifier held', false, 'skipped')
    check('a click on a shaded tile ADDS it', false, 'skipped')
    check('the same click walks into the child', false, 'skipped')
    check('an added tile stops being shaded — it is yours now', false, 'skipped')
    check('the wand takes the tile under it', false, 'skipped')
    check('the wand takes the ITEM, never its children', false, 'skipped')
    check('the wand suppresses the ordinary select', false, 'skipped')
    check('what the wand took is recorded in the visit genome', false, 'skipped')
    check('the ctrl sweep takes without going in', false, 'skipped')
  }

  // ── WEBSITES BELONG TO A TILE — the attachment at intent time ────────
  // B flags a tile with /website here: the flag names a new site root, so
  // ensureWebsiteBoundAt attaches visual:website:page to that location
  // (hc:behavior-bound) before any page exists. Swarm-independent.
  await navTo(B.page, ['charlie']); await sleep(1200)
  await addTile(B.page, '/website here'); await sleep(1500)
  const bound = await evalSafe(() => B.page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('hc:behavior-bound') ?? '{}') } catch { return {} }
  }))
  const sitePaths = (bound?.['visual:website:page'] ?? []).map(b => b?.path)
  check('a flagged site root attaches to its tile (websites belong to a tile)',
    sitePaths.includes('/charlie'), JSON.stringify(bound))

  // (The per-tile FEATURES icon that a bound behaviour earns is a local
  // behaviour, not a swarm one — it has its own harness:
  // scripts/drive-tile-behavior-icon.cjs.)

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
      const m = await evalSafe(() => meshState(C.page))
      const s = await evalSafe(() => swarmState(C.page))
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
