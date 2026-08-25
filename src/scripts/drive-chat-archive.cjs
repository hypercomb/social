#!/usr/bin/env node
// drive-chat-archive — can a conversation be PUT AWAY without being destroyed?
//
//   node scripts/drive-chat-archive.cjs [--url http://localhost:4250] [--out <dir>]
//
// Delete was the only thing you could do with a thread you were finished
// with, and delete is the wrong verb: you are done needing the conversation,
// not done having said it. What is under test:
//
//   1. every conversation in the rail carries an archive control
//   2. pressing it takes the row out of the fold and says how many are away
//   3. the disclosure opens onto them, and the same control brings one back
//   4. THE TURNS SURVIVE — the archived thread still reads back whole
//   5. it holds across a reload: the flag is in the thread's own bucket, not
//      in this tab's memory
//   6. THE CHAT YOU ARE IN can be filed from the bar above the transcript —
//      one press, and the window moves on to the next live thread
//
// Its own Playwright profile, so the hive it writes into is a scratch one —
// it never touches the participant's data, and it needs no bridge.

const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const URL_ = String(arg('url', 'http://localhost:4250'))
const OUT = String(arg('out', path.join('..', 'test-results', 'chat-archive')))

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

/** Drive the threads module directly — this is the pool the UI reads, so
 *  seeding through it is seeding the real thing, not a fixture. */
const threads = (page, method, ...args) => page.evaluate(([m, a]) => {
  const svc = window.ioc?.get('@diamondcoreprocessor.com/ChatThreads')
  return svc ? svc[m](...a) : null
}, [method, args])

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  await page.addInitScript(() => {
    localStorage.setItem('hc:chat-visible', '1')
    localStorage.setItem('hc:bridge-setup-done', '1')
    localStorage.setItem('hc:bridge-setup-tools', '1')
  })
  await page.goto(URL_ + '?claudeBridge=true', { waitUntil: 'domcontentloaded' })
  await page.locator('hc-chat-window .chat-panel').waitFor({ state: 'attached', timeout: 30000 })
  await page.waitForTimeout(3000)

  // Two conversations about the hive itself, so the rail's top row folds open
  // onto a list with something to put away.
  const HIVE = 'chat:tile:/'
  const FILED = 'chat:tile:/::keeper'
  await threads(page, 'appendTurn', HIVE, 'user', 'the thread I am still using')
  await threads(page, 'appendTurn', FILED, 'user', 'the thread I am finished with')
  await threads(page, 'appendTurn', FILED, 'assistant', 'an answer worth keeping')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)

  // Unfold the hive's own row.
  await page.locator('.hc-rail-hive .hc-rail-chev').first().click()
  await page.waitForTimeout(800)

  const names = () => page.$$eval('.hc-rail-chat-name', els => els.map(e => e.textContent))
  check('both conversations are in the fold', (await names()).length === 2, JSON.stringify(await names()))

  const puts = page.locator('.hc-rail-chat-put')
  check('every conversation carries an archive control', await puts.count() === 2)

  // ── 2. put one away ──────────────────────────────────────────────────────
  const rows = await page.$$('.hc-rail-chat')
  let target = null
  for (const row of rows) {
    const name = await row.$eval('.hc-rail-chat-name', e => e.textContent).catch(() => null)
    if (name && name.includes('finished with')) { target = row; break }
  }
  check('the thread to file was found', !!target)
  await (await target.$('.hc-rail-chat-put')).click()
  await page.waitForTimeout(1200)

  check('it left the fold', !(await names()).some(n => n.includes('finished with')), JSON.stringify(await names()))
  const disclosure = page.locator('.hc-rail-archived')
  check('and the fold says how many are away', (await disclosure.textContent() || '').includes('1'),
    await disclosure.textContent())
  await page.screenshot({ path: path.join(OUT, '01-filed.png') })

  // ── 3/4. it is put away, not destroyed ───────────────────────────────────
  const kept = await threads(page, 'readTurns', FILED)
  check('THE TURNS SURVIVE — the thread still reads back whole',
    Array.isArray(kept) && kept.length === 2, `${kept && kept.length} turns`)

  await disclosure.click()
  await page.waitForTimeout(600)
  check('the disclosure opens onto it', (await names()).some(n => n.includes('finished with')),
    JSON.stringify(await names()))
  await page.screenshot({ path: path.join(OUT, '02-archive-open.png') })

  // ── 5. it holds across a reload ──────────────────────────────────────────
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await page.locator('.hc-rail-hive .hc-rail-chev').first().click()
  await page.waitForTimeout(900)
  check('it is STILL away after a reload — the flag is in the thread, not the tab',
    !(await names()).some(n => n.includes('finished with')), JSON.stringify(await names()))

  // ── and back ─────────────────────────────────────────────────────────────
  await page.locator('.hc-rail-archived').click()
  await page.waitForTimeout(600)
  const filedRow = await (await page.$$('.hc-rail-chat.filed'))[0]
  check('an archived row is marked as one', !!filedRow)
  await (await filedRow.$('.hc-rail-chat-put')).click()
  await page.waitForTimeout(1500)
  check('the same control brings it back', (await names()).some(n => n.includes('finished with'))
    && await page.locator('.hc-rail-archived').count() === 0, JSON.stringify(await names()))
  await page.screenshot({ path: path.join(OUT, '03-restored.png') })

  // ── 6. the conversation in hand, filed from the bar ──────────────────────
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await page.locator('.hc-rail-hive .hc-rail-chev').first().click()
  await page.waitForTimeout(900)

  // Land in the thread we are about to file, so "the one in hand" is real.
  const rows2 = await page.$$('.hc-rail-chat')
  for (const row of rows2) {
    const name = await row.$eval('.hc-rail-chat-name', e => e.textContent).catch(() => null)
    if (name && name.includes('finished with')) { await (await row.$('.hc-rail-chat-body')).click(); break }
  }
  await page.waitForTimeout(1200)

  const bar = page.locator('hc-chat-window .chat-bar')
  const put = bar.locator('.chat-put')
  check('the bar carries an archive icon for the chat in hand', await put.count() === 1)
  check('a rule separates it from the add button',
    await bar.locator('.chat-bar-split').count() === 1)
  // Neither icon wears a border — they sit at the end of a row holding a name.
  const bordered = await bar.evaluate(el => {
    const border = (sel) => {
      const node = el.querySelector(sel)
      return node ? getComputedStyle(node).borderTopWidth : 'absent'
    }
    return { put: border('.chat-put'), add: border('.chat-new') }
  })
  check('neither icon is bordered', bordered.put === '0px' && bordered.add === '0px',
    JSON.stringify(bordered))
  check('the icon reads as ARCHIVE while the thread is live',
    (await put.textContent() || '').trim() === 'archive', await put.textContent())
  await page.screenshot({ path: path.join(OUT, '04-bar.png') })

  const title = () => page.locator('hc-chat-window .chat-current-name, hc-chat-window .chat-current')
    .first().textContent()
  const was = await title()
  await put.click()
  await page.waitForTimeout(1800)
  check('one press files it AND moves on', (await title()) !== was, `${was} → ${await title()}`)
  check('it is out of the fold', !(await names()).some(n => n.includes('finished with')),
    JSON.stringify(await names()))
  await page.screenshot({ path: path.join(OUT, '05-bar-filed.png') })

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  await browser.close()
  const failed = results.filter(r => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed — ${OUT}`)
  process.exit(failed ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
