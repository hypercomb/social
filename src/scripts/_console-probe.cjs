const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({args:['--host-resolver-rules=MAP *.pluginthematrix.com 104.21.25.138']})
  const page = await browser.newPage()
  const lines = []
  page.on('console', m => lines.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', e => lines.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', r => lines.push(`[reqfail] ${r.url().slice(0,120)} ${r.failure()?.errorText}`))
  await page.goto('https://revolucion.pluginthematrix.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(e => lines.push('[goto] ' + e.message))
  await page.waitForTimeout(25000)
  const state = await page.evaluate(() => ({
    visitorReady: document.documentElement.dataset.visitorReady,
    visitorError: document.documentElement.dataset.visitorError,
    url: location.href,
  })).catch(e => ({ err: e.message }))
  console.log(JSON.stringify(state))
  console.log(lines.slice(0, 80).join('\n'))
  await browser.close()
})()
