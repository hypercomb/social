// Throwaway audit: GROUP NAVIGATION UNION + PARTICIPANT-GROUPED ADOPTION.
//
// Three participants share a session at root:
//   A authors alpha1 + shared        (label "Alice")
//   B authors bravo1 + shared        (overlapping name on purpose)
//   C joins last, authors nothing    (the adopter's seat)
//
// PASS criteria:
//   1. UNION       — A's peer cache carries B's {bravo1, shared}; B's carries
//                    A's {alpha1, shared}. Each hive renders local ∪ peers, so
//                    everyone sees {alpha1, bravo1, shared}.
//   2. OVERLAP     — C's grouped accessor returns BOTH copies of 'shared'
//                    (one per publisher group) — overlapping names are allowed,
//                    each participant's version stays adoptable even though
//                    only the top copy renders on canvas.
//   3. PANEL       — emitting tile:action {adopt, shared} on C opens the
//                    swarm-adopt-panel with one group per publisher and the
//                    top copy of 'shared' preselected; clicking confirm fires
//                    portal:open with that publisher's layerSig.
//   4. EN MASSE    — tile:action {adopt-selected, [(alpha1,A),(bravo1,B),
//                    (shared,B)]} fires three portal:open handoffs, and the
//                    'shared' one carries B's layerSig (pubkey-pinned), not
//                    the top publisher's.
//
// Run: node audit-swarm-union-adopt.cjs   (from hypercomb-relay/, dev shell on 4250)

const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { join } = require('node:path')

const RELAY_DIR = __dirname
const RELAY_JS = join(RELAY_DIR, 'relay.js')
const RELAY_PORT = 7797
const RELAY = `ws://localhost:${RELAY_PORT}`
const URL = 'http://localhost:4250/'
const ROOM = 'sua-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)

const ts = () => new Date().toISOString().slice(11, 23)
const log = (tag, ...a) => console.log(`[${ts()}] [${tag}]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const names = (arr) => [...new Set((arr || []).map((t) => t.name))].sort()

let relay
async function startRelay() {
  relay = spawn('node', [RELAY_JS, '--port', String(RELAY_PORT), '--memory'], { cwd: RELAY_DIR, stdio: ['ignore', 'pipe', 'pipe'] })
  relay.stderr.on('data', (d) => process.stderr.write('[relay-err] ' + d))
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${RELAY_PORT}/`)).ok) return } catch {} await sleep(100) }
}

async function newBrowser() {
  // Software WebGL — headless Chromium on a GPU-less session otherwise
  // fails Pixi's shader compile (logPrettyShaderError loop) and the
  // canvas never draws a frame, which poisons the rendered-union
  // assertions with an environment artifact.
  const b = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const p = await (await b.newContext()).newPage()
  return { b, p }
}
const clearOpfs = (page) => page.evaluate(async () => {
  const root = await navigator.storage.getDirectory()
  for await (const [n] of root.entries()) await root.removeEntry(n, { recursive: true }).catch(() => null)
})
const configure = (page) => page.evaluate(({ room, secret, relay }) => {
  localStorage.setItem('hc:room', room)
  localStorage.setItem('hc:secret', secret)
  localStorage.setItem('hc:mesh-public', 'true')
  localStorage.setItem('hc:nostrmesh:network', '1')
  localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
  localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([relay]))
}, { room: ROOM, secret: SECRET, relay: RELAY })
async function waitForReady(page, t = 30000) {
  const s = Date.now()
  while (Date.now() - s < t) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone') &&
      window.ioc?.get?.('@hypercomb.social/Navigation')
    ))
    if (ok) return true
    await sleep(250)
  }
  return false
}
const addTile = (page, name) => page.evaluate(async (n) => {
  const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
  if (!input) return false
  input.focus(); input.value = n; input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 100))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
  return true
}, name)
const peerTiles = (page) => page.evaluate(async () => {
  const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
  if (!swarm?.composeSigForSegments || !swarm?.peerTilesAtSig) return null
  const sig = await swarm.composeSigForSegments([])
  return (swarm.peerTilesAtSig(sig) ?? []).map((t) => ({
    name: t.name, pubkey: t.peerPubkey, layerSig: t.layerSig ?? null,
  }))
})
const grouped = (page) => page.evaluate(() => {
  const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
  if (!swarm?.peerTilesGroupedAtCurrentSig) return null
  return swarm.peerTilesGroupedAtCurrentSig().map((g) => ({
    pubkey: g.pubkey, label: g.label,
    tiles: g.tiles.map((t) => ({ name: t.name, layerSig: t.layerSig ?? null })),
  }))
})
// What the CANVAS actually renders — not the swarm cache. EffectBus
// replays the last 'render:cell-count' to late subscribers, so this
// resolves immediately with the most recent render's labels. The
// cache-only assertion missed a real-world break where peer visuals
// were cached but never surfaced on screen.
const renderedLabels = (page) => page.evaluate(() => new Promise((resolve) => {
  const bus = globalThis.__hypercombEffectBus
  if (!bus?.on) return resolve(null)
  let done = false
  const finish = (v) => { if (!done) { done = true; resolve(v) } }
  bus.on('render:cell-count', (p) => finish((p?.labels ?? []).filter(Boolean)))
  setTimeout(() => finish(null), 3000)
}))

async function main() {
  await startRelay(); log('boot', `mesh relay ${RELAY} | dev shell ${URL} | room ${ROOM}`)
  const failures = []

  // ── A: first participant, labeled, authors alpha1 + shared ──
  const A = await newBrowser()
  A.p.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' || t.includes('[show-cell]') || t.includes('WebGL') || t.includes('render')) log('A-console', `${m.type()}: ${t.slice(0, 200)}`)
  })
  A.p.on('pageerror', (e) => log('A-pageerror', String(e).slice(0, 300)))
  await A.p.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(A.p); await configure(A.p); await A.p.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.p))) { log('A', 'TIMEOUT — not ready'); process.exit(2) }
  await A.p.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')?.setMyLabel?.('Alice'))
  await sleep(2000)
  await addTile(A.p, 'alpha1'); await sleep(700); await addTile(A.p, 'shared'); await sleep(1500)
  log('A', 'authored alpha1 + shared')

  // ── B: second participant, authors bravo1 + shared (overlap) ──
  const B = await newBrowser()
  await B.p.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(B.p); await configure(B.p); await B.p.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.p))) { log('B', 'TIMEOUT — not ready'); process.exit(2) }
  await sleep(2000)
  await addTile(B.p, 'bravo1'); await sleep(700); await addTile(B.p, 'shared'); await sleep(1500)
  log('B', 'authored bravo1 + shared (name overlap with A)')

  // ── 1. UNION: poll each side until the other's tiles land ──
  let aSees = [], bSees = []
  const t0 = Date.now()
  while (Date.now() - t0 < 25000) {
    aSees = (await peerTiles(A.p)) ?? []
    bSees = (await peerTiles(B.p)) ?? []
    if (names(aSees).includes('bravo1') && names(aSees).includes('shared') &&
        names(bSees).includes('alpha1') && names(bSees).includes('shared')) break
    await sleep(500)
  }
  log('A', `peer union at root: ${JSON.stringify(names(aSees))}`)
  log('B', `peer union at root: ${JSON.stringify(names(bSees))}`)
  if (!(names(aSees).includes('bravo1') && names(aSees).includes('shared'))) failures.push('UNION: A missing B tiles (wants bravo1+shared)')
  if (!(names(bSees).includes('alpha1') && names(bSees).includes('shared'))) failures.push('UNION: B missing A tiles (wants alpha1+shared)')

  // ── 1b. RENDERED UNION: the canvas must show local ∪ peers, not just
  //        the cache. Poll — renders trail peers-changed by a debounce.
  const fullUnion = ['alpha1', 'bravo1', 'shared']
  let aDrawn = null, bDrawn = null
  const tr = Date.now()
  while (Date.now() - tr < 20000) {
    aDrawn = await renderedLabels(A.p)
    bDrawn = await renderedLabels(B.p)
    const has = (arr, want) => Array.isArray(arr) && want.every((w) => arr.includes(w))
    if (has(aDrawn, fullUnion) && has(bDrawn, fullUnion)) break
    await sleep(700)
  }
  log('A', `canvas renders: ${JSON.stringify(aDrawn)}`)
  log('B', `canvas renders: ${JSON.stringify(bDrawn)}`)
  await A.p.screenshot({ path: 'audit-A-canvas.png' }).catch(() => null)
  await B.p.screenshot({ path: 'audit-B-canvas.png' }).catch(() => null)
  if (aDrawn === null || bDrawn === null) {
    failures.push('RENDERED UNION: render:cell-count never observed — canvas not rendering in this environment')
  } else {
    for (const w of fullUnion) {
      if (!aDrawn.includes(w)) failures.push(`RENDERED UNION: A's canvas missing '${w}'`)
      if (!bDrawn.includes(w)) failures.push(`RENDERED UNION: B's canvas missing '${w}'`)
    }
    const aShared = aDrawn.filter((l) => l === 'shared').length
    const bShared = bDrawn.filter((l) => l === 'shared').length
    if (aShared !== 1) failures.push(`RENDERED UNION: 'shared' drawn ${aShared}× on A, want exactly 1 (top tile only)`)
    if (bShared !== 1) failures.push(`RENDERED UNION: 'shared' drawn ${bShared}× on B, want exactly 1 (top tile only)`)
  }

  // ── C: third participant, joins last, authors nothing ──
  const C = await newBrowser()
  C.p.on('console', (m) => {
    const t = m.text()
    if (t.includes('[swarm] onEvent') || t.includes('late-join recovery')) log('C-console', t.slice(0, 180))
  })
  await C.p.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(C.p); await configure(C.p); await C.p.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(C.p))) { log('C', 'TIMEOUT — not ready'); process.exit(2) }

  // ── 2. OVERLAP: C's grouped view must carry 'shared' once per publisher ──
  let groups = []
  const t1 = Date.now()
  while (Date.now() - t1 < 25000) {
    groups = (await grouped(C.p)) ?? []
    const withShared = groups.filter((g) => g.tiles.some((t) => t.name === 'shared'))
    if (groups.length >= 2 && withShared.length >= 2) break
    await sleep(500)
  }
  log('C', `groups: ${JSON.stringify(groups.map((g) => ({ who: g.label || g.pubkey.slice(0, 8), tiles: g.tiles.map((t) => t.name) })))}`)
  log('C', `swarm debug: ${JSON.stringify(await C.p.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')?.debug?.()))}`)
  const sharedGroups = groups.filter((g) => g.tiles.some((t) => t.name === 'shared'))
  if (groups.length < 2) failures.push(`OVERLAP: expected 2 participant groups on C, got ${groups.length}`)
  if (sharedGroups.length < 2) failures.push(`OVERLAP: 'shared' present in ${sharedGroups.length} group(s), want one per publisher (2)`)
  const aliceGroup = groups.find((g) => g.label === 'Alice')
  if (!aliceGroup) log('C', 'note: label "Alice" not yet propagated (pubkey fallback displays instead)')

  const aPk = groups.find((g) => g.tiles.some((t) => t.name === 'alpha1'))?.pubkey
  const bPk = groups.find((g) => g.tiles.some((t) => t.name === 'bravo1'))?.pubkey

  // (pubkey,name) → layerSig from C's LIVE cache. The adopt drone reads
  // the cache at handoff time, and freshness rotation between an audit
  // snapshot and the click would make stale-sig comparisons racy.
  const cacheMap = () => C.p.evaluate(async () => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const sig = await swarm.composeSigForSegments([])
    const out = {}
    for (const t of (swarm.peerTilesAtSig(sig) ?? [])) out[`${t.peerPubkey} ${t.name}`] = t.layerSig ?? null
    return out
  })

  // ── 3. PANEL: adopt gesture on C opens the grouped panel, confirm hands off ──
  await C.p.evaluate(() => {
    window.__portals = []
    window.addEventListener('portal:open', (e) => window.__portals.push(e.detail))
  })
  await C.p.evaluate(() => {
    const swarm = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.emitEffect?.('tile:action', { action: 'adopt', label: 'shared' })
  })
  await sleep(800)
  const panel = await C.p.evaluate(() => {
    const root = document.querySelector('hc-swarm-adopt-panel')
    const open = !!document.querySelector('.adopt-panel')
    const groupCount = document.querySelectorAll('.adopt-group').length
    const checked = document.querySelectorAll('.adopt-tile.selected').length
    const confirmDisabled = document.querySelector('.adopt-btn.confirm')?.disabled ?? null
    return { mounted: !!root, open, groupCount, checked, confirmDisabled }
  })
  log('C', `panel after adopt gesture: ${JSON.stringify(panel)}`)
  if (panel.open) await C.p.screenshot({ path: 'audit-swarm-adopt-panel.png' }).catch(() => null)
  if (!panel.mounted) failures.push('PANEL: hc-swarm-adopt-panel not mounted in dev shell')
  if (!panel.open) failures.push('PANEL: did not open on adopt gesture')
  if (panel.open && panel.groupCount < 2) failures.push(`PANEL: ${panel.groupCount} group(s) shown, want 2`)
  if (panel.open && panel.checked !== 1) failures.push(`PANEL: preselect checked ${panel.checked} tile(s), want exactly 1 (top copy of 'shared')`)

  if (panel.open && !panel.confirmDisabled) {
    // Which participant's copy did the panel preselect? Read it from the
    // DOM (the group box holding the checked tile) so the assertion
    // follows the panel's actual pick even if freshness order rotated
    // since our snapshot above.
    const selectedWho = await C.p.evaluate(() => {
      for (const g of document.querySelectorAll('.adopt-group')) {
        if (g.querySelector('.adopt-tile.selected')) return g.querySelector('.who')?.textContent?.trim() ?? null
      }
      return null
    })
    // The publisher may republish a cascaded layerSig at any moment, so
    // sample the cache on BOTH sides of the click — the handoff is
    // correct if it carries whichever value was current when it read.
    const preClickCache = await cacheMap()
    await C.p.click('.adopt-btn.confirm')
    await sleep(800)
    const portals = await C.p.evaluate(() => window.__portals)
    const postClickCache = await cacheMap()
    log('C', `panel selected "${selectedWho}"; handoffs: ${JSON.stringify(portals.map((d) => ({ label: d.label, sig: (d.branchSig || '').slice(0, 12) })))}`)
    if (portals.length !== 1) failures.push(`PANEL CONFIRM: ${portals.length} portal:open events, want 1`)
    else {
      const selPk = groups.find((g) => (g.label || g.pubkey.slice(0, 8)) === selectedWho)?.pubkey
        ?? (await grouped(C.p))?.find((g) => (g.label || g.pubkey.slice(0, 8)) === selectedWho)?.pubkey
      const accepted = selPk
        ? [preClickCache[`${selPk} shared`], postClickCache[`${selPk} shared`]].filter(Boolean)
        : []
      if (accepted.length > 0 && !accepted.includes(portals[0].branchSig)) {
        failures.push(`PANEL CONFIRM: branchSig ${portals[0].branchSig?.slice(0, 12)} matches neither the selected participant's pre-click nor post-click shared layerSig (${accepted.map((s) => s.slice(0, 12)).join(', ')})`)
      }
    }
  }

  // ── 4. EN MASSE: pubkey-pinned adopt-selected fires one handoff per pick ──
  if (aPk && bPk) {
    await C.p.evaluate(() => { window.__portals = [] })
    const preEmitCache = await cacheMap()
    await C.p.evaluate(({ aPk, bPk }) => {
      const swarm = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
      swarm?.emitEffect?.('tile:action', {
        action: 'adopt-selected',
        selections: [
          { label: 'alpha1', pubkey: aPk },
          { label: 'bravo1', pubkey: bPk },
          { label: 'shared', pubkey: bPk },
        ],
      })
    }, { aPk, bPk })
    await sleep(1200)
    const portals = await C.p.evaluate(() => window.__portals)
    log('C', `en-masse handoffs: ${JSON.stringify(portals.map((d) => ({ label: d.label, sig: (d.branchSig || '').slice(0, 12) })))}`)
    if (portals.length !== 3) failures.push(`EN MASSE: ${portals.length} portal:open events, want 3`)
    const sharedPortal = portals.find((d) => d.label === 'shared')
    const postEmitCache = await cacheMap()
    const acceptedBShared = [preEmitCache[`${bPk} shared`], postEmitCache[`${bPk} shared`]].filter(Boolean)
    if (acceptedBShared.length > 0 && sharedPortal && !acceptedBShared.includes(sharedPortal.branchSig)) {
      failures.push(`EN MASSE: shared handoff ${sharedPortal.branchSig?.slice(0, 12)} did not pin to B's layerSig (${acceptedBShared.map((s) => s.slice(0, 12)).join(', ')}) — pubkey disambiguation broken`)
    }
  } else {
    failures.push('EN MASSE: could not resolve A/B pubkeys from groups — skipped')
  }

  // ── verdict ──
  console.log('')
  if (failures.length === 0) {
    log('PASS', 'union, overlap-per-publisher, grouped panel, en-masse pubkey-pinned adoption all verified')
  } else {
    log('FAIL', `${failures.length} assertion(s):`)
    for (const f of failures) console.log('  ✗ ' + f)
  }

  await A.b.close().catch(() => null)
  await B.b.close().catch(() => null)
  await C.b.close().catch(() => null)
  relay?.kill()
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((err) => { console.error(err); relay?.kill(); process.exit(2) })
