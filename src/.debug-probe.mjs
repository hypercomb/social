import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'chrome', headless: false })
const context = await browser.newContext()
const page = await context.newPage()

await page.addInitScript(() => {
  window.__hcLog = []
  Object.defineProperty(window, '__hcBoot', {
    configurable: true, writable: true,
    value: (m) => { window.__hcLog.push(m) },
  })
  window.__initRan = true
})

const msgs = []
page.on('console', (m) => msgs.push(m.text()))

await page.goto('http://localhost:4250', { waitUntil: 'load' })
await page.waitForTimeout(6000)

const probe = await page.evaluate(() => ({
  initRan: window.__initRan === true,
  hcBootType: typeof window.__hcBoot,
  hcLog: window.__hcLog || null,
  iocKeys: window.ioc && typeof window.ioc.get === 'function'
    ? (() => { try { return !!window.ioc.get('@diamondcoreprocessor.com/PixiHostWorker') } catch { return 'err' } })()
    : 'no-ioc',
  hasCanvas: !!document.querySelector('[data-hypercomb-pixi="root"] canvas'),
}))

console.log('PROBE::' + JSON.stringify(probe, null, 2))
console.log('PIXI_CONSOLE::' + JSON.stringify(msgs.filter((t) => /pixi|hcboot|webgl|host-ready/i.test(t))))
await browser.close()
process.exit(0)
