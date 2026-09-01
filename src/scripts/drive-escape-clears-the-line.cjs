#!/usr/bin/env node
// drive-escape-clears-the-line — ONE PRESS TAKES THE LINE, THE NEXT GIVES IT BACK.
//
// Escape in the command line used to PEEL: `a/b/c` became `a/b/`, so the press
// that was meant to get rid of what you had typed left most of it sitting
// there and the autocomplete simply recomputed on the shorter line. It takes
// the whole line now — helper and all — and a press IMMEDIATELY after puts it
// back exactly as it was, the same swing the window sweep has.
//
//     type, helper open
//     press  -> empty line, helper gone
//     press  -> the line back, helper back
//     press  -> empty again
//
// A SEPARATE BROWSER PROFILE, always: the packed store admits one writer and a
// second tab on an origin whose hive is already open comes up with a dead
// store. This never points the in-app browser pane at 4250.
//
//   node scripts/drive-escape-clears-the-line.cjs [--url http://localhost:4250]
//                                                 [--out <dir>] [--engine chrome]

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

const INPUT = '.command-input'
const HELPER = '.command-intel'

const lineValue = (page) => page.$eval(INPUT, el => el.value).catch(() => null)
const helperOpen = async (page) => (await page.locator(HELPER).count()) > 0
const focused = (page) => page.evaluate(
  () => !!document.activeElement && document.activeElement.classList.contains('command-input'))

/** Poll rather than sleep: a flat wait long enough for the slow case would
 *  spend the "immediately after" window this whole file is about. */
const until = async (fn, timeout = 2000) => {
  const started = Date.now()
  for (;;) {
    if (await fn()) return true
    if (Date.now() - started >= timeout) return false
    await new Promise(r => setTimeout(r, 60))
  }
}

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', 'test-results/escape-clears-the-line')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()

  const checks = []
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }

  const press = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(140) }

  /** Put `text` in the line, freshly focused, with the helper given a chance
   *  to open. Typed key by key so the shell's own input path runs. */
  const typeLine = async (text) => {
    await page.click(INPUT)
    await page.$eval(INPUT, el => { el.value = '' })
    await page.keyboard.type(text, { delay: 30 })
    await page.waitForTimeout(500)
  }

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    for (let i = 0; i < 8; i++) {
      if (!(await page.locator('.offer-backdrop').count())) break
      const startEmpty = page.getByText('Start empty', { exact: true })
      if (await startEmpty.count()) await startEmpty.first().click({ force: true }).catch(() => {})
      const dismiss = page.locator('hc-example-hives-offer .dismiss')
      if (await dismiss.count()) await dismiss.first().click({ force: true }).catch(() => {})
      await page.waitForTimeout(900)
    }
    await page.waitForSelector(INPUT, { timeout: 20000 })

    // 1. a command with the helper open
    await typeLine('/pu')
    const typed = await lineValue(page)
    check('a command line with text in it', typed === 'pu', `value=${JSON.stringify(typed)}`)
    check('the autocomplete helper is open over it', await helperOpen(page))

    await press()
    const clearedOk = await until(async () => (await lineValue(page)) === '')
    check('ONE press clears the line', clearedOk, `value=${JSON.stringify(await lineValue(page))}`)
    check('...and takes the helper with it', await until(async () => !(await helperOpen(page))))
    check('...without throwing you off the line', await focused(page))

    await press()
    const back = await until(async () => (await lineValue(page)) === 'pu')
    check('the press immediately after gives the line back', back,
      `value=${JSON.stringify(await lineValue(page))}`)
    check('...with the helper back over it', await until(() => helperOpen(page)))

    await press()
    check('and it swings again — away', await until(async () => (await lineValue(page)) === ''))

    // 2. a PATH no longer peels one segment at a time
    await typeLine('alpha/beta/gamma')
    await press()
    const wholePath = await lineValue(page)
    check('a path goes whole, not one segment per press', wholePath === '',
      `value=${JSON.stringify(wholePath)}`)
    await press()
    const pathBack = await lineValue(page)
    check('...and the whole path comes back', pathBack === 'alpha/beta/gamma',
      `value=${JSON.stringify(pathBack)}`)
    await press()

    // 3. IMMEDIATELY is the point: anything else ends it
    await typeLine('alpha/beta')
    await press()
    check('cleared, ready to be interrupted', (await lineValue(page)) === '')
    await page.keyboard.press('ArrowLeft')        // anything at all
    await page.waitForTimeout(120)
    await press()
    const afterInterrupt = await lineValue(page)
    check('an interrupted press gives nothing back', afterInterrupt === '',
      `value=${JSON.stringify(afterInterrupt)}`)
    check('...and falls through to leaving the line', !(await focused(page)))

    // 4. ...and so does waiting
    await typeLine('alpha/beta')
    await press()
    check('cleared, ready to go stale', (await lineValue(page)) === '')
    await page.waitForTimeout(3400)               // past LINE_REMEMBERED_FOR_MS
    await press()
    const afterWait = await lineValue(page)
    check('a late press gives nothing back', afterWait === '',
      `value=${JSON.stringify(afterWait)}`)

    await page.screenshot({ path: path.join(out, 'command-line.png') })
  } finally {
    const failed = checks.filter(c => !c.ok)
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 2))
    await browser.close()
    process.exitCode = failed.length ? 1 : 0
  }
}

main().catch(e => { console.error(e); process.exit(1) })
