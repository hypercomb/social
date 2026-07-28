import { chromium } from 'playwright'

const url = process.env.HYPERCOMB_TEST_URL || 'http://localhost:4251'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const pageErrors = []
page.on('pageerror', error => pageErrors.push(String(error)))

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas', { timeout: 30_000 })
  await page.waitForTimeout(3_000)

  const result = await page.evaluate(() => {
    const bus = window.__hypercombEffectBus
    const canvas = document.querySelector('canvas')
    const lineage = window.ioc?.get?.('@hypercomb.social/Lineage')
    if (!bus || !canvas || !lineage?.explorerEnter) {
      throw new Error('Tile runtime did not initialize')
    }

    let entries = 0
    const originalEnter = lineage.explorerEnter.bind(lineage)
    lineage.explorerEnter = () => { entries++ }

    bus.emit('render:cell-count', {
      count: 1,
      labels: ['preload-probe'],
      coords: [{ q: 0, r: 0 }],
      branchLabels: ['preload-probe'],
      externalLabels: [],
      noImageLabels: [],
      substrateLabels: [],
      linkLabels: [],
      hiddenLabels: [],
      shadedLabels: ['preload-probe'],
      flatPaths: {},
      filterBlocked: [],
    })

    const rect = canvas.getBoundingClientRect()
    const clickProbe = () => {
      const init = {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        pointerId: 991,
        pointerType: 'mouse',
      }
      canvas.dispatchEvent(new PointerEvent('pointerdown', init))
      canvas.dispatchEvent(new PointerEvent('pointerup', init))
      canvas.dispatchEvent(new MouseEvent('click', init))
    }

    clickProbe()
    const whilePreloading = entries
    bus.emit('render:tile-readiness', { shadedLabels: [] })
    clickProbe()
    const whenReady = entries
    lineage.explorerEnter = originalEnter
    return { whilePreloading, whenReady }
  })

  if (result.whilePreloading !== 0) {
    throw new Error(`Preloading branch navigated ${result.whilePreloading} time(s)`)
  }
  if (result.whenReady !== 1) {
    throw new Error(`Ready branch navigated ${result.whenReady} time(s), expected 1`)
  }
  if (pageErrors.length) {
    throw new Error(`Page errors:\n${pageErrors.join('\n')}`)
  }
  console.log('PASS tile preload gate:', result)
} finally {
  await browser.close()
}
