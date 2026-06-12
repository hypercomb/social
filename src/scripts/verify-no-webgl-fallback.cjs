// scripts/verify-no-webgl-fallback.cjs
//
// Simulates the Mac-with-WebGL-blocked environment: launches Chromium with
// WebGL disabled and loads the dev shell. Asserts the pixi host detects the
// canvas-renderer fallback, halts cleanly (no per-frame validateRenderable
// crash), and shows the "hardware graphics is turned off" note. A control
// browser with WebGL enabled must still boot the normal mesh scene.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'

function ts() { return new Date().toISOString().slice(11, 23) }
function log(...args) { console.log(`[${ts()}]`, ...args) }

async function run(label, launchArgs) {
  const browser = await chromium.launch({ headless: true, args: launchArgs })
  const page = await (await browser.newContext()).newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  // let boot finish + a few seconds of ticker frames accumulate
  await new Promise(r => setTimeout(r, 12000))
  const state = await page.evaluate(() => {
    const probe = document.createElement('canvas')
    return {
      webglAvailable: !!probe.getContext('webgl'),
      noteShown: !!document.querySelector('[data-hypercomb-pixi="webgl-required"]'),
      noteText: document.querySelector('[data-hypercomb-pixi="webgl-required"]')?.textContent?.slice(0, 80) ?? null,
      canvasMounted: !!document.querySelector('[data-hypercomb-pixi="root"] canvas'),
    }
  })
  const validateCrashes = errors.filter(e => e.includes('validateRenderable')).length
  await browser.close()
  log(label, JSON.stringify({ ...state, consoleErrors: errors.length, validateCrashes }))
  return { ...state, validateCrashes }
}

async function main() {
  const blocked = await run('webgl-blocked', ['--disable-webgl', '--disable-webgl2'])
  const control = await run('webgl-enabled', [])

  // Assert on APP behavior, not the page-level webgl probe — headless
  // Chromium can refuse a second context to the probe even when Pixi's
  // own context succeeded at boot.
  console.log('\n========== VERDICT ==========')
  console.log(`blocked: note=${blocked.noteShown} canvas=${blocked.canvasMounted} validateCrashes=${blocked.validateCrashes} (want: true/false/0)`)
  console.log(`control: note=${control.noteShown} canvas=${control.canvasMounted} validateCrashes=${control.validateCrashes} (want: false/true/0)`)
  const ok = blocked.noteShown && !blocked.canvasMounted && blocked.validateCrashes === 0
    && !control.noteShown && control.canvasMounted && control.validateCrashes === 0
  console.log(ok ? 'OVERALL: ✓ PASS — clean halt + message without WebGL; normal boot with it' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
