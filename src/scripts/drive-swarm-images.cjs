// scripts/drive-swarm-images.cjs
//
// A PICTURE CROSSES THE PUBLIC MESH. Two participants, own browser each, one
// zone. A DROPS a real photo (a noisy PNG, far larger than one relay event)
// on empty canvas and names the tile — the same drop door a person uses, so
// the picture goes through the 346x400 WebP chokepoint. B must hear the
// picture's sig in A's visual, hold the same bytes locally, and have its
// render resolve the tile's picture — Store → broker → mesh, sha256-gated.
// This is the path that carried nothing for weeks (the Store could not name
// the broker) and then refused every real-sized picture.
//
// Noise does not compress, so the captured WebP lands above one 192 KB chunk
// and the run also proves the chunked response path. A real photo captured
// at this box is a few tens of KB and crosses in a single event.
//
//   node scripts/drive-swarm-images.cjs --relay ws://localhost:7777 [--kb 1500]

const H = require('./drive-swarm-connectivity.cjs')

const KB = Number((() => { const i = process.argv.indexOf('--kb'); return i >= 0 ? process.argv[i + 1] : 1500 })())
const zone = { room: `images-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: { 'hc:swarm:sticky': '1' } }

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

/** Drop a genuine ~kb KB PNG on EMPTY canvas — the image-drop door arms the
 *  command line; naming the tile then creates it with the picture. */
const dropPhoto = (c, kb) => H.evalSafe(() => c.page.evaluate(async (kb) => {
  const side = Math.ceil(Math.sqrt(kb * 1024 / 3))
  const canvas = new OffscreenCanvas(side, side)
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(side, side)
  // getRandomValues caps a single call at 64 KB — fill in slices.
  for (let at = 0; at < img.data.length; at += 65536) crypto.getRandomValues(img.data.subarray(at, Math.min(img.data.length, at + 65536)))
  ctx.putImageData(img, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  const file = new File([blob], 'photo.png', { type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(file)
  // No dragover first, so the drop has no tile target and takes the "arm the
  // command line" path.
  const target = document.querySelector('canvas') ?? document.body
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 40, clientY: window.innerHeight - 60 }))
  return { size: blob.size, side }
}, kb))

// The core EffectBus replays its last value to a late subscriber, so this can
// be asked after the drop and still see the arm.
const armed = (c) => H.evalSafe(() => c.page.evaluate(() => new Promise((resolve) => {
  const bus = globalThis.__hypercombEffectBus
  if (!bus || !bus.on) return resolve(null)
  let done = false
  let off = null
  off = bus.on('command:arm-resource', (p) => { if (done) return; done = true; if (off) off(); resolve(p ? { smallPointSig: p.smallPointSig, largeSig: p.largeSig } : null) })
  setTimeout(() => { if (!done) { done = true; if (off) off(); resolve(null) } }, 1500)
})))

// Both sides read the picture BEHIND a sig the same way — through the Store's
// own envelope-following resolver — and report size, type and decoded size.
const PICTURE_BEHIND = `async (store, sig) => {
  if (!sig) return null
  const blob = await store.getResourceResolvedLocal(sig)
  if (!blob) return null
  let dims = null
  try { const b = await createImageBitmap(blob); dims = b.width + 'x' + b.height; b.close() } catch { dims = 'undecodable' }
  return { size: blob.size, type: blob.type, dims }
}`

const ownPicture = (c, label) => H.evalSafe(() => c.page.evaluate(async ({ label, helper }) => {
  const pictureBehind = eval('(' + helper + ')')
  const store = window.ioc.get('@hypercomb.social/Store')
  const show = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
  const cached = (show && show.cellImageCache && show.cellImageCache.get(label)) || null
  return { sig: cached, picture: await pictureBehind(store, cached) }
}, { label, helper: PICTURE_BEHIND }))

const peerPicture = (c, label) => H.evalSafe(() => c.page.evaluate(async ({ label, helper }) => {
  const pictureBehind = eval('(' + helper + ')')
  const swarm = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
  const tile = ((swarm && swarm.peerTilesAtCurrentSig && swarm.peerTilesAtCurrentSig()) || []).find(t => t.name === label)
  const show = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
  const cached = (show && show.cellImageCache && show.cellImageCache.get(label)) || null
  const store = window.ioc.get('@hypercomb.social/Store')
  const atlas = show && show.imageAtlas
  return { announced: (tile && tile.imageSig) || null, cached, picture: await pictureBehind(store, cached), inAtlas: cached && atlas && atlas.hasImage ? atlas.hasImage(cached) : null }
}, { label, helper: PICTURE_BEHIND }))

;(async () => {
  const a = await boot('A'), b = await boot('B')
  const drop = await dropPhoto(a, KB)
  H.log('A', `dropped a ${drop.size}-byte ${drop.side}x${drop.side} PNG`)
  const arm = await H.waitFor(() => armed(a), v => !!(v && v.smallPointSig), 30000, 250)
  H.check('the drop door captured a small picture', arm.ok, arm.waitedMs + 'ms')
  await H.addTile(a.page, 'pic')

  const own = await H.waitFor(() => ownPicture(a, 'pic'), p => !!(p && p.picture && p.picture.dims), 20000, 250)
  H.check("A's tile carries the picture", own.ok, JSON.stringify(own.value))
  const v = (own.value && own.value.picture) || {}
  H.check('the stored picture is the 346x400 WebP', v.dims === '346x400' && v.type === 'image/webp', v.dims + ' ' + v.type + ' ' + v.size + ' bytes' + (v.size > 192 * 1024 ? ' (over one chunk: noise; a photo is far smaller)' : ''))

  const seen = await H.waitFor(() => H.peerTilesNow(b.page), t => t.includes('pic'), 30000)
  H.check("B sees A's tile", seen.ok, seen.waitedMs + 'ms')
  const t0 = Date.now()
  const heard = await H.waitFor(() => peerPicture(b, 'pic'), p => !!(p && p.announced), 30000, 250)
  H.check("B hears the picture sig in A's visual", heard.ok, heard.waitedMs + 'ms')
  const landed = await H.waitFor(() => peerPicture(b, 'pic'), p => !!(p && p.picture && p.picture.size === v.size && p.picture.dims === v.dims), 45000, 500)
  H.check('B holds the same picture bytes locally', landed.ok, (Date.now() - t0) + 'ms after the tile appeared; ' + JSON.stringify(landed.value && landed.value.picture))
  const painted = await H.waitFor(() => peerPicture(b, 'pic'), p => !!(p && p.inAtlas === true), 20000, 500)
  H.check("B's render resolved the tile picture", painted.ok, 'inAtlas=' + (painted.value && painted.value.inAtlas))

  console.log('\n========== images ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
