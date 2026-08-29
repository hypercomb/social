const { chromium } = require('playwright')
const done = m => { console.log(m); process.exit(0) }
setTimeout(() => done('HARD TIMEOUT'), 300000)
;(async () => {
  const t0 = Date.now()
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.pluginthematrix.com 104.21.25.138', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage()
  const hits = []
  const stamp = t => `+${((Date.now() - t0) / 1000).toFixed(0)}s ${t}`
  page.on('console', m => { const t = m.text(); if (/hive-visit|\[visitor\]|closure localized|preview/i.test(t)) hits.push(stamp(`[${m.type()}] ${t}`.slice(0, 200))) })
  await page.goto('https://revolucion.pluginthematrix.com/', { waitUntil: 'commit', timeout: 25000 }).catch(e => hits.push('goto ' + e.message))
  let verdict = 'no-ready'
  try {
    await page.waitForFunction(() => document.documentElement.dataset.visitorReady === 'true', { timeout: 240000, polling: 1000 })
    verdict = 'VISITOR READY ' + stamp('')
  } catch { verdict = 'ready never set' }
  console.log(verdict)
  console.log('HITS:\n' + hits.slice(0, 20).join('\n'))
  try { await page.screenshot({ path: 'scripts/_live-shot.png' }) ; console.log('screenshot saved') } catch (e) { console.log('shot fail ' + e.message) }
  await browser.close().catch(() => {})
  done('END')
})().catch(e => done('FATAL ' + e.message))
