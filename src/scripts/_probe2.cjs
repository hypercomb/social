const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.pluginthematrix.com 104.21.25.138'] })
  const page = await browser.newPage()
  const log = []
  page.on('console', m => log.push(`[${m.type()}] ${m.text()}`.slice(0, 300)))
  page.on('pageerror', e => log.push(`[pageerror] ${e.message}`.slice(0, 300)))
  const fails = []
  page.on('response', r => { if (r.status() >= 400) fails.push(`${r.status()} ${r.url().slice(-70)}`) })
  try { await page.goto('https://revolucion.pluginthematrix.com/', { waitUntil: 'commit', timeout: 30000 }) } catch (e) { log.push('[goto] ' + e.message) }
  await page.waitForTimeout(30000)
  const state = await page.evaluate(() => ({
    ready: document.documentElement.dataset.visitorReady ?? null,
    error: document.documentElement.dataset.visitorError ?? null,
    url: location.pathname,
    canvases: document.querySelectorAll('canvas').length,
    mode: (() => { try { return window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? null } catch { return 'n/a' } })(),
    nav: (() => { try { return JSON.stringify(window.ioc?.get?.('@hypercomb.social/Navigation')?.segments?.() ?? null) } catch { return 'n/a' } })(),
  })).catch(e => ({ evalErr: e.message }))
  console.log('STATE ' + JSON.stringify(state))
  console.log('FAILS ' + JSON.stringify(fails.slice(0, 25), null, 1))
  console.log('LOG\n' + log.slice(0, 60).join('\n'))
  await browser.close()
  process.exit(0)
})()
