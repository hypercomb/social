const { chromium } = require('playwright')
const done = m => { console.log(m); process.exit(0) }
setTimeout(() => done('HARD TIMEOUT'), 170000)
;(async () => {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.pluginthematrix.com 104.21.25.138'] })
  const page = await browser.newPage()
  let boots = 0, navs = 0
  const bad = new Set(), notable = []
  page.on('framenavigated', f => { if (f === page.mainFrame()) navs++ })
  page.on('console', m => {
    const t = m.text()
    if (t.includes('main.ts module evaluated')) boots++
    if (/visitor|hive:link|preview|reloading once|spot-check|render:done|failed to open/i.test(t)) notable.push(`[${m.type()}] ${t}`.slice(0, 200))
  })
  page.on('response', r => { if (r.status() >= 400) bad.add(`${r.status()} …${r.url().slice(-64)}`) })
  await page.goto('https://revolucion.pluginthematrix.com/', { waitUntil: 'commit', timeout: 25000 }).catch(e => notable.push('goto ' + e.message))
  await page.waitForTimeout(100000)
  console.log(`BOOTS=${boots} NAVS=${navs}`)
  console.log('BAD ' + JSON.stringify([...bad].slice(0, 12), null, 1))
  console.log('NOTABLE:\n' + notable.slice(0, 40).join('\n'))
  await browser.close().catch(() => {})
  done('END')
})().catch(e => done('FATAL ' + e.message))
