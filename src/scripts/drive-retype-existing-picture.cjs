// scripts/drive-retype-existing-picture.cjs
//
// Typing the name of a tile that ALREADY EXISTS (and has a picture) must show
// that picture at once, not blank until a reload. Probes show-cell's own
// caches (headless has no GPU, so there are no pixels to read).
//
//   node scripts/drive-retype-existing-picture.cjs [--url http://localhost:4250/]

const H = require('./drive-swarm-connectivity.cjs')

const zone = { room: `retype-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: {} }

/** What the view believes about a tile's picture right now. */
const picture = (page, label) => H.evalSafe(() => page.evaluate((label) => {
  const show = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
  const rendered = show.renderedCells?.get?.(label)
  return {
    cached: show.cellImageCache?.has(label) ? (show.cellImageCache.get(label) ?? null) : 'absent',
    rendered: rendered ? (rendered.imageSig ?? null) : 'not-rendered',
    inAtlas: (() => { const sig = show.cellImageCache?.get(label); return sig ? !!show.imageAtlas?.hasImage?.(sig) : null })(),
    segments: window.ioc.get('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [],
  }
}, label))

/** Drop a genuine PNG on EMPTY canvas: the drop door arms the command line;
 *  naming the tile then creates it with the picture. */
const dropPhoto = (page) => H.evalSafe(() => page.evaluate(async () => {
  const side = 120
  const canvas = new OffscreenCanvas(side, side)
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(side, side)
  for (let at = 0; at < img.data.length; at += 65536) crypto.getRandomValues(img.data.subarray(at, Math.min(img.data.length, at + 65536)))
  ctx.putImageData(img, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  const dt = new DataTransfer()
  dt.items.add(new File([blob], 'photo.png', { type: 'image/png' }))
  const target = document.querySelector('canvas') ?? document.body
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 40, clientY: window.innerHeight - 60 }))
  return true
}))

const armed = (page) => H.evalSafe(() => page.evaluate(() => new Promise((resolve) => {
  const bus = globalThis.__hypercombEffectBus
  let done = false, off = null
  off = bus.on('command:arm-resource', (p) => { if (done) return; done = true; if (off) off(); resolve(p ? { small: p.smallPointSig } : null) })
  setTimeout(() => { if (!done) { done = true; if (off) off(); resolve(null) } }, 1500)
})))

;(async () => {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const c = await H.newClient(browser, 'A', zone)
  const page = c.page
  await page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(page); await H.installIfNeeded(page, 'A')
  if (!(await H.waitForReady(page))) throw new Error('not ready')
  await H.settle(page)

  await dropPhoto(page)
  const arm = await H.waitFor(() => armed(page), v => !!(v && v.small), 20000, 250)
  H.log('armed', JSON.stringify(arm.value))
  await H.addTile(page, 'alpha')
  await H.waitFor(() => H.ownChildren(page), o => (o.names ?? []).includes('alpha'), 15000)
  await H.sleep(2500)
  const first = await picture(page, 'alpha')
  H.log('after first create', JSON.stringify(first))

  // The same page, the same name again.
  await H.addTile(page, 'alpha')
  await H.sleep(2500)
  const again = await picture(page, 'alpha')
  H.log('after retype on the same page', JSON.stringify(again))
  H.check('same page: picture still resolved', typeof again.rendered === 'string' && again.rendered.length === 64, JSON.stringify(again))

  // A tile that was removed (hidden) and is now typed back.
  await page.evaluate(async () => { await window.ioc.get('@diamondcoreprocessor.com/RemoveQueenBee').invoke('[alpha]') })
  await H.waitFor(() => H.ownChildren(page), o => !(o.names ?? []).includes('alpha'), 15000)
  await H.sleep(1500)
  H.log('after remove', JSON.stringify(await picture(page, 'alpha')))
  await H.addTile(page, 'alpha')
  for (const ms of [300, 1200, 3000]) {
    await H.sleep(ms === 300 ? 300 : ms === 1200 ? 900 : 1800)
    const back = await picture(page, 'alpha')
    H.log('re-added +' + ms + 'ms', JSON.stringify(back))
    if (ms === 3000) H.check('removed then retyped: picture resolved', typeof back.rendered === 'string' && back.rendered.length === 64, JSON.stringify(back))
  }

  // The name exists on ANOTHER page (with its picture); typed here.
  await H.addTile(page, 'beta')
  await H.waitFor(() => H.ownChildren(page), o => (o.names ?? []).includes('beta'), 15000)
  await H.sleep(1500)
  await page.evaluate(() => window.ioc.get('@hypercomb.social/Navigation').goRaw(['beta']))
  await H.sleep(2500)
  await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone').cellImageCache.delete('alpha'))
  await H.addTile(page, 'alpha')
  await H.sleep(300)
  H.log('elsewhere +300ms', JSON.stringify(await picture(page, 'alpha')))
  await H.sleep(2500)
  const elsewhere = await picture(page, 'alpha')
  H.log('elsewhere +2800ms', JSON.stringify(elsewhere))

  await browser.close()
  for (const r of H.results) console.log(r.ok ? 'PASS' : 'FAIL', r.name, r.detail ?? '')
})().catch(e => { console.error(e); process.exit(1) })
