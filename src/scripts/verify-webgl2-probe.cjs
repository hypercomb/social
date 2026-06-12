// scripts/verify-webgl2-probe.cjs
//
// Behavioral test of the vendor-bundle probe patch (build-pixi-vendor.ts):
// pixi 8.16's isWebGLSupported() requests only a WebGL 1 context, but the
// real renderer prefers WebGL 2 — so a WebGL2-only browser (observed on
// macOS after a browser update) was misclassified as "no WebGL" and the
// app crashed on the canvas fallback. The patched bundle must report
// supported=true when webgl1 is unavailable but webgl2 works.
//
// Simulation: monkeypatch HTMLCanvasElement.getContext to refuse 'webgl'
// while passing 'webgl2' through, then import the actual built vendor file
// and call its exported isWebGLSupported().

const { chromium } = require('playwright')
const { resolve } = require('path')
const { writeFileSync, rmSync } = require('fs')

const VENDOR = resolve(__dirname, '../hypercomb-web/public/vendor/pixi.runtime.js')
const HARNESS = resolve(__dirname, '../hypercomb-web/public/vendor/__webgl2-probe-test.html')

function ts() { return new Date().toISOString().slice(11, 23) }
function log(...args) { console.log(`[${ts()}]`, ...args) }

async function probeCase(blockWebgl1) {
  writeFileSync(HARNESS, `<!doctype html><script type="module">
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (${blockWebgl1} && type === 'webgl') return null
      return original.call(this, type, ...rest)
    }
    const pixi = await import('./pixi.runtime.js')
    window.__result = {
      webgl2Works: !!document.createElement('canvas').getContext('webgl2'),
      supported: pixi.isWebGLSupported(),
    }
  </scr` + `ipt>`)
  // file:// pages get opaque origins — module imports between file:// URLs
  // are CORS-blocked without this flag.
  const browser = await chromium.launch({ headless: true, args: ['--allow-file-access-from-files'] })
  const page = await (await browser.newContext()).newPage()
  await page.goto('file:///' + HARNESS.replace(/\\/g, '/'), { waitUntil: 'load' })
  await page.waitForFunction(() => !!window.__result, null, { timeout: 15000 })
  const result = await page.evaluate(() => window.__result)
  await browser.close()
  return result
}

async function main() {
  try {
    const v1blocked = await probeCase(true)
    const normal = await probeCase(false)
    log('webgl1 blocked, webgl2 available:', JSON.stringify(v1blocked))
    log('all contexts available:          ', JSON.stringify(normal))

    console.log('\n========== VERDICT ==========')
    console.log(`webgl2-only browser reports supported=${v1blocked.supported} (want true — the patch)`)
    console.log(`normal browser reports supported=${normal.supported} (want true)`)
    const ok = v1blocked.webgl2Works && v1blocked.supported === true && normal.supported === true
    console.log(ok ? 'OVERALL: ✓ PASS — WebGL2-only browsers no longer misrouted to canvas' : 'OVERALL: ✗ FAIL')
    console.log('=============================\n')
    process.exit(ok ? 0 : 1)
  } finally {
    rmSync(HARNESS, { force: true })
  }
}

main().catch(err => { console.error('[fatal]', err); rmSync(HARNESS, { force: true }); process.exit(1) })
