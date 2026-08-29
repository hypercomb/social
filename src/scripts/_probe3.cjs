const { chromium } = require('playwright')
const done = (msg) => { console.log(msg); process.exit(0) }
setTimeout(() => done('HARD TIMEOUT'), 180000)
;(async () => {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.pluginthematrix.com 104.21.25.138'] })
  const page = await browser.newPage()
  const log = []
  page.on('console', m => log.push(`[${m.type()}] ${m.text()}`.slice(0, 250)))
  page.on('pageerror', e => log.push(`[ERR] ${e.message}`.slice(0, 250)))
  const bad = []
  page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} …${r.url().slice(-60)}`) })
  await page.goto('https://revolucion.pluginthematrix.com/', { waitUntil: 'commit', timeout: 25000 }).catch(e => log.push('[goto] ' + e.message))
  await page.waitForTimeout(95000)
  let state = {}
  try {
    state = await Promise.race([
      page.evaluate(() => ({
        ready: document.documentElement.dataset.visitorReady ?? null,
        error: document.documentElement.dataset.visitorError ?? null,
        path: location.pathname,
        canvas: document.querySelectorAll('canvas').length,
        splash: !!document.getElementById('hc-splash'),
        bodyText: (document.body.innerText || '').slice(0, 120),
      })),
      new Promise(r => setTimeout(() => r({ evalTimeout: true }), 15000)),
    ])
  } catch (e) { state = { evalErr: String(e).slice(0, 150) } }
  console.log('STATE ' + JSON.stringify(state))
  console.log('BAD ' + JSON.stringify(bad.slice(0, 20)))
  console.log('LOG:\n' + log.filter(l=>/visitor|PixiHost|pixi|unsafe|render:|preview|hive:link|Error|ERR|fail/i.test(l)).slice(-30).join('\n'))
  await browser.close().catch(() => {})
  done('END')
})().catch(e => done('FATAL ' + e.message))
