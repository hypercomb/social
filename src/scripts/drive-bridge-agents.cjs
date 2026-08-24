#!/usr/bin/env node
// drive-bridge-agents — proves A BRIDGE FOR EVERY FRONTIER MODEL, end to end:
// a CLI installed on this machine is probed locally, announced over the SAME
// broker every bridge client uses, and becomes a row in the providers console
// with no key field, a "reads the hive" badge, and command-line model words.
//
//   node scripts/drive-bridge-agents.cjs [--url http://localhost:4251]
//                                        [--out <dir>] [--engine chrome]
//
// Flow:
//   1. boot a fresh hive with ?claudeBridge=true so the tab registers as the
//      broker's renderer (the announce op is routed to it)
//   2. send `agents-announce` with the roster's real probe result PLUS two
//      synthetic bridges (Codex, Gemini) so the multi-vendor case is proven
//      on a machine that has only Claude Code installed
//   3. the console lists each bridge: no key field (the CLI carries its own
//      account), a reads-the-hive badge, the bridge transport label
//   4. a bridge is NOT fetchable — asking dispatch to call it raises the
//      honest error instead of inventing a URL
//   5. the model words reach the command line (`/gemini` is offered)
//   6. reload — the bridges are still there (the llm:providers pool sweep)
//
// Requires the broker (scripts/bridge/run-bridge.cjs) on ws://localhost:2401.
// `--engine chrome` required: headless chromium cannot initialize Pixi.

const fs = require('node:fs')
const path = require('node:path')
const WebSocket = require('ws')
const { chromium, firefox, webkit } = require('playwright')
const roster = require('./bridge/agent-roster.cjs')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

function launcherFor(name) {
  switch (String(name)) {
    case 'firefox': return { type: firefox, opts: {} }
    case 'webkit': return { type: webkit, opts: {} }
    case 'msedge': return { type: chromium, opts: { channel: 'msedge' } }
    case 'chromium': return { type: chromium, opts: {} }
    default: return { type: chromium, opts: { channel: 'chrome' } }
  }
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'

function announce(agents) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const timer = setTimeout(() => { try { ws.close() } catch {} ; reject(new Error('bridge timeout')) }, 20_000)
    ws.on('open', () => ws.send(JSON.stringify({ id: `drive-${Date.now()}`, op: 'agents-announce', agents })))
    ws.on('message', raw => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      try { ws.close() } catch {}
    })
    ws.on('error', err => { clearTimeout(timer); reject(err) })
  })
}

// Two bridges this machine does not have, so the multi-vendor path is proven
// regardless of what is installed. Same shape the probe produces.
const SYNTHETIC = ['codex-bridge', 'gemini-bridge']
  .map(id => roster.declared().find(a => a.id === id))
  .filter(Boolean)
  .map(roster.toProviderSpec)

async function main() {
  const url = String(arg('url', 'http://localhost:4251'))
  const out = path.resolve(String(arg('out', 'test-results/bridge-agents')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = async (name) => { await page.screenshot({ path: path.join(out, name + '.png') }) }
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  const openConsole = async () => {
    await page.evaluate(() => window.__hypercombEffectBus.emit('providers:open', {}))
    await page.waitForTimeout(700)
  }

  try {
    // ── 1. boot, THEN become the broker's renderer ───────────────────────
    //
    // Order matters: the bridge flag also opens the chat window, which lies
    // over the first-boot offer and makes it unclickable. So answer the offer
    // on a plain boot, then turn the bridge on through its storage flag (the
    // same switch the query parameter sets) and reload into it.
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }

    await page.evaluate(() => localStorage.setItem('hypercomb.claudeBridge.enabled', 'true'))
    await page.reload({ waitUntil: 'load' })
    await page.waitForTimeout(9000)
    // The chat window is the bridge's own surface; close it so the console
    // under test is the only panel on screen.
    await page.evaluate(() => window.__hypercombEffectBus.emit('chat:close', {}))
    await page.waitForTimeout(1500)

    // ── 2. probe locally, announce over the broker ───────────────────────
    const installed = roster.installed()
    console.log(`  info  installed bridges: ${installed.map(a => a.id).join(', ') || 'none'}`)
    const specs = [...installed.map(roster.toProviderSpec), ...SYNTHETIC]
    let reply
    try { reply = await announce(specs) } catch (err) { reply = { ok: false, error: String(err) } }
    check('the broker routed agents-announce to the hive', reply.ok === true,
      reply.ok ? `registered ${reply.data?.registered}` : String(reply.error))
    check('every announced bridge was accepted',
      (reply.data?.rejected ?? []).length === 0,
      JSON.stringify(reply.data?.rejected ?? []))
    await page.waitForTimeout(1200)

    // ── 3. they are rows in the ONE list ─────────────────────────────────
    await openConsole()
    const panel = page.locator('.hc-providers')
    const named = await panel.locator('.hc-provider-name').allInnerTexts()
    check('the bridges joined the provider list', named.some(n => /Gemini CLI/.test(n)),
      named.join(', '))
    await shot('01-bridges-listed')

    const gemini = panel.locator('.hc-provider', { hasText: 'Gemini CLI' }).first()
    await gemini.locator('.hc-provider-head').click()
    await page.waitForTimeout(300)
    check('a bridge asks for no key', (await gemini.locator('input[type="password"]').count()) === 0)
    check('a bridge is badged as reading the hive',
      (await gemini.locator('.hc-provider-badge.is-hive').count()) === 1)
    check('a bridge names its transport, not an endpoint',
      (await gemini.locator('.hc-provider-badge', { hasText: 'live agent session' }).count()) === 1
      && (await gemini.locator('.hc-provider-mono').count()) === 0)
    check('a bridge lists its models', (await gemini.locator('.hc-provider-model').count()) >= 1)
    await shot('02-bridge-panel')

    // ── 4. a bridge is not fetchable ─────────────────────────────────────
    const refusal = await page.evaluate(async () => {
      const registry = window.ioc?.get?.('@diamondcoreprocessor.com/LlmProviderRegistry')
      const provider = registry?.get?.('gemini-bridge')
      if (!provider) return 'no provider'
      try {
        provider.toRequest({ model: 'x', messages: [], apiKey: '' })
        return 'built a request (WRONG)'
      } catch (err) { return String(err?.message ?? err) }
    })
    check('a bridge refuses to be called over HTTP', /cannot be called over HTTP/.test(refusal), refusal)

    // ── 5. its model words reach the command line ────────────────────────
    const words = await page.evaluate(() => {
      const drone = window.ioc?.get?.('@diamondcoreprocessor.com/SlashBehaviourDrone')
      return (drone?.all?.() ?? []).map(b => b.name)
    })
    check('the bridge model words are offered as commands',
      words.includes('gemini') && words.includes('codex') && words.includes('opus'),
      words.filter(w => /gemini|codex|opus|sonnet/.test(w)).join(', '))

    // ── 6. they survive a reload (the pool sweep) ────────────────────────
    await page.reload({ waitUntil: 'load' })
    await page.waitForTimeout(9000)
    await page.evaluate(() => window.__hypercombEffectBus.emit('chat:close', {}))
    await page.waitForTimeout(800)
    await openConsole()
    check('the bridges survive a reload (pool sweep)',
      (await panel.locator('.hc-provider-name', { hasText: 'Gemini CLI' }).count()) === 1)
    await shot('03-after-reload')

    const fatal = errors.filter(e => !/favicon|net::|Failed to load resource/i.test(e))
    check('no page errors', fatal.length === 0, fatal.slice(0, 2).join(' | '))
  } finally {
    await browser.close()
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
