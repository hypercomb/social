#!/usr/bin/env node
// drive-bright-themes — the hive opens bright, and ONE word dresses all of it.
//
// Three things this drives:
//
//   1. THE HIVE OPENS AS HONEY. A shell with no stored preference boots the
//      bright warm look, from the pre-paint snippet through to ThemeService —
//      one theme, no flash of another.
//   2. A THEME SAYS HOW BRIGHT IT IS. `--md-is-light` is declared by every
//      value-set, so the canvas backdrop stops guessing from the theme's NAME
//      and answers correctly for looks nobody hardcoded.
//   3. ONE LOOK DRESSES THE WHOLE APP. `/background honey|bloom|sherbet` sets
//      the backdrop AND the chrome together — the seam where a bright screen
//      could sit under dark panels is closed.
//
//   node scripts/drive-bright-themes.cjs [--url http://localhost:4250]
//                                        [--out <dir>] [--engine chrome]

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

/** Everything a look is, read off the live document. */
const LOOK = () => {
  const cs = getComputedStyle(document.documentElement)
  const v = (n) => cs.getPropertyValue(n).trim()
  const canvas = window.ioc?.get?.('@diamondcoreprocessor.com/CanvasBackground')
  const themeSvc = window.ioc?.get?.('@hypercomb.social/Theme')
  return {
    attr: document.documentElement.getAttribute('data-theme'),
    service: themeSvc?.theme ?? null,
    offered: [...(themeSvc?.themes ?? [])],
    isLight: v('--md-is-light'),
    surface: v('--md-surface'),
    onSurface: v('--md-on-surface'),
    primary: v('--md-primary'),
    elev2: v('--md-elev-2'),
    easing: v('--md-easing-emphasized'),
    durMedium: v('--md-dur-medium'),
    palette: canvas?.resolvedPalette?.() ?? null,
    archetype: canvas?.archetype ?? null,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    // The floating empty-hive card: it reads chrome roles, so a role that
    // stops existing silently drops its `background` declaration and leaves
    // an unreadable card. Read what it actually computes to.
    card: (() => {
      // Find the TITLE by its text and walk out to the card, rather than
      // guessing at the first descendant — the first pass read a layout
      // wrapper that sets no colour of its own and reported plain black.
      const title = [...document.querySelectorAll('*')]
        .find(e => e.textContent?.trim() === 'Your hive is empty')
      const card = title?.closest('div[style*="background"]')
      if (!title || !card) return null
      return {
        bg: getComputedStyle(card).backgroundColor,
        fg: getComputedStyle(title).color,
      }
    })(),
  }
}

/** Perceived luminance of a `rgb()` / `#hex` string, 0..1. */
function luminance(color) {
  let r, g, b
  const m = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (m) { [, r, g, b] = m.map(Number) }
  else {
    const h = String(color).replace('#', '')
    if (h.length !== 6) return NaN
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
  }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

const emit = (page, effect, payload) =>
  page.evaluate(([e, p]) => window.__hypercombEffectBus.emit(e, p), [effect, payload])

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', 'test-results/bright-themes')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  // A DARK-OS machine on purpose: the old name-matching #isLight() fell
  // through to prefers-color-scheme for any theme it did not recognise, so a
  // bright look read as dark here. This is the case that used to break.
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark' })
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
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    await shot('00-opens-honey')

    // ── 1. THE HIVE OPENS BRIGHT ──────────────────────────────────────
    let s = await page.evaluate(LOOK)
    check('a fresh shell opens as honey', s.attr === 'honey', `data-theme=${s.attr}`)
    check('the service agrees with the pre-paint stamp', s.service === 'honey' && s.service === s.attr,
      `service=${s.service} attr=${s.attr}`)
    check('and it is genuinely bright', luminance(s.surface) > 0.9,
      `surface=${s.surface} luminance=${luminance(s.surface).toFixed(2)}`)
    check('text on it is ink, not grey', luminance(s.onSurface) < 0.2,
      `on-surface=${s.onSurface} luminance=${luminance(s.onSurface).toFixed(2)}`)
    check('the page itself is painted bright', luminance(s.bodyBg) > 0.85, `body=${s.bodyBg}`)
    check('the empty-hive card kept a ground to sit on',
      !!s.card && !/rgba\(0, 0, 0, 0\)|transparent/.test(s.card.bg), `card bg=${s.card?.bg}`)
    check('and its text contrasts with that ground',
      !!s.card && Math.abs(luminance(s.card.bg) - luminance(s.card.fg)) > 0.35,
      `bg=${s.card?.bg} fg=${s.card?.fg}`)

    // ── the fun levers, which are not effects ─────────────────────────
    check('elevation is lit, not sooty', /rgba\(120,\s*80,\s*10/.test(s.elev2), s.elev2.slice(0, 48))
    check('the motion has a little spring', /1\.0[0-9]/.test(s.easing), `emphasized=${s.easing}`)
    check('and it is quicker than the baseline', parseInt(s.durMedium, 10) < 250, `medium=${s.durMedium}`)

    // ── 2. THE THEME DECLARES ITS OWN BRIGHTNESS ──────────────────────
    check('the theme says it is light', s.isLight === '1', `--md-is-light=${s.isLight}`)
    check('so the backdrop is bright too — on a DARK-OS machine',
      s.palette === 'honey', `resolvedPalette=${s.palette}`)

    check('/theme offers the three looks beside light and dark',
      ['light', 'dark', 'honey', 'bloom', 'sherbet'].every(t => s.offered.includes(t)),
      s.offered.join(', '))

    // ── 3. ONE LOOK DRESSES THE WHOLE APP ─────────────────────────────
    const bg = async (name) => {
      await page.evaluate(async (n) => {
        const svc = window.ioc?.get?.('@diamondcoreprocessor.com/BackgroundThemes')
        await svc?.set?.(n)
      }, name)
      await page.waitForTimeout(1200)
      return page.evaluate(LOOK)
    }

    for (const [name, pal, arch] of [['bloom', 'bloom', 'mesh'], ['sherbet', 'sherbet', 'dots']]) {
      s = await bg(name)
      await shot(`10-${name}`)
      check(`/background ${name} dresses the chrome`, s.attr === name && s.service === name,
        `data-theme=${s.attr}`)
      check(`/background ${name} dresses the screen with it`, s.palette === pal && s.archetype === arch,
        `${s.palette}/${s.archetype}`)
      check(`${name} is bright`, luminance(s.surface) > 0.9, `surface=${s.surface}`)
    }

    // ── a picture-only theme leaves the chrome ALONE ──────────────────
    const before = (await page.evaluate(LOOK)).attr
    s = await bg('nature')
    check('a theme that names no chrome does not touch the panels',
      s.attr === before, `stayed on ${s.attr} (was ${before})`)

    // ── and the dimmer still works ────────────────────────────────────
    await page.evaluate(() => window.ioc?.get?.('@hypercomb.social/Theme')?.setTheme?.('dark'))
    await page.waitForTimeout(900)
    s = await page.evaluate(LOOK)
    await shot('20-dark-still-works')
    check('dark is still one word away', s.attr === 'dark' && s.isLight === '0',
      `data-theme=${s.attr} is-light=${s.isLight}`)
    check('and the surface went dark with it', luminance(s.surface) < 0.15, `surface=${s.surface}`)
    check('the card is still readable in dark', !!s.card &&
      Math.abs(luminance(s.card.bg) - luminance(s.card.fg)) > 0.35,
      `bg=${s.card?.bg} fg=${s.card?.fg}`)

    await page.evaluate(() => window.ioc?.get?.('@hypercomb.social/Theme')?.setTheme?.('honey'))
    await page.waitForTimeout(900)
    await shot('30-back-to-honey')
  } finally {
    const pass = checks.filter(c => c.ok).length
    console.log(`\n${pass}/${checks.length} checks passed`)
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 2))
    await browser.close()
    process.exitCode = pass === checks.length ? 0 : 1
  }
}

main()
