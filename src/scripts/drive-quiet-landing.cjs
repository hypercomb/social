#!/usr/bin/env node
// drive-quiet-landing — does the bridge's write land WITHOUT moving the surface?
//
//   node scripts/drive-quiet-landing.cjs [--url http://localhost:4250] [--out <dir>]
//
// The bargain under test (documentation/quiet-landing.md):
//
//   1. a bridge write lands as TRUTH immediately
//   2. the canvas does NOT repaint while it lands
//   3. a badge appears saying how many writes are waiting
//   4. tapping the badge is the ONLY thing that applies them
//
// Proven WITHOUT the picture. Headless has no GPU, so Pixi's shaders never
// compile and a screenshot proves nothing (see the Playwright/Pixi traps).
// Everything here reads the SCENE instead: `render:cell-count` — emitted on
// every real render pass with the labels it painted — via the bridge's own
// `effect-last` op, plus the badge, which is ordinary Angular DOM.
//
// This drives its OWN Playwright profile, so the hive it writes into is a
// scratch one. It never touches the participant's data. It does need the
// broker (`npm run bridge`) and a dev server, and it becomes the renderer on
// that broker for the length of the run — do not point it at a broker that
// already has one.

const fs = require('node:fs')
const path = require('node:path')
const WebSocket = require('ws')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const BRIDGE_PORT = Number(arg('port', 2401))
const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

let counter = 0
function send(request, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `drive-${Date.now()}-${++counter}` }
    // Pin IPv4 loopback: a second listener on the port swallows `localhost`
    // dials without answering — only 127.0.0.1 has the renderer.
    const ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, timeout)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('invalid response')) }
      ws.close()
    })
    ws.on('error', (err) => { clearTimeout(timer); reject(new Error(`bridge connect failed: ${err.message}`)) })
  })
}

/** Wait until the page has registered itself as the broker's renderer. */
async function waitForRenderer(tries = 30) {
  for (let i = 0; i < tries; i++) {
    const res = await send({ op: 'list' }, 8000).catch(() => ({ ok: false }))
    if (res.ok) return true
    await new Promise(r => setTimeout(r, 2000))
  }
  return false
}

const lastEffect = async (name) => {
  const res = await send({ op: 'effect-last', cell: name })
  return res.ok ? (res.data?.last ?? null) : null
}

/** Labels the canvas last PAINTED — the scene, not the picture. */
const painted = async () => {
  const last = await lastEffect('render:cell-count')
  return Array.isArray(last?.labels) ? [...last.labels].sort() : null
}

const badge = (page) => page.locator('hc-landing-badge .landing-badge')

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', '.')))
  fs.mkdirSync(out, { recursive: true })

  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  try {
    await page.goto(`${url}/?claudeBridge=1`, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    // A fresh profile opens on the first-boot offer, which covers the canvas.
    // ?claudeBridge=1 also opens the chat window, which lies OVER the offer —
    // force past it rather than closing it, since the run wants the bridge up.
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) {
      await startEmpty.first().click({ force: true })
      await page.waitForTimeout(3000)
    }

    if (!(await waitForRenderer())) {
      console.error('[drive] the page never became the broker renderer — is the broker up, and free?')
      process.exit(1)
    }
    await page.waitForTimeout(2000)

    // ── 1. nothing is waiting yet ───────────────────────────────────────
    check('the badge is absent before anything lands', await badge(page).count() === 0)

    // The first paint can lag the renderer handshake by seconds on a cold
    // profile — wait for a scene rather than racing it.
    let before = null
    for (let i = 0; i < 20 && before === null; i++) {
      before = await painted()
      if (before === null) await page.waitForTimeout(1500)
    }
    check('the canvas has painted a scene to compare against', before !== null,
      before ? `${before.length} tile(s)` : 'no render:cell-count seen')
    if (before === null) { console.error('[drive] no scene — cannot judge a held paint'); process.exit(1) }

    // ── WHOSE RENDERER IS ANSWERING? ────────────────────────────────────
    // The broker has ONE renderer slot. If another tab holds it, every read
    // here describes somebody else's hive AND — far worse — the writes below
    // land in it. That happened: three probe tiles ended up at the root of a
    // real hive. This page starts from "Start empty", so its root is empty;
    // anything else means we are not talking to ourselves. Refuse to write.
    if (before.length > 0) {
      console.error(`[drive] ABORT: the broker's renderer is NOT this page — it is showing ${before.length} tile(s): ${before.slice(0, 6).join(', ')}`)
      console.error('[drive] close the other hive tab (or point --port at a private broker) and re-run. Nothing was written.')
      process.exit(1)
    }

    // ── 2. a burst of writes lands ──────────────────────────────────────
    const NEW = ['quiet-landing-probe-a', 'quiet-landing-probe-b', 'quiet-landing-probe-c']
    for (const cell of NEW) {
      const res = await send({ op: 'add', cells: [cell] })
      if (!res.ok) { console.error(`[drive] add "${cell}" failed: ${res.error}`); process.exit(1) }
    }
    // Past the producer's 400ms settle, and well past any paint it would have run.
    await page.waitForTimeout(3000)

    // ── 3. the write is TRUTH, and the surface did not move ─────────────
    const listed = await send({ op: 'list' })
    const inHive = NEW.filter(n => (listed.data ?? []).includes(n))
    check('all three writes landed in the hive', inHive.length === 3, `${inHive.length}/3 present`)

    const during = await painted()
    const held = during !== null && before !== null && during.join('|') === before.join('|')
    check('the canvas did NOT repaint while they landed', held,
      during && before
        ? (held ? `still ${during.length} tile(s)` : `LEAKED: ${before.length} → ${during.length}`)
        : 'no scene to compare')

    const pending = await lastEffect('landing:pending')
    check('the renderer published what is unseen', Number(pending?.count) === 3,
      `count=${pending?.count ?? 'none'}`)

    // ── 4. the badge offers them ────────────────────────────────────────
    await page.waitForTimeout(500)
    const visible = await badge(page).isVisible().catch(() => false)
    check('the badge is on top', visible)
    const text = visible ? (await badge(page).innerText()).replace(/\s+/g, ' ').trim() : ''
    check('the badge says how many are waiting', /\b3\b/.test(text), text || 'no text')
    await page.screenshot({ path: path.join(out, 'quiet-landing-badge.png') })

    // ── 5. the tap is the only release ──────────────────────────────────
    await badge(page).click()
    await page.waitForTimeout(3000)

    const stoodDown = (await badge(page).count()) === 0
      || !(await badge(page).isVisible().catch(() => false))
    check('the badge stands down once tapped', stoodDown)

    const after = await painted()
    const arrived = after ? NEW.filter(n => after.includes(n)) : []
    check('the held paint ran, and all three arrived on the surface', arrived.length === 3,
      after ? `${arrived.length}/3 painted (${after.length} tile(s) total)` : 'no scene')

    await page.screenshot({ path: path.join(out, 'quiet-landing-applied.png') })
  } finally {
    await browser.close().catch(() => {})
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n[drive] ${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
