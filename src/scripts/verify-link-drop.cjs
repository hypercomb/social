// Link-drop verification — a REAL native drag, driven by Playwright.
//
// Synthetic `new DragEvent(...)` cannot prove this path: it never exercises the
// browser's own DataTransfer, and `dragover`/`preventDefault` acceptance is
// invisible to it. This drags an actual anchor with trusted input events, which
// is what a person does.
//
//   node scripts/verify-link-drop.cjs [--url http://localhost:4250] [--tile]
//
//   (default)  drop on empty canvas → command line names it → Enter saves the
//              tile with the link and the picture
//   --tile     drop on an existing tile → link + picture land on THAT tile,
//              the command line is deliberately untouched
const { chromium } = require('playwright')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const HIVE = arg('--url', 'http://localhost:4250')
const VIDEO = arg('--video', 'https://www.youtube.com/watch?v=aircAruvnKk')
const ON_TILE = process.argv.includes('--tile')
// --thumb: the drag source is a LINKED THUMBNAIL — an <a href="watch-url"> that
// wraps an <img>. This is what dragging a video off the YouTube page packages
// (an image file AND the URL), and it is the shape that was being captured by
// the image path: picture tile, no name, no link.
const AS_THUMB = process.argv.includes('--thumb')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const dragTo = async (page, from, to) => {
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 30, from.y - 20, { steps: 8 })
  await page.mouse.move(to[0], to[1], { steps: 25 })
  await page.mouse.move(to[0] + 2, to[1] + 2, { steps: 5 })
  await page.mouse.up()
}

;(async () => {
  const browser = await chromium.launch({ headless: false })
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  const navs = []
  page.on('framenavigated', f => { if (f === page.mainFrame()) navs.push(f.url()) })

  await page.goto(HIVE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input.command-input', { timeout: 60000 })
  // Wait for the runtime itself, not a guessed number of seconds.
  await page.waitForFunction(
    () => !!window.__hypercombEffectBus && !!window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone'),
    null, { timeout: 90000 })
  await sleep(6000)
  // The first-boot offer covers the canvas on a brand-new hive and is not
  // what is under test.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.offer-backdrop, [class*="offer"]')) el.remove()
  })

  if (ON_TILE) {
    await page.focus('input.command-input')
    await page.keyboard.type('drop target tile')
    await page.keyboard.press('Enter')
    await sleep(6000)
  }

  await page.evaluate(() => {
    window.__t0 = performance.now()
    window.__arms = []
    window.__hypercombEffectBus.on('command:arm-resource', p => window.__arms.push({
      t: Math.round(performance.now() - window.__t0),
      name: p?.name ?? null, picture: !!p?.largeSig, armId: p?.armId ?? null,
    }))
  })

  await page.evaluate(([v, asThumb]) => {
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;background:#fff;padding:6px'
    if (asThumb) {
      // A 24x24 red PNG standing in for the video's poster frame.
      const px = 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAJElEQVR4nGP8z8Dwn4EIwESMolGFo'
        + 'wpHFY4qHFU4qnBUIQwAAN0lAx/dR9vLAAAAAElFTkSuQmCC'
      host.innerHTML = `<a id="drag-source" href="${v}" draggable="true"><img src="data:image/png;base64,${px}" width="24" height="24"></a>`
    } else {
      host.innerHTML = `<a id="drag-source" href="${v}" draggable="true">link</a>`
    }
    document.body.appendChild(host)
  }, [VIDEO, AS_THUMB])

  const target = await page.evaluate((onTile) => {
    const ov = window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone')
    for (let x = 150; x < window.innerWidth - 150; x += 20)
      for (let y = 200; y < window.innerHeight - 250; y += 20) {
        const label = ov?.labelAtClient?.(x, y)
        if (onTile ? label : !label) return { at: [x, y], label: label ?? null }
      }
    return null
  }, ON_TILE)
  if (!target) throw new Error(ON_TILE ? 'no tile to drop on' : 'no empty hex to drop on')

  await page.evaluate(() => { window.__t0 = performance.now() })
  await dragTo(page, await (await page.$('#drag-source')).boundingBox(), target.at)

  await sleep(800)
  const onRelease = await page.evaluate(() => document.querySelector('input.command-input')?.value ?? '')
  await sleep(3000)

  // The verification popup reports what the drop READ.
  const card = await page.evaluate(() => {
    const el = document.querySelector('.hc-link-card')
    if (!el) return null
    const img = el.querySelector('img')
    return {
      title: el.querySelector('h1')?.textContent ?? null,
      untitled: !!el.querySelector('h1.untitled'),
      image: img ? img.getAttribute('src') : null,
      imageLoaded: img ? img.naturalWidth > 0 : false,
      rows: [...el.querySelectorAll('dt')].map((dt, i) => `${dt.textContent}: ${el.querySelectorAll('dd')[i]?.textContent}`),
    }
  })
  await page.evaluate(() => document.querySelector('.hc-link-card button[data-role="accept"]')?.click())
  await sleep(3000)
  const afterCard = await page.evaluate(() => document.querySelector('input.command-input')?.value ?? '')

  // No Enter: dropping on empty space IS the creation.
  if (!ON_TILE) await sleep(4000)

  const tiles = (await page.evaluate(async () => {
    const store = window.ioc.get('@hypercomb.social/Store')
    const idx = JSON.parse(localStorage.getItem('hc:tile-props-index') || '{}')
    const out = []
    for (const sig of Object.values(idx)) {
      const b = await store.getResource(sig)
      if (b) { const p = JSON.parse(await b.text()); out.push({ link: p.link ?? null, picture: !!p.large?.image, index: p.index ?? null }) }
    }
    return out
  })) || []
  const arms = (await page.evaluate(() => window.__arms)) || []

  const withLink = tiles.filter(t => t.link === VIDEO)
  const checks = [
    ['1. drop delivered', arms.length > 0 || withLink.length > 0],
    ['2. open-graph card read', arms.some(a => a.picture) || withLink.some(t => t.picture)],
    ['3. command line named by the title', ON_TILE ? afterCard === '' : /[a-z]{4}/i.test(afterCard) && !/^youtube [\w-]{11}$/.test(afterCard)],
    ['6. tile created by the drop alone (no Enter)', ON_TILE ? true : withLink.length > 0],
    ['7. pinned to the first slot', ON_TILE ? true : tiles.some(t => t.link === VIDEO && t.index === 0)],
    ['4. tile carries the dropped url', withLink.length > 0],
    ['5. picture from the og image', withLink.some(t => t.picture)],
    ['8. og data shown in a popup', !!card && !card.untitled && !!card.image && card.imageLoaded],
  ]

  console.log(JSON.stringify({ mode: (AS_THUMB ? 'LINKED-THUMBNAIL ' : '') + (ON_TILE ? 'drop on tile' : 'drop on canvas'), target, onRelease, afterCard, card, arms, tiles, navs, errors }, null, 2))
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  await browser.close()
  process.exit(checks.every(c => c[1]) ? 0 : 1)
})().catch(err => { console.error('FAILED', err && err.message); process.exit(1) })
