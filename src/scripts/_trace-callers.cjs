const { chromium } = require('playwright')
const done = m => { console.log(m); process.exit(0) }
setTimeout(() => done('HARD TIMEOUT'), 220000)
;(async () => {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.pluginthematrix.com 104.21.25.138', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage()
  const cdp = await browser.newBrowserCDPSession()
  const events = []
  cdp.on('Tracing.dataCollected', d => events.push(...(d.value || [])))
  await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['disabled-by-default-v8.cpu_profiler','v8','devtools.timeline'] }, transferMode: 'ReportEvents' })
  await page.goto('https://revolucion.pluginthematrix.com/', { waitUntil: 'commit', timeout: 25000 }).catch(() => {})
  await page.waitForTimeout(40000)
  const ended = new Promise(r => cdp.once('Tracing.tracingComplete', r))
  await cdp.send('Tracing.end')
  await Promise.race([ended, new Promise(r => setTimeout(r, 30000))])
  const frame = new Map(), parent = new Map(), counts = new Map()
  for (const e of events) {
    const prof = e.args?.data?.cpuProfile
    if (prof?.nodes) for (const n of prof.nodes) {
      frame.set(n.id, n.callFrame)
      if (n.children) for (const c of n.children) parent.set(c, n.id)
      if (n.parent != null) parent.set(n.id, n.parent)
    }
    if (prof?.samples) for (const id of prof.samples) counts.set(id, (counts.get(id) || 0) + 1)
  }
  const name = id => { const f = frame.get(id); return f ? (f.functionName || '(anon)') + '@' + String(f.url).split('/').pop().slice(0, 22) + ':' + f.lineNumber : '?' }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  console.log('samples=' + sorted.length + ' frames=' + frame.size + ' parents=' + parent.size)
  if (sorted.length) console.log('hottest: ' + name(sorted[0][0]) + ' samples=' + sorted[0][1])
  // Aggregate ancestor chains of every sample landing in a getFile frame
  const chains = new Map()
  for (const [id, c] of counts) {
    const f = frame.get(id)
    if (!f || !/getFile/.test(f.functionName || '')) continue
    const chain = []
    let cur = parent.get(id)
    for (let i = 0; i < 8 && cur != null; i++) { chain.push(name(cur)); cur = parent.get(cur) }
    const key = chain.join(' < ')
    chains.set(key, (chains.get(key) || 0) + c)
  }
  const top = [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  console.log('\nTOP getFile CALL CHAINS:')
  for (const [chain, c] of top) console.log(`\n${c} samples\n  ${chain.replace(/ < /g, '\n  < ')}`)
  await browser.close().catch(() => {})
  done('END')
})().catch(e => done('FATAL ' + e.message))
