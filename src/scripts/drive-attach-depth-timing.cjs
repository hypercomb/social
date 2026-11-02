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
  const side = 1600
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


const go = (page, segs) => page.evaluate((segs) => window.ioc.get('@hypercomb.social/Navigation').goRaw(segs), segs)
const timeIt = async (page, name) => {
  const before = (await armed(page))?.small
  await dropPhoto(page)
  const arm = await H.waitFor(() => armed(page), v => !!(v && v.small && v.small !== before), 8000, 100)
  if (!arm.ok) { H.log('  NOT ARMED at', JSON.stringify(await picture(page, name))); return -1 }
  await page.evaluate(() => { window.__ev = []; const bus = globalThis.__hypercombEffectBus; const t0 = performance.now(); for (const e of ['cell:added','cell:attach-resource','cell:attach-pending','tile:saved','cell:committed','cell:0000-changed','substrate:applied']) bus.on(e, (p) => window.__ev.push(e + ' +' + Math.round(performance.now() - t0) + ' ' + JSON.stringify(p && p.cell || p && p.pending))) })
  const t0 = Date.now()
  await H.addTile(page, name)
  const r = await H.waitFor(() => picture(page, name), p => !!(p && typeof p.cached === 'string' && p.cached.length === 64 && p.inAtlas), 15000, 50)
  const ms = Date.now() - t0
  if (ms > 5000) H.log('  slow; state', JSON.stringify(await picture(page, name)), JSON.stringify(await page.evaluate(() => window.__ev)))
  return ms
}
;(async () => {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const c = await H.newClient(browser, 'A', zone)
  const page = c.page
  await page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(page); await H.installIfNeeded(page, 'A')
  if (!(await H.waitForReady(page))) throw new Error('not ready')
  await H.settle(page)
  page.on('console', m => { const t = m.text(); if (/\[(attach|resource|perf)/i.test(t)) console.log('  page:', t.slice(0,160)) })
  H.log('root', await timeIt(page, 'r1') + 'ms')
  let path = []
  for (const seg of ['a', 'b', 'c']) {
    await H.addTile(page, seg); await H.waitFor(() => H.ownChildren(page), o => (o.names ?? []).includes(seg), 15000)
    await H.sleep(800); path = [...path, seg]; await go(page, path); await H.sleep(2000)
    H.log('depth ' + path.length, await timeIt(page, 'p' + path.length) + 'ms')
  }
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
