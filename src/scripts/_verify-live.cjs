const { chromium } = require('playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'scripts/_verify-live.txt'
const say = m => { fs.appendFileSync(OUT, m + '\n'); console.log(m) }
fs.writeFileSync(OUT, '')
const done = m => { say(m); process.exit(0) }
setTimeout(() => done('HARD TIMEOUT'), 240000)
;(async () => {
  const t0 = Date.now()
  const s = () => '+' + ((Date.now() - t0) / 1000).toFixed(0) + 's'
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.pluginthematrix.com 104.21.25.138', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('console', m => { const t = m.text(); if (/hive-visit|\[visitor\]|adopt\]/i.test(t)) say(s() + ' ' + t.slice(0, 150)) })
  say('navigating')
  await page.goto('https://revolucion.pluginthematrix.com/', { waitUntil: 'commit', timeout: 25000 }).catch(e => say('goto ' + e.message))
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(10000)
    const st = await Promise.race([
      page.evaluate(() => document.documentElement.dataset.visitorReady ?? 'unset'),
      new Promise(r => setTimeout(() => r('busy'), 8000)),
    ]).catch(() => 'err')
    say(`${s()} visitorReady=${st}`)
    if (st === 'true') { try { await page.screenshot({ path: 'scripts/_live-shot.png' }); say('screenshot saved') } catch {} ; break }
  }
  await browser.close().catch(() => {})
  done('END')
})().catch(e => done('FATAL ' + e.message))
