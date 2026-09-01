const { chromium } = require('playwright')
const done = m => { console.log(m); process.exit(0) }
setTimeout(() => done('HARD TIMEOUT'), 220000)
;(async () => {
  const t0 = Date.now()
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.pluginthematrix.com 104.21.25.138', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage()
  const hits = []
  const s = t => `+${((Date.now() - t0) / 1000).toFixed(0)}s ${t}`
  page.on('console', m => { const t = m.text(); if (/hive-visit|\[visitor\]|preview:|adopt:done/i.test(t)) hits.push(s(t.slice(0, 190))) })
  await page.goto('https://revolucion.pluginthematrix.com/', { waitUntil: 'commit', timeout: 25000 }).catch(e => hits.push('goto ' + e.message))
  await page.waitForTimeout(170000)
  const ready = await Promise.race([
    page.evaluate(() => document.documentElement.dataset.visitorReady ?? 'unset'),
    new Promise(r => setTimeout(() => r('eval-timeout'), 20000)),
  ]).catch(() => 'eval-err')
  console.log('READY=' + ready)
  console.log('HITS:\n' + hits.join('\n'))
  await browser.close().catch(() => {})
  done('END')
})().catch(e => done('FATAL ' + e.message))
