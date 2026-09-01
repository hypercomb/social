// Attach the debugger BEFORE the wedge, then interrupt the spinning thread
// and dump the stack. Works when Runtime.evaluate cannot get a turn.
const { chromium } = require('playwright')
const URLT = process.argv[2] || 'http://localhost:4312/'
setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(0) }, 170000)
;(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] })
  const page = await browser.newPage()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Debugger.enable')
  await cdp.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 })
  const scripts = new Map()
  cdp.on('Debugger.scriptParsed', e => scripts.set(e.scriptId, e.url))
  const paused = new Promise(res => cdp.on('Debugger.paused', res))
  page.on('console', m => { const t = m.text(); if (/visitor|hive-visit|adopt/.test(t)) console.log('CONSOLE:', t.slice(0,140)) })
  await page.goto(URLT, { waitUntil: 'commit', timeout: 25000 }).catch(() => {})
  await page.waitForTimeout(45000)
  console.log('--- interrupting ---')
  await cdp.send('Debugger.pause').catch(e => console.log('pause failed', e.message))
  const ev = await Promise.race([paused, new Promise(r => setTimeout(() => r(null), 25000))])
  if (!ev) { console.log('NEVER PAUSED — thread not interruptible'); await browser.close().catch(()=>{}); return }
  console.log('=== STACK (innermost first) ===')
  for (const f of ev.callFrames.slice(0, 22)) {
    const url = String(scripts.get(f.location.scriptId) || '').split('/').pop()
    console.log(`  ${f.functionName || '(anon)'}  @ ${url}:${f.location.lineNumber}`)
  }
  let a = ev.asyncStackTrace, depth = 0
  while (a && depth++ < 4) {
    console.log(`--- async: ${a.description || ''} ---`)
    for (const f of (a.callFrames || []).slice(0, 8)) console.log(`  ${f.functionName || '(anon)'} @ ${String(f.url).split('/').pop()}:${f.lineNumber}`)
    a = a.parent
  }
  await browser.close().catch(() => {})
  process.exit(0)
})()
