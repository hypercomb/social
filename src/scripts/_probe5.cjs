const { chromium } = require('playwright')
const done = m => { console.log(m); process.exit(0) }
setTimeout(() => done('HARD TIMEOUT'), 330000)
;(async () => {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.pluginthematrix.com 104.21.25.138','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] })
  const page = await browser.newPage()
  const notable = []
  page.on('console', m => { const t = m.text(); if (/visitor|hive|preview|adopt|visit|fold|root|404|not found/i.test(t) && !/script-preloader|SHADER|Attribute|#version/.test(t)) notable.push(`[${m.type()}] ${t}`.slice(0, 180)) })
  await page.goto('https://revolucion.pluginthematrix.com/', { waitUntil: 'commit', timeout: 25000 }).catch(e => notable.push('goto ' + e.message))
  let ready = 'never'
  try {
    await page.waitForFunction(() => document.documentElement.dataset.visitorReady === 'true' || document.documentElement.dataset.visitorError === 'true', { timeout: 240000, polling: 1000 })
    ready = await page.evaluate(() => document.documentElement.dataset.visitorReady === 'true' ? 'READY' : 'ERROR')
  } catch (e) { ready = 'timeout-' + String(e).slice(0, 60) }
  console.log('VISITOR ' + ready)
  const deep = await Promise.race([
    page.evaluate(() => {
      const g = k => { try { return window.ioc?.get?.(k) } catch { return null } }
      const nav = g('@hypercomb.social/Navigation')
      const vm = g('@hypercomb.social/ViewMode')
      return { path: location.pathname, segs: JSON.stringify(nav?.segments?.() ?? nav?.explorerSegments?.() ?? null), mode: vm?.mode ?? null, canvas: document.querySelectorAll('canvas').length }
    }),
    new Promise(r => setTimeout(() => r({ evalTimeout: true }), 20000)),
  ]).catch(e => ({ err: String(e).slice(0, 100) }))
  console.log('DEEP ' + JSON.stringify(deep))
  console.log('NOTABLE:\n' + notable.slice(-25).join('\n'))
  await browser.close().catch(() => {})
  done('END')
})().catch(e => done('FATAL ' + e.message))
