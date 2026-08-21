#!/usr/bin/env node
// drive-postit-page — does a post-it whose payload is a PAGE (htmlSig) still
// open into that page? The text-only shape is covered by drive-postit-open;
// this is the shape every authored note in the hive actually uses
// (/revolucion/meetup and everything the build scripts write).
//
//   BRIDGE_PORT=2411 node scripts/bridge/run-bridge.cjs   # isolated broker
//   node scripts/drive-postit-page.cjs [--url http://localhost:4250] [--port 2411]
//
// Its own broker + its own renderer tab, so the production slot on 2401 is
// never seized (claude-bridge.worker.ts's `claudeBridgePort` override).

const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const WebSocket = require('ws')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const PORT = Number(arg('port', 2411))
let n = 0
function ask(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:' + PORT)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout: ' + req.op)) }, 20000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: 'page-' + Date.now() + '-' + (++n) })))
    ws.on('message', raw => { clearTimeout(timer); ws.close(); try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) } })
    ws.on('error', e => { clearTimeout(timer); reject(e) })
  })
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

const PAGE_HTML = [
  '<!doctype html><meta charset="utf-8">',
  '<style>body{font:16px/1.6 system-ui;margin:0;padding:3rem;background:#fffdf3;color:#2b2410}',
  'h1{font-size:2rem;margin:0 0 1rem}</style>',
  '<h1 id="probe-heading">The information inside</h1>',
  '<p id="probe-body">Doors at 7. Bring the humidor.</p>',
  '<script>document.getElementById("probe-body").dataset.ran = "yes"</scr' + 'ipt>',
].join('\n')

async function typeCommand(page, text) {
  await page.evaluate((value) => {
    const input = document.querySelector('input.command-input')
    if (!input) throw new Error('no command input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
  }, text)
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
}

async function main() {
  const base = String(arg('url', 'http://localhost:4250'))
  const url = base + '/?claudeBridge=1&claudeBridgePort=' + PORT
  const out = path.resolve(String(arg('out', '.')))
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = async (nm) => { await page.screenshot({ path: path.join(out, nm + '.png') }) }
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }

    await typeCommand(page, 'probe')
    await page.waitForTimeout(1500)

    // The renderer has to have registered before any op can land.
    let state = null
    for (let i = 0; i < 12 && !state; i++) {
      const r = await ask({ op: 'ui-state' }).catch(() => null)
      if (r && r.ok) state = r.data
      else await page.waitForTimeout(1500)
    }
    check('the test renderer is on the bridge', !!state, JSON.stringify(state))
    if (!state) return

    const put = await ask({ op: 'put-resource', text: PAGE_HTML })
    check('the page resource landed', put.ok, put.ok ? String(put.data.sig).slice(0, 12) + '…' : put.error)
    const htmlSig = put.ok ? String(put.data.sig) : ''

    const deco = await ask({
      op: 'decoration-add',
      segments: ['probe'],
      kind: 'visual:postit:note',
      appliesTo: ['probe'],
      payload: { version: 1, title: 'Probe note', htmlSig },
      mark: 'persistent',
      replaceKind: true,
    })
    check('the post-it record landed', deco.ok, deco.ok ? String(deco.data.sig).slice(0, 12) + '…' : deco.error)
    await page.waitForTimeout(3500)
    await shot('page-01-marked')

    const marked = await page.evaluate(() => {
      const drone = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
      const notes = [...document.querySelectorAll('.postit-sticky')]
      return {
        renderedCells: [...(drone?.renderedCells?.keys?.() ?? [])],
        rects: notes.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }),
      }
    })
    console.log('  marked ' + JSON.stringify(marked))
    check('the hexagon left and a sticky arrived',
      !marked.renderedCells.includes('probe') && marked.rects.length > 0, JSON.stringify(marked))
    if (!marked.rects.length) return

    const r = marked.rects[0]
    const cx = Math.round(r.x + r.w / 2), cy = Math.round(r.y + r.h / 2)
    await page.mouse.click(cx, cy)
    await page.waitForTimeout(3000)
    await shot('page-02-opened')

    const opened = await page.evaluate(() => {
      const host = document.querySelector('.hc-postit-view')
      const paper = host?.querySelector('.postit-page')
      const shadow = paper?.shadowRoot
      return {
        mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode,
        post: !!host,
        paper: !!paper,
        shadow: !!shadow,
        heading: shadow?.getElementById?.('probe-heading')?.textContent ?? null,
        scriptRan: shadow?.getElementById?.('probe-body')?.dataset?.ran ?? null,
        html: (shadow?.innerHTML ?? host?.innerHTML ?? '').slice(0, 160),
      }
    })
    console.log('  opened ' + JSON.stringify(opened))
    check('the click opened the post', opened.mode === 'postit' && opened.post, String(opened.mode))
    check('the PAGE mounted in its shadow root', opened.heading === 'The information inside', String(opened.heading))
    check("the page's script ran", opened.scriptRan === 'yes', String(opened.scriptRan))

    if (errors.length) console.log('  page errors: ' + errors.slice(0, 8).join(' | '))
  } finally {
    await browser.close()
  }
  const failed = results.filter(x => !x.ok)
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed')
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
