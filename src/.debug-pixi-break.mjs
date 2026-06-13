// Temp debugger driver: launch Chrome against the running dev server (4250),
// break the JS execution exactly when PixiHostWorker finishes init
// (the `render:host-ready emitted` boot trace at pixi-host.worker.ts:351),
// dump the paused call stack + act() locals, and leave the page paused.
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = join(tmpdir(), 'pixi-break.json')
const URL = 'http://localhost:4250'

const browser = await chromium.launch({ channel: 'chrome', headless: false })
const context = await browser.newContext({ viewport: { width: 1536, height: 864 } })
const page = await context.newPage()

// Define the optional boot hook the worker calls; trip `debugger` only on the
// ready trace so the other __hcBoot calls (init start/done) don't pause.
// The app defines its OWN window.__hcBoot boot tracer after our init script
// runs, so a plain assignment gets clobbered. Trap it with a getter/setter:
// whatever the app assigns is stored as `real`; every reader gets our wrapper,
// which trips `debugger` on the host-ready trace, then delegates to the real
// tracer. Timing-proof regardless of when the app installs its logger.
await page.addInitScript(() => {
  let real
  Object.defineProperty(window, '__hcBoot', {
    configurable: true,
    get() {
      return function (m) {
        if (typeof m === 'string' && m.includes('render:host-ready')) { debugger }
        if (typeof real === 'function') return real.apply(this, arguments)
      }
    },
    set(v) { real = v },
  })
})

const client = await context.newCDPSession(page)
await client.send('Runtime.enable')
await client.send('Debugger.enable')

let captured = false
client.on('Debugger.paused', async (evt) => {
  if (captured) return
  captured = true

  const frames = evt.callFrames.slice(0, 8).map((f) => ({
    fn: f.functionName || '(anonymous)',
    url: (f.url || '').replace(/^https?:\/\/localhost:4250/, ''),
    line: f.location.lineNumber + 1,
    col: f.location.columnNumber,
  }))
  // Emit the stack immediately — before any await — so a later failure
  // can't swallow the proof that we paused.
  console.log('PAUSED::' + JSON.stringify({ reason: evt.reason, callStack: frames }))

  // The frame one above our hook is PixiHostWorker.act — read its local scope.
  let actLocals = null
  try {
    const actFrame = evt.callFrames.find((f) => /\bact\b/.test(f.functionName))
    if (actFrame) {
      const local = actFrame.scopeChain.find((s) => s.type === 'local')
      if (local?.object?.objectId) {
        const props = await client.send('Runtime.getProperties', {
          objectId: local.object.objectId,
          ownProperties: true,
        })
        actLocals = props.result
          .filter((p) => p.value)
          .map((p) => ({
            name: p.name,
            type: p.value.subtype || p.value.type,
            desc: p.value.description || String(p.value.value),
          }))
      }
    }
  } catch (e) {
    console.log('LOCALS_ERR::' + (e && e.message))
  }

  const report = {
    pausedAt: 'pixi-host.worker.ts:351 (render:host-ready emitted)',
    reason: evt.reason,
    callStack: frames,
    actLocals,
  }
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log('LOCALS::' + JSON.stringify(actLocals))
  console.log('Browser is paused at PixiHostWorker ready. Resume from the Chrome window or kill this process.')
})

page.on('console', (m) => { if (/pixi-host|HCBOOT|WebGL/i.test(m.text())) console.log('[page]', m.text()) })

console.log('Navigating to', URL)
page.goto(URL, { waitUntil: 'commit' }).catch(() => {})

// Keep the process (and the paused browser) alive until killed.
setInterval(() => {}, 1 << 30)
