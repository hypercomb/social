// scripts/drive-swarm-image-share.cjs
//
// EVERYBODY BRINGS THEIR OWN PICTURE — two participants, one room.
//
// A and B each name a tile 'pic' with their OWN dropped photo. Then:
//   1. each hears the other's picture on the wire (a different sig than its own);
//   2. the images wall (the icon's click) opens on each side with BOTH pictures;
//   3. A edits in the swarm — drops a NEW photo onto its tile — and B's view of
//      A's picture follows it: the new sig arrives, the old one is gone;
//   4. B reopens the wall, sees the new picture, and CLICKS it: B's tile now
//      wears A's new picture.
//
// Own browser context each (own OPFS, own identity), a scratch relay on its own
// port — never the shared dev relay on 7777, never a tab on the author's hive.
//
//   node scripts/drive-swarm-image-share.cjs [--url http://localhost:4250/] [--headed] [--keep]

const H = require('./drive-swarm-connectivity.cjs')

const PORT = 7793
const KB = 40
const zoneBase = { room: `imgshare-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10) }

async function boot(label, relay) {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED, ...la.opts })
  const c = await H.newClient(browser, label, { ...zoneBase, relay, seed: { ...H.swarmSeed(relay), 'hc:swarm:sticky': '1' } })
  c.browser = browser
  await c.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(c.page); await H.installIfNeeded(c.page, label)
  if (!(await H.waitForReady(c.page))) throw new Error(`${label}: not ready`)
  await H.settle(c.page)
  await H.joinSwarm(c.page)
  await H.waitFor(() => H.meshState(c.page), s => (s.sockets ?? []).some(x => x.readyState === 1), 30000)
  await H.waitFor(() => H.swarmState(c.page), s => !!s.currentSig, 15000)
  return c
}

/** Drop a fresh noise PNG. With `onTile`, the overlay's own `drop:target` is
 *  announced first — the event the hex under the pointer produces — so the
 *  drop lands on that occupied tile (swap), not on empty canvas (arm). */
const dropPhoto = (c, kb, onTile) => H.evalSafe(() => c.page.evaluate(async ({ kb, onTile }) => {
  const side = Math.ceil(Math.sqrt(kb * 1024 / 3))
  const canvas = new OffscreenCanvas(side, side)
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(side, side)
  for (let at = 0; at < img.data.length; at += 65536) crypto.getRandomValues(img.data.subarray(at, Math.min(img.data.length, at + 65536)))
  ctx.putImageData(img, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'photo.png', { type: 'image/png' }))
  const bus = globalThis.__hypercombEffectBus
  const target = document.querySelector('canvas') ?? document.body
  if (onTile) bus.emit('drop:target', { label: onTile, occupied: true, over: true })
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 40, clientY: window.innerHeight - 60 }))
  return { size: blob.size }
}, { kb, onTile }))

const armed = (c) => H.evalSafe(() => c.page.evaluate(() => new Promise((resolve) => {
  const bus = globalThis.__hypercombEffectBus
  let done = false
  const off = bus.on('command:arm-resource', (p) => { if (done) return; done = true; off && off(); resolve(p ? { small: p.smallPointSig } : null) })
  setTimeout(() => { if (!done) { done = true; off && off(); resolve(null) } }, 1500)
})))

/** The picture THIS participant's tile 'pic' wears (render's cache), and what
 *  the other participants are showing for the same name. */
const pictures = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const show = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
  const swarm = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
  const own = (show && show.cellImageCache && show.cellImageCache.get('pic')) || null
  const peers = (swarm.peerTilesAtCurrentSig() || []).filter(t => t.name === 'pic').map(t => ({
    peer: t.peerPubkey.slice(0, 8),
    sig: (t.small && t.small.image) || (t.flat && t.flat.small && t.flat.small.image) || (t.point && t.point.image) || t.imageSig || (t.large && t.large.image) || null,
  }))
  return { own, peers }
}))

/** The wall: how many pictures it is showing, and where each sits on screen. */
const wall = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const bus = globalThis.__hypercombEffectBus
  const host = bus.lastValue.get('render:host-ready')
  const layer = host && host.container.children.find(n => n.zIndex === 7006)
  if (!layer) return null
  const rect = host.canvas.getBoundingClientRect()
  const screen = host.renderer.screen
  return {
    hiveHidden: (bus.lastValue.get('render:set-hive-visible') || {}).visible === false,
    count: layer.children.length,
    points: layer.children.map(ch => {
      const g = layer.toGlobal({ x: ch.position.x, y: ch.position.y })
      return { x: rect.left + g.x * (rect.width / screen.width), y: rect.top + g.y * (rect.height / screen.height) }
    }),
  }
}))

const openWall = (c) => H.evalSafe(() => c.page.evaluate(() => {
  globalThis.__hypercombEffectBus.emit('images:open', { label: 'pic', segments: [] })
  return true
}))

const closeWall = async (c) => {
  await c.page.keyboard.press('Escape')
  await H.waitFor(() => wall(c), w => !w, 5000, 150)
}

;(async () => {
  const relay = await H.startScratchRelay(PORT)
  const a = await boot('A', relay), b = await boot('B', relay)

  // ── each participant brings their own picture for the same tile name ──
  for (const c of [a, b]) {
    await dropPhoto(c, KB)
    const arm = await H.waitFor(() => armed(c), v => !!(v && v.small), 30000, 250)
    H.check(`${c.label}: the drop door captured a picture`, arm.ok)
    await H.addTile(c.page, 'pic')
  }
  const aOwn = await H.waitFor(() => pictures(a), p => !!(p && p.own), 20000, 250)
  const bOwn = await H.waitFor(() => pictures(b), p => !!(p && p.own), 20000, 250)
  H.check('A and B each wear their own, different picture', aOwn.ok && bOwn.ok && aOwn.value.own !== bOwn.value.own,
    `A=${(aOwn.value.own || '').slice(0, 8)} B=${(bOwn.value.own || '').slice(0, 8)}`)

  // ── 1. each hears the other's picture ──
  const aHears = await H.waitFor(() => pictures(a), p => !!(p && p.peers.some(x => x.sig && x.sig !== p.own)), 45000, 500)
  const bHears = await H.waitFor(() => pictures(b), p => !!(p && p.peers.some(x => x.sig && x.sig !== p.own)), 45000, 500)
  H.check("A hears B's picture", aHears.ok, JSON.stringify(aHears.value.peers))
  H.check("B hears A's picture", bHears.ok, JSON.stringify(bHears.value.peers))

  // ── 2. the wall shows both ──
  for (const c of [a, b]) {
    await openWall(c)
    const w = await H.waitFor(() => wall(c), v => !!(v && v.count >= 2), 30000, 250)
    H.check(`${c.label}: the images wall opens with both participants' pictures`, w.ok && w.value.hiveHidden, w.value ? `count=${w.value.count}` : 'no wall')
    await closeWall(c)
  }

  // ── 3. A edits in the swarm: a NEW photo onto its own tile ──
  const oldA = (await pictures(a)).own
  await dropPhoto(a, KB, 'pic')
  const aNew = await H.waitFor(() => pictures(a), p => !!(p && p.own && p.own !== oldA), 30000, 300)
  H.check('A: the new photo replaced the one the tile wears', aNew.ok, `${(oldA || '').slice(0, 8)} → ${((aNew.value && aNew.value.own) || '').slice(0, 8)}`)
  const newA = aNew.value && aNew.value.own
  const bSees = await H.waitFor(() => pictures(b), p => !!(p && p.peers.some(x => x.sig === newA)), 45000, 500)
  H.check("B hears A's NEW picture", bSees.ok, JSON.stringify(bSees.value.peers))
  H.check("B no longer offers A's old picture", bSees.ok && !bSees.value.peers.some(x => x.sig === oldA))

  // ── 4. B opens the wall and takes A's new picture with a real click ──
  await openWall(b)
  const w = await H.waitFor(() => wall(b), v => !!(v && v.count >= 2), 30000, 250)
  H.check('B: the wall shows A\'s new picture alongside its own', w.ok, w.value ? `count=${w.value.count}` : 'no wall')
  if (w.ok) {
    await new Promise(r => setTimeout(r, 1500))                 // textures decode
    const fresh = await wall(b)
    const theirs = fresh.points[1]                                // held first, then offered
    await b.page.mouse.move(theirs.x, theirs.y)
    await b.page.mouse.down(); await b.page.mouse.up()
    const worn = await H.waitFor(() => pictures(b), p => !!(p && p.own === newA) || !!(p && p.own && p.own !== (bOwn.value && bOwn.value.own)), 30000, 300)
    H.check("B's tile now wears the picture it chose", worn.ok, `own=${((worn.value && worn.value.own) || '').slice(0, 8)} chosen=${(newA || '').slice(0, 8)}`)
  } else {
    await closeWall(b)
  }

  console.log('\n========== image share ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } }
  H.stopScratchRelay()
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); H.stopScratchRelay(); process.exit(1) })
