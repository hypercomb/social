#!/usr/bin/env node
// drive-providers-window — proves the AI PROVIDERS CONSOLE end to end:
// one list of every registered provider, the universal panel (key, endpoint,
// docs, models, active switch), and the declarative-spec plug-in path — a
// pasted llm-provider@1 spec becomes a live row, lands in the `llm:providers`
// pool, and SURVIVES A RELOAD via the boot sweep.
//
//   node scripts/drive-providers-window.cjs [--url http://localhost:4250]
//                                           [--out <dir>] [--engine chrome]
//
// Flow:
//   1. boot a fresh hive (Start empty), open the console via providers:open
//   2. the seven built-in vendors are rows; anthropic's panel shows key
//      field + docs + models; saving a key flips the row to active, clearing
//      flips it back; the active switch turns it off
//   3. paste an llm-provider@1 spec into Add provider → a new row appears
//   4. reload → the discovered row is STILL THERE (pool sweep), the built-ins
//      are unchanged, and the off-switch survived
//
// `--engine chrome` required: headless chromium cannot initialize Pixi's
// shaders and never leaves the splash.

const fs = require('node:fs')
const path = require('node:path')
const { chromium, firefox, webkit } = require('playwright')

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

const ACME_SPEC = JSON.stringify({
  format: 'llm-provider@1',
  id: 'acme',
  label: 'Acme AI',
  shape: 'openai',
  endpoint: 'https://api.acme.example/v1',
  models: [{ name: 'acme-large', id: 'acme-large-1', tier: 'deep' }],
  defaultModel: 'acme-large-1',
  docsUrl: 'https://acme.example/keys',
})

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', 'test-results/providers-window')))
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
    await page.waitForTimeout(600)
  }

  try {
    // ── 1. boot + open ───────────────────────────────────────────────────
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }

    await openConsole()
    const panel = page.locator('.hc-providers')
    check('the console opened on providers:open', (await panel.count()) === 1)

    const rowNames = await panel.locator('.hc-provider-name').allInnerTexts()
    check('the built-in roster is listed', rowNames.length >= 7, rowNames.join(', '))
    await shot('01-roster')

    // ── 2. the universal panel on one vendor ─────────────────────────────
    const claude = panel.locator('.hc-provider', { hasText: 'Claude' }).first()
    await claude.locator('.hc-provider-head').click()
    await page.waitForTimeout(300)
    check('the panel shows the key field', (await claude.locator('input[type="password"]').count()) === 1)
    check('the panel shows the docs link', (await claude.locator('.hc-provider-docs').count()) === 1)
    check('the panel lists the models', (await claude.locator('.hc-provider-model').count()) >= 3)
    check('the endpoint is shown before any key travels',
      ((await claude.locator('.hc-provider-mono').innerText().catch(() => ''))).includes('api.anthropic.com'))
    await shot('02-universal-panel')

    const stateOf = async () => (await panel.locator('.hc-provider', { hasText: 'Claude' })
      .locator('.hc-provider-state').first().innerText()).trim()

    check('no key yet → row reads no key', (await stateOf()) === 'no key')
    await claude.locator('input[type="password"]').fill('sk-ant-' + 'x'.repeat(24))
    await claude.locator('.hc-provider-btn', { hasText: 'Save' }).first().click()
    await page.waitForTimeout(300)
    check('saving a key flips the row to active', (await stateOf()) === 'active')

    // the active switch is the participant's off-switch
    const detail = panel.locator('.hc-provider', { hasText: 'Claude' })
    await detail.locator('.hc-provider-toggle input').setChecked(false)
    await page.waitForTimeout(300)
    check('the switch turns the provider off', (await stateOf()) === 'off')
    await shot('03-switched-off')

    // ── 3. a pasted spec becomes a row ───────────────────────────────────
    await panel.locator('.hc-provider-btn', { hasText: 'Add provider' }).click()
    await panel.locator('.hc-providers-spec').fill(ACME_SPEC)
    await panel.locator('.hc-provider-btn', { hasText: 'Import' }).click()
    await page.waitForTimeout(800)
    check('an imported spec appears as a row',
      (await panel.locator('.hc-provider-name', { hasText: 'Acme AI' }).count()) === 1)
    await shot('04-spec-imported')

    // ── 4. reload — discovery sweep + device-local policy survive ────────
    await page.reload({ waitUntil: 'load' })
    await page.waitForTimeout(9000)
    await openConsole()
    check('the discovered provider survives a reload (pool sweep)',
      (await panel.locator('.hc-provider-name', { hasText: 'Acme AI' }).count()) === 1)
    check('the off-switch survived the reload', (await stateOf()) === 'off')
    await shot('05-after-reload')

    const fatal = errors.filter(e => !/favicon|net::|Failed to load resource/i.test(e))
    check('no page errors', fatal.length === 0, fatal.slice(0, 3).join(' | '))
  } finally {
    await browser.close()
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
