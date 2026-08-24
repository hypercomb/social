#!/usr/bin/env node
// drive-domain-probe — proves CONFIGURATION ARRIVES WITH THE DOMAIN.
//
// A domain publishes an `llm:providers` index at its derived pool address;
// a hive that learns about that domain probes it, verifies every member
// against its signature, and the provider appears in /providers with its
// provenance shown — held, if the domain sends your key somewhere else.
//
//   node scripts/drive-domain-probe.cjs [--url http://localhost:4251]
//                                       [--port 8788] [--out <dir>]
//
// Flow:
//   1. publish two specs to a temp dir (scripts/publish-pool.cjs does the
//      signing) and serve them from a throwaway static host:
//        · one pointing AT the serving host   → arrives usable
//        · one pointing at a THIRD PARTY      → arrives held
//      plus a member the index names whose bytes are TAMPERED — it must be
//      dropped, which is the whole trust argument in one assertion
//   2. boot a hive and tell it the domain exists (`domain:learned`, exactly
//      what the content broker emits when it learns any host)
//   3. the console shows both providers, each with "offered by <host>", the
//      third-party one held with its warning; the forged one is absent
//   4. reload — they are still there (persisted into the llm:providers pool)
//
// `--engine chrome` required: headless chromium cannot initialize Pixi.

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const crypto = require('node:crypto')
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

const sign = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const canonical = (record) => Buffer.from(JSON.stringify(record, null, 2), 'utf8')

async function main() {
  const url = String(arg('url', 'http://localhost:4251'))
  const port = Number(arg('port', 8788))
  const out = path.resolve(String(arg('out', 'test-results/domain-probe')))
  fs.mkdirSync(out, { recursive: true })

  const host = `localhost:${port}`

  // ── the domain's published pool ──────────────────────────────────────
  // Its OWN models: the endpoint is this very host, so nothing is being
  // asked of the participant beyond "here is what I run".
  const ownModels = {
    format: 'llm-provider@1',
    id: 'house-models',
    label: 'House Models',
    shape: 'openai',
    endpoint: `http://${host}/v1`,
    models: [{ name: 'house', id: 'house-1', tier: 'balanced' }],
    defaultModel: 'house-1',
    docsUrl: `http://${host}/keys`,
    requiresKey: false,
  }
  // A THIRD PARTY's endpoint — legitimate for a gateway, and exactly what a
  // hostile spec looks like. Must arrive held.
  const thirdParty = {
    format: 'llm-provider@1',
    id: 'elsewhere-models',
    label: 'Elsewhere Models',
    shape: 'openai',
    endpoint: 'https://api.elsewhere.example/v1',
    models: [{ name: 'elsewhere', id: 'elsewhere-1', tier: 'deep' }],
    defaultModel: 'elsewhere-1',
    docsUrl: 'https://elsewhere.example/keys',
  }
  // Named in the index under a sig it does not hash to. Must be dropped.
  const forged = {
    format: 'llm-provider@1',
    id: 'forged-models',
    label: 'Forged Models',
    shape: 'openai',
    endpoint: 'https://api.forged.example/v1',
    models: [{ name: 'forged', id: 'forged-1', tier: 'deep' }],
    defaultModel: 'forged-1',
    docsUrl: 'https://forged.example/keys',
  }

  const served = new Map()
  const members = []
  for (const record of [ownModels, thirdParty]) {
    const bytes = canonical(record)
    const sig = sign(bytes)
    served.set(sig, bytes)
    members.push(sig)
  }
  // the tampered one: index says <sig of the honest bytes>, server sends other bytes
  const forgedSig = sign(canonical(forged))
  served.set(forgedSig, canonical({ ...forged, label: 'Forged Models (swapped)' }))
  members.push(forgedSig)

  const poolSig = sign(Buffer.from('llm:providers', 'utf8'))
  served.set(poolSig, Buffer.from(JSON.stringify({ meaning: 'llm:providers', members }, null, 2), 'utf8'))
  console.log(`  info  serving ${served.size - 1} members + index (${poolSig.slice(0, 12)}…) on ${host}`)

  const server = http.createServer((req, res) => {
    const name = String(req.url ?? '').replace(/^\//, '').split('?')[0]
    const body = served.get(name)
    // A domain that publishes into a hive on another origin must allow it.
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (!body) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(body)
  })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = async (n) => { await page.screenshot({ path: path.join(out, n + '.png') }) }
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  const openConsole = async () => {
    await page.evaluate(() => window.__hypercombEffectBus.emit('providers:open', {}))
    await page.waitForTimeout(700)
  }

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }

    // ── 2. the hive learns the domain ────────────────────────────────────
    // Exactly what the content broker emits from #learnHost — self domain,
    // community domain, mesh attribution, adopt handoff all land here.
    await page.evaluate(h => window.__hypercombEffectBus.emit('domain:learned', { host: h }), host)
    await page.waitForTimeout(3000)

    await openConsole()
    const panel = page.locator('.hc-providers')
    const names = await panel.locator('.hc-provider-name').allInnerTexts()
    check('a provider the domain offers appears', names.some(n => /House Models/.test(n)), names.join(', '))
    check('a provider pointing at a third party also appears (visible, not hidden)',
      names.some(n => /Elsewhere Models/.test(n)))
    check('the FORGED member was dropped — bytes did not match its signature',
      !names.some(n => /Forged/.test(n)), names.join(', '))
    await shot('01-offered')

    // ── 3. provenance + the hold ─────────────────────────────────────────
    const house = panel.locator('.hc-provider', { hasText: 'House Models' }).first()
    await house.locator('.hc-provider-head').click()
    await page.waitForTimeout(300)
    check('it says which domain offered it',
      ((await house.locator('.hc-provider-origin').innerText().catch(() => ''))).includes(host))
    check('a domain offering its OWN models arrives usable',
      ((await house.locator('.hc-provider-state').first().innerText()).trim()) === 'active')

    const elsewhere = panel.locator('.hc-provider', { hasText: 'Elsewhere Models' }).first()
    check('one that sends your key elsewhere arrives HELD',
      ((await elsewhere.locator('.hc-provider-state').first().innerText()).trim()) === 'held')
    await elsewhere.locator('.hc-provider-head').click()
    await page.waitForTimeout(300)
    check('and says why, with the endpoint in view',
      (await elsewhere.locator('.hc-provider-warn').count()) === 1
      && ((await elsewhere.locator('.hc-provider-mono').innerText().catch(() => '')))
        .includes('api.elsewhere.example'))
    await shot('02-held')

    // turning it on is one click, and it must STICK
    await elsewhere.locator('.hc-provider-toggle input').setChecked(true)
    await page.waitForTimeout(400)

    // ── 4. persisted, and the participant's decision survives ────────────
    await page.reload({ waitUntil: 'load' })
    await page.waitForTimeout(9000)
    await openConsole()
    check('offered providers survive a reload',
      (await panel.locator('.hc-provider-name', { hasText: 'House Models' }).count()) === 1)
    check('turning a held provider on sticks across a re-probe',
      ((await panel.locator('.hc-provider', { hasText: 'Elsewhere Models' })
        .locator('.hc-provider-state').first().innerText()).trim()) === 'no key')
    await shot('03-after-reload')

    const fatal = errors.filter(e => !/favicon|net::|Failed to load resource/i.test(e))
    check('no page errors', fatal.length === 0, fatal.slice(0, 2).join(' | '))
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
