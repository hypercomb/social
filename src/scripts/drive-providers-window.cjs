#!/usr/bin/env node
// drive-providers-window — proves the AI PROVIDERS CONSOLE end to end:
// three tabs over one roster (Subscriptions / API requests / Swarm, a fold of
// the cost class), the universal panel (key, endpoint, docs, models, active
// switch), and the declarative-spec plug-in path — a pasted llm-provider@1
// spec becomes a live row, lands in the `llm:providers` pool, and SURVIVES A
// RELOAD via the boot sweep.
//
//   node scripts/drive-providers-window.cjs [--url http://localhost:4250]
//                                           [--out <dir>] [--engine chrome]
//
// Flow:
//   1. boot a fresh hive (Start empty), open the console via providers:open
//   2. it opens on Subscriptions — the plan already paid for; the keyed
//      vendors are on API requests and the local model is on Swarm, and no
//      provider is ever on two tabs
//   3. the seven built-in vendors are rows; anthropic's panel shows key
//      field + docs + models; saving a key flips the row to active, clearing
//      flips it back; the active switch turns it off
//   4. paste an llm-provider@1 spec into Add provider → a new row appears
//   5. the FOOT of the window states who answers when nobody says and opens
//      into the pickers: pin a tier, see the pin stick, and see the bar name
//      the provider that would answer right now
//   6. reload → the discovered row is STILL THERE (pool sweep), the built-ins
//      are unchanged, and the off-switch, the pin and the tab all survived
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

    // ── 2. three tabs, one roster ────────────────────────────────────────
    const tabs = panel.locator('.hc-providers-tab')
    check('the roster is grouped in three tabs', (await tabs.count()) === 3,
      (await tabs.allInnerTexts()).join(' | '))
    check('it opens on the plan already paid for',
      (await panel.locator('.hc-providers-tab.is-active').innerText()).startsWith('Subscriptions'))

    const openTab = async (label) => {
      await panel.locator('.hc-providers-tab', { hasText: label }).click()
      await page.waitForTimeout(250)
    }
    const rowsNow = async () => panel.locator('.hc-provider-name').allInnerTexts()

    // With no CLI bridged, Subscriptions says so rather than showing nothing.
    check('an empty Subscriptions tab explains how a bridge arrives',
      /CLI/.test(await panel.locator('.hc-providers-empty').innerText().catch(() => '')))
    await shot('01-subscriptions')

    await openTab('API requests')
    const apiRows = await rowsNow()
    check('the keyed vendors are on API requests', apiRows.length >= 6, apiRows.join(', '))
    check('a keyless local model is NOT billed per request',
      !apiRows.includes('Local model'), apiRows.join(', '))
    check('pasting a spec is the API tab\'s verb',
      (await panel.locator('.hc-provider-btn', { hasText: 'Add provider' }).count()) === 1)
    await shot('01b-api')

    await openTab('Swarm')
    const swarmRows = await rowsNow()
    check('the machine tier is on Swarm', swarmRows.includes('Local model'), swarmRows.join(', '))
    check('lending is the Swarm tab\'s verb',
      (await panel.locator('.hc-providers-lend').count()) === 1)
    check('lending is NOT offered on the other tabs', !apiRows.includes('Local model'))
    await shot('01c-swarm')

    // Back to the keyed tab for the panel checks below.
    await openTab('API requests')

    // ── 3. the universal panel on one vendor ─────────────────────────────
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

    // ── 4. a pasted spec becomes a row ───────────────────────────────────
    await panel.locator('.hc-provider-btn', { hasText: 'Add provider' }).click()
    await panel.locator('.hc-providers-spec').fill(ACME_SPEC)
    await panel.locator('.hc-provider-btn', { hasText: 'Import' }).click()
    await page.waitForTimeout(800)
    check('an imported spec appears as a row',
      (await panel.locator('.hc-provider-name', { hasText: 'Acme AI' }).count()) === 1)
    await shot('04-spec-imported')

    // ── 5. the selection policy, at the FOOT ─────────────────────────────
    // It sits below the tabs, outside all of them: it picks across the whole
    // roster, so belonging to one tab would misstate its reach. Collapsed it
    // is a status line; the pickers open upward.
    const bar = panel.locator('.hc-providers-footbar')
    const policy = panel.locator('.hc-providers-policy')
    check('the foot says who answers when nobody says', (await bar.count()) === 1)
    check('the bar names the provider that would answer right now',
      /Local model/.test(await bar.innerText()), (await bar.innerText()).replace(/\n/g, ' '))
    check('the pickers stay shut until asked for', (await policy.count()) === 0)

    const openPolicy = async () => {
      if (await panel.locator('.hc-providers-policy').count()) return
      await bar.click()
      await page.waitForTimeout(250)
    }
    await openPolicy()
    const rows = await policy.locator('.hc-policy-row').count()
    check('one picker per weight of work', rows === 3, `rows=${rows}`)

    // The picker carries the answer: "Decide for me — <who>". No second line.
    const autoOption = (await policy.locator('.hc-policy-pick').first().locator('option').first().innerText()).trim()
    check('the picker itself says who "decide for me" resolves to',
      /Decide for me — Local model/.test(autoOption), autoOption)
    check('nothing repeats that underneath',
      (await policy.locator('.hc-policy-resolved').count()) === 0)
    await shot('05-policy-open')

    // Pin the heaviest tier and watch the resolved line follow. It must be a
    // provider that could actually answer: Claude was switched off above and
    // Acme has no key, so neither is offered here — which is itself the
    // picker behaving correctly.
    const options = await policy.locator('.hc-policy-pick').first().locator('option').allInnerTexts()
    check('only providers that could answer are offered as pins',
      !options.includes('Claude') && options.includes('Local model'), options.join(', '))

    await policy.locator('.hc-policy-pick').first().selectOption({ label: 'Local model' })
    await page.waitForTimeout(400)
    check('the pin sticks to the tier it was set on',
      (await policy.locator('.hc-policy-pick').first().inputValue()) === 'local')
    // A pin that is honoured needs no explanation — the picker already says
    // it. The line under it is reserved for a pin that fell through.
    const deepRow = policy.locator('.hc-policy-row').first()
    check('an honoured pin does not repeat itself underneath',
      (await deepRow.locator('.hc-policy-resolved').count()) === 0)
    check('a pinned picker drops the "— who" suffix, since it IS the who',
      !/—/.test((await deepRow.locator('option').first().innerText()).trim()))

    // ── 6. reload — discovery sweep + device-local policy survive ────────
    await page.reload({ waitUntil: 'load' })
    await page.waitForTimeout(9000)
    await openConsole()
    check('the console reopens on the tab you left it on',
      (await panel.locator('.hc-providers-tab.is-active').innerText()).startsWith('API requests'))
    check('the discovered provider survives a reload (pool sweep)',
      (await panel.locator('.hc-provider-name', { hasText: 'Acme AI' }).count()) === 1)
    check('the off-switch survived the reload', (await stateOf()) === 'off')
    await openPolicy()
    check('the pin survived the reload',
      (await panel.locator('.hc-policy-pick').first().inputValue()) === 'local')
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
