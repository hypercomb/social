const { chromium } = require('playwright')
const fs = require('fs')
const done = m => { console.log(m); process.exit(0) }
setTimeout(() => done('HARD TIMEOUT'), 200000)
;(async () => {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.pluginthematrix.com 104.21.25.138', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage()
  const cdp = await browser.newBrowserCDPSession()
  const events = []
  cdp.on('Tracing.dataCollected', d => events.push(...(d.value || [])))
  await cdp.send('Tracing.start', {
    traceConfig: { includedCategories: ['disabled-by-default-v8.cpu_profiler', 'v8', 'devtools.timeline'] },
    transferMode: 'ReportEvents',
  })
  await page.goto('https://revolucion.pluginthematrix.com/', { waitUntil: 'commit', timeout: 25000 }).catch(() => {})
  await page.waitForTimeout(45000)
  const ended = new Promise(r => cdp.once('Tracing.tracingComplete', r))
  await cdp.send('Tracing.end')
  await Promise.race([ended, new Promise(r => setTimeout(r, 30000))])
  const frames = new Map()
  const counts = new Map()
  for (const e of events) {
    const nodes = e.args?.data?.cpuProfile?.nodes
    if (nodes) for (const n of nodes) frames.set(n.id, n.callFrame)
    const samples = e.args?.data?.cpuProfile?.samples
    if (samples) for (const id of samples) counts.set(id, (counts.get(id) || 0) + 1)
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1
  console.log('trace events=' + events.length + ' samples=' + total)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  for (const [id, c] of top) {
    const f = frames.get(id)
    if (!f) continue
    console.log(`${((c / total) * 100).toFixed(1)}%\t${f.functionName || '(anon)'}\t${String(f.url).slice(-50)}:${f.lineNumber}`)
  }
  await browser.close().catch(() => {})
  done('END')
})().catch(e => done('FATAL ' + e.message))
