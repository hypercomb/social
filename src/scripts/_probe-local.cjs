const { chromium } = require('playwright')
const done = m => { console.log(m); process.exit(0) }
setTimeout(() => done('HARD TIMEOUT'), 200000)
;(async () => {
  const t0 = Date.now()
  const s = () => `+${((Date.now() - t0) / 1000).toFixed(0)}s`
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage()
  const hits = []
  let sigFetches = 0, lastFetchAt = 0
  page.on('console', m => { const t = m.text(); if (/hive-visit|\[visitor\]|adopt:|preview/i.test(t)) hits.push(`${s()} ${t.slice(0, 180)}`) })
  page.on('pageerror', e => hits.push(`${s()} [ERR] ${String(e.message).slice(0, 160)}`))
  page.on('request', r => { if (/\/[0-9a-f]{64}$/.test(r.url())) { sigFetches++; lastFetchAt = Date.now() } })
  await page.goto('http://localhost:4300/', { waitUntil: 'commit', timeout: 25000 }).catch(e => hits.push('goto ' + e.message))
  for (let i = 0; i < 9; i++) {
    await page.waitForTimeout(10000)
    const idle = lastFetchAt ? ((Date.now() - lastFetchAt) / 1000).toFixed(0) : 'n/a'
    console.log(`${s()} sigFetches=${sigFetches} idleSince=${idle}s`)
  }
  console.log('HITS:\n' + hits.slice(0, 25).join('\n'))
  await browser.close().catch(() => {})
  done('END')
})().catch(e => done('FATAL ' + e.message))
