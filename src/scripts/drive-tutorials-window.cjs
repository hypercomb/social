#!/usr/bin/env node
// drive-tutorials-window — the guided tours are a TOOL WINDOW now.
//
// `/tutorial` used to fly the starter course on the spot, and the only surface
// that had ever LISTED the courses was a fixed-position flyout on Ctrl+click
// over the rail's bee. This proves the replacement:
//
//   • the bare command opens the window instead of flying anything,
//   • the roster carries what the flyout could not — a blurb per course, a
//     blurb per lesson, topic marks, curriculum numbers, progress,
//     • search narrows it and auto-opens the courses it matched,
//   • the rail's bee toggles the same window (one door, not two),
//   • an argument still flies directly — `/tutorial <lesson>` is unchanged,
//   • the old flyout is gone.
//
//   node scripts/drive-tutorials-window.cjs [--url http://localhost:4250]
//                                           [--out <dir>] [--engine chrome]

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

const emit = (page, effect, payload) =>
  page.evaluate(([e, p]) => window.__hypercombEffectBus.emit(e, p), [effect, payload])

/** One read of the whole window. */
const SNAP = () => {
  const q = (s) => document.querySelector(s)
  const all = (s) => Array.from(document.querySelectorAll(s))
  const text = (el) => (el?.textContent ?? '').trim()
  const courses = all('.tut-course').map(section => ({
    title: text(section.querySelector('.tut-course-line strong')),
    blurb: text(section.querySelector('.tut-course-copy small')),
    pill: text(section.querySelector('.tut-pill')),
    step: text(section.querySelector('.tut-hex-step')),
    open: section.classList.contains('is-open'),
    lessons: Array.from(section.querySelectorAll('.tut-lesson')).map(row => ({
      title: text(row.querySelector('.tut-lesson-copy strong')),
      about: text(row.querySelector('.tut-about')),
      topics: Array.from(row.querySelectorAll('.tut-topic')).map(t => text(t)),
      number: text(row.querySelector('.tut-num')),
      flown: row.classList.contains('is-flown'),
    })),
  }))
  return {
    panel: !!q('.tut-panel'),
    header: text(q('.tut-title')),
    // The shared chrome, proving this is a tool window and not a bespoke box.
    grip: !!q('.tut-panel [class*="grip"], .tut-panel .hc-panel-grip'),
    gear: !!q('.tut-panel [class*="gear"]'),
    overall: text(q('.tut-count')),
    // The one door is the FIRST ROW of the list now, not a card above it.
    continueIsFirstRow: q('.tut-scroll')?.firstElementChild?.classList.contains('tut-continue') === true,
    continueLabel: text(q('.tut-continue-copy strong')),
    continueKind: text(q('.tut-continue-copy small')),
    footer: text(q('.tut-footer span')),
    flying: !!q('.tut-flying'),
    matches: text(q('.tut-matches')),
    legacyFlyout: !!q('.tour-menu:not(.home-menu):not(.view-menu)'),
    courses,
  }
}

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', 'test-results/tutorials-window')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  const shot = async (n) => { await page.screenshot({ path: path.join(out, n + '.png') }) }

  const checks = []
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)

    // A fresh profile boots the example-hives offer over the line, and its
    // BACKDROP intercepts pointer events until the offer is really gone — a
    // single click sometimes lands on the backdrop instead. Loop until the
    // backdrop is off the page rather than assuming one press did it.
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!(await page.locator('.offer-backdrop').count())) break
      const startEmpty = page.getByText('Start empty', { exact: true })
      if (await startEmpty.count()) await startEmpty.first().click({ force: true }).catch(() => {})
      const dismiss = page.locator('hc-example-hives-offer .dismiss')
      if (await dismiss.count()) await dismiss.first().click({ force: true }).catch(() => {})
      await page.waitForTimeout(900)
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // Progress is participant-local; start from nothing so the numbers are
    // this run's, not whatever the profile had.
    await page.evaluate(() => localStorage.removeItem('hc:tutorial:flown'))

    // ── the bare command opens the roster, and flies nothing ──────────
    await emit(page, 'command-line:remote-submit', { text: '/tutorial' })
    await page.waitForTimeout(1500)
    let snap = await page.evaluate(SNAP)
    await shot('01-opened-by-command')

    check('the bare command opens the window', snap.panel)
    check('it flies nothing', !snap.flying && !(await page.locator('hc-bee-tutorial.active').count()))
    check('the old Ctrl+click flyout is gone', !snap.legacyFlyout)
    check('four courses are listed', snap.courses.length === 4,
      snap.courses.map(c => `${c.title} ${c.pill}`).join(' | '))
    check('every course says what it is for',
      snap.courses.every(c => c.blurb.length > 20),
      snap.courses.map(c => c.blurb.slice(0, 34)).join(' | '))
    check('exactly one course is open on arrival',
      snap.courses.filter(c => c.open).length === 1)

    const open = snap.courses.find(c => c.open)
    check('its lessons carry a one-line description',
      !!open && open.lessons.length > 0 && open.lessons.every(l => l.about.length > 20),
      open ? `${open.lessons.length} lessons, e.g. "${open.lessons[0]?.about.slice(0, 46)}…"` : 'no open course')
    check('lessons are numbered in curriculum order',
      !!open && open.lessons.map(l => l.number).join(',') === open.lessons.map((_, i) => String(i + 1)).join(','))
    check('lessons wear their topic marks',
      !!open && open.lessons.every(l => l.topics.length > 0),
      open ? open.lessons.slice(0, 3).map(l => l.topics.join('+')).join(' | ') : '')
    check('the one door offers the first lesson',
      snap.continueLabel.length > 0 && /start/i.test(snap.continueKind),
      `${snap.continueKind} → ${snap.continueLabel}`)
    check('it leads the list rather than sitting above it', snap.continueIsFirstRow)
    check('the footer counts the whole roster', /\d+ lessons in \d+ courses/.test(snap.footer), snap.footer)

    // ── it is a tool window: the shared chrome is there ───────────────
    const chrome = await page.evaluate(() => {
      const panel = document.querySelector('.tut-panel')
      if (!panel) return null
      const style = getComputedStyle(panel)
      const header = document.querySelector('.tut-header')
      return {
        width: panel.getBoundingClientRect().width,
        scale: style.getPropertyValue('--hc-panel-scale').trim(),
        headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
        children: Array.from(panel.children).map(c => c.className).join(','),
      }
    })
    check('the docked-panel directive is driving it',
      !!chrome && chrome.scale !== '' && chrome.width >= 300,
      chrome ? `width ${Math.round(chrome.width)} scale ${chrome.scale}` : 'no panel')
    check('it takes the common header band (2.875rem ≈ 46px)',
      !!chrome && Math.abs(chrome.headerHeight - 46) <= 2, chrome ? `${chrome.headerHeight}px` : '')

    // ── search narrows it, and opens what it matched ──────────────────
    // A SEARCH NARROWS THE LIST, NEVER THE FACTS. The totals, the overall
    // progress, a course's step in the ramp and the Continue button all
    // describe the WHOLE roster. Computing them off the filtered set made
    // "0/44 · Create a tile" become "0/28 · Select tiles" the moment a word
    // was typed — a window changing its own subject under you.
    const whole = {
      footer: snap.footer,
      overall: snap.overall,
      next: snap.continueLabel,
      steps: Object.fromEntries(snap.courses.map(c => [c.title, c.step])),
    }
    await page.locator('.tut-search input').fill('note')
    await page.waitForTimeout(600)
    snap = await page.evaluate(SNAP)
    await shot('02-searched')
    const hits = snap.courses.reduce((n, c) => n + c.lessons.length, 0)
    check('search narrows the roster', hits > 0 && hits < 45, `${hits} rows, "${snap.matches}"`)
    check('search opens every course it matched', snap.courses.every(c => c.open))
    check('the roster totals do not move', snap.footer === whole.footer && snap.overall === whole.overall,
      `${whole.footer} / ${whole.overall} → ${snap.footer} / ${snap.overall}`)
    check('the Continue row stands down while searching', !snap.continueIsFirstRow && !snap.continueLabel,
      snap.continueLabel || 'absent')
    check('a course keeps its step in the ramp',
      snap.courses.every(c => c.step === whole.steps[c.title]),
      snap.courses.map(c => `${c.title} ${c.step} (was ${whole.steps[c.title]})`).join(' | '))
    check('every row shown actually matches',
      snap.courses.every(c => c.lessons.every(l =>
        /note/i.test(l.title + l.about + l.topics.join(' ')) || /note/i.test(c.title))))

    await page.locator('.tut-clear').click()
    await page.waitForTimeout(500)
    snap = await page.evaluate(SNAP)
    check('and comes back naming the same lesson', snap.continueIsFirstRow && snap.continueLabel === whole.next,
      `${whole.next} → ${snap.continueLabel}`)

    // ── progress: a flown lesson ticks, and Continue moves on ─────────
    const first = (await page.evaluate(SNAP)).courses.find(c => c.open)?.lessons[0]?.title
    await emit(page, 'tutorial:flown', { lesson: 'create', level: 'starter' })
    await page.waitForTimeout(500)
    snap = await page.evaluate(SNAP)
    await shot('03-one-flown')
    check('a flown lesson is ticked', snap.courses.some(c => c.lessons.some(l => l.flown)))
    check('Continue moves to the next unflown lesson',
      snap.continueLabel !== first && /continue/i.test(snap.continueKind),
      `was "${first}", now "${snap.continueLabel}"`)
    check('the course pill counts it', snap.courses.some(c => /^1\//.test(c.pill)),
      snap.courses.map(c => c.pill).join(' '))

    // ── the flying banner and its Stop ────────────────────────────────
    await emit(page, 'tutorial:flying', { running: true, level: 'starter', lesson: 'go-in' })
    await page.waitForTimeout(400)
    snap = await page.evaluate(SNAP)
    await shot('04-flying')
    check('a running tour shows in the window', snap.flying)
    check('the banner names the lesson',
      await page.locator('.tut-flying-copy strong').first().textContent().then(t => (t ?? '').trim().length > 3))
    await emit(page, 'tutorial:flying', { running: false })
    await page.waitForTimeout(300)
    check('the banner leaves with the tour', !(await page.evaluate(SNAP)).flying)

    // ── the rail's bee is the same door ───────────────────────────────
    await page.locator('.tut-close').click()
    await page.waitForTimeout(500)
    check('× closes it', !(await page.evaluate(SNAP)).panel)

    const bee = page.locator('.rail-tutorial')
    if (await bee.count()) {
      await bee.first().click()
      await page.waitForTimeout(900)
      check('the rail bee opens the same window', (await page.evaluate(SNAP)).panel)
      check('the bee lights while it is showing',
        await bee.first().evaluate(el => el.classList.contains('active')))
      await bee.first().click()
      await page.waitForTimeout(700)
      check('the bee closes it again', !(await page.evaluate(SNAP)).panel)
    } else {
      check('the rail bee is on screen', false, 'rail absent at this viewport')
    }

    // ── an argument still flies, unchanged ────────────────────────────
    await emit(page, 'command-line:remote-submit', { text: '/tutorial go-in' })
    await page.waitForTimeout(2500)
    const flew = await page.locator('hc-bee-tutorial.active').count()
    await shot('05-argument-still-flies')
    check('an argument still flies the tour directly', flew > 0)
    await emit(page, 'tutorial:stop', {})
    await page.waitForTimeout(1200)

    await emit(page, 'tutorials:open', {})
    await page.waitForTimeout(800)
    await shot('06-final')
  } catch (err) {
    check('run completed', false, String(err && err.message ? err.message : err))
  } finally {
    const failed = checks.filter(c => !c.ok)
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
    console.log(`shots → ${out}`)
    await browser.close()
    process.exit(failed.length ? 1 : 0)
  }
}

main()
