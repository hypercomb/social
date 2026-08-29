const { chromium } = require('playwright')
const done = m => { console.log(m); process.exit(0) }
setTimeout(() => done('HARD TIMEOUT'), 900000)
;(async () => {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.pluginthematrix.com 104.21.25.138', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage()
  const hits = []
  page.on('console', m => { const t = m.text(); if (/hive-visit|\[visitor\]|preview|adopt/i.test(t)) hits.push(`[${m.type()}] ${t}`.slice(0, 220)) })
  page.on('pageerror', e => hits.push('[ERR] ' + String(e.message).slice(0, 200)))
  await page.goto('https://revolucion.pluginthematrix.com/', { waitUntil: 'commit', timeout: 25000 }).catch(e => hits.push('goto ' + e.message))
  await page.waitForTimeout(840000)
  console.log('HITS:\n' + hits.slice(0, 30).join('\n'))
  await browser.close().catch(() => {})
  done('END')
})().catch(e => done('FATAL ' + e.message))
