const { chromium } = require('playwright')
const done = m => { console.log(m); process.exit(0) }
setTimeout(() => done('HARD TIMEOUT'), 170000)
;(async () => {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.pluginthematrix.com 104.21.25.138', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage()
  const cdp = await page.context().newCDPSession(page)
  await page.goto('https://revolucion.pluginthematrix.com/', { waitUntil: 'commit', timeout: 25000 }).catch(() => {})
  await page.waitForTimeout(20000)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.start')
  await page.waitForTimeout(25000)
  const { profile } = await cdp.send('Profiler.stop')
  const byId = new Map(profile.nodes.map(n => [n.id, n]))
  const self = new Map()
  for (const n of profile.nodes) self.set(n.id, n.hitCount || 0)
  const rows = [...self.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 18)
  const total = [...self.values()].reduce((a, b) => a + b, 0) || 1
  console.log('TOTAL SAMPLES ' + total)
  for (const [id, count] of rows) {
    const n = byId.get(id), f = n.callFrame
    const pct = ((count / total) * 100).toFixed(1)
    console.log(`${pct}%\t${f.functionName || '(anonymous)'}\t${String(f.url).slice(-58)}:${f.lineNumber}`)
  }
  await browser.close().catch(() => {})
  done('END')
})().catch(e => done('FATAL ' + e.message))
