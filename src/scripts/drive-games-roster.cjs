#!/usr/bin/env node
// drive-games-roster — a GAME is a beehaviour, so it has a row and a light.
//
// Games reached the app through a door of their own: a `genotype:'game'` bee,
// a full-screen overlay, `/roper`, a launcher tile. They marked no tile, so the
// roster — which lists decoration KINDS — could never see them, and "turn every
// behaviour off" left four games running. They are now in the pool under the
// kind `game:<gameId>`, and this drives the whole loop:
//
//   the pool lists them  →  the light goes out  →  they are GONE everywhere
//   (launcher, overlay, `/<id>`)  →  the light comes back  →  so do they.
//
//   node scripts/drive-games-roster.cjs [--url http://localhost:4450]
//                                       [--out <dir>] [--engine chrome]

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

/** The pool as the participant reads it, plus the game rows picked out by the
 *  slash chip — the row's own text, not a class we could have invented. */
const SNAP = () => {
  const rows = Array.from(document.querySelectorAll('.features-scroll.store .features-row'))
  const read = (r) => ({
    label: (r.querySelector('.feature-name')?.textContent ?? '').trim(),
    cmd: (r.querySelector('.feature-cmd')?.textContent ?? '').trim(),
    on: r.classList.contains('lit'),
  })
  const all = rows.map(read)
  const ids = ['/arkanoid', '/bubble', '/roper', '/solomon']
  return {
    pool: !!document.querySelector('.features-scroll.store'),
    rows: all.length,
    games: all.filter(r => ids.includes(r.cmd)),
  }
}

/** What the app itself says about a game, with no UI in the way: the bee's own
 *  dormancy answer and whether its overlay is on screen. */
const GAME_STATE = (id) => {
  const ioc = window.ioc
  let bee
  for (const k of ioc.list()) {
    const v = ioc.get(k)
    if (v && v.genotype === 'game' && v.gameId === id) { bee = v; break }
  }
  return {
    found: !!bee,
    dormant: bee ? bee.gameDormant === true : null,
    active: bee ? bee.isActive() === true : null,
  }
}

async function main() {
  const url = String(arg('url', 'http://localhost:4450'))
  const out = path.resolve(String(arg('out', 'test-results/games-roster')))
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
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // ── the games are registered at all ───────────────────────────────
    const roper0 = await page.evaluate(GAME_STATE, 'roper')
    check('the roper bee is registered', roper0.found)

    // ── THE POOL LISTS THEM ───────────────────────────────────────────
    // The roster is the pool lens: raise the panel, then switch scope to it.
    if (!(await page.locator('.features-panel').count())) {
      await page.locator('.rail-btn.features-toggle-btn').click()
      await page.waitForTimeout(4000)
    }
    if (!(await page.locator('.features-scroll.store').count())) {
      await page.locator('.features-panel .scope-toggle').click()
      await page.waitForTimeout(2500)
    }
    await shot('00-pool')

    let s = await page.evaluate(SNAP)
    check('the pool is showing', s.pool, `rows=${s.rows}`)
    check('all four games have a row', s.games.length === 4,
      s.games.map(g => g.cmd).join(' ') || 'none')
    check('each row carries its command', s.games.every(g => g.cmd.startsWith('/')))
    check('a hive that already had them keeps them LIT', s.games.every(g => g.on),
      s.games.map(g => `${g.cmd}=${g.on ? 'on' : 'off'}`).join(' '))

    // ── SWITCHING ONE OFF ─────────────────────────────────────────────
    const roperRow = page.locator('.features-scroll.store .features-row')
      .filter({ hasText: '/roper' }).first()
    await roperRow.click()
    await page.waitForTimeout(2000)
    await shot('05-roper-off')

    const off = await page.evaluate(GAME_STATE, 'roper')
    check('the bee answers DORMANT', off.dormant === true)

    s = await page.evaluate(SNAP)
    const roperRowState = s.games.find(g => g.cmd === '/roper')
    check('its row reads off', roperRowState && !roperRowState.on)
    check('the other three are untouched',
      s.games.filter(g => g.cmd !== '/roper').every(g => g.on))

    // ── OFF MEANS GONE, NOT JUST DARK ─────────────────────────────────
    check('open() refuses while dormant', await page.evaluate(() => {
      window.__roper && window.__roper.open()
      return window.__roper ? window.__roper.isActive() === false : false
    }))
    check('toggle() reports the refusal instead of lying', await page.evaluate(() => {
      return window.__roper ? window.__roper.toggle() === false : false
    }))
    check('it leaves the launcher group', await page.evaluate(() => {
      const ioc = window.ioc
      for (const k of ioc.list()) {
        const v = ioc.get(k)
        if (v && v.genotype === 'game' && v.gameId === 'roper') return v.gameDormant === true
      }
      return false
    }))

    // ── AND IT COMES BACK ─────────────────────────────────────────────
    await roperRow.click()
    await page.waitForTimeout(2000)
    const back = await page.evaluate(GAME_STATE, 'roper')
    check('re-lighting wakes it', back.dormant === false)
    check('and it opens again', await page.evaluate(() => {
      window.__roper && window.__roper.open()
      return window.__roper ? window.__roper.isActive() === true : false
    }))
    await page.evaluate(() => { window.__roper && window.__roper.close() })
    await shot('10-back')

    // ── A RUNNING GAME LEAVES WHEN ITS LIGHT DOES ─────────────────────
    // The overlay covers the whole screen (that is the point of it), so the
    // panel underneath is unreachable by a real click — the flip is driven
    // through the row's own handler instead, which is the same code path.
    await page.evaluate(() => { window.__roper && window.__roper.open() })
    await page.waitForTimeout(1500)
    check('roper opens while lit', (await page.evaluate(GAME_STATE, 'roper')).active)
    await shot('15-running')

    await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.features-scroll.store .features-row'))
        .find(r => (r.querySelector('.feature-cmd')?.textContent ?? '').trim() === '/roper')
      row && row.click()
    })
    await page.waitForTimeout(2000)
    const killed = await page.evaluate(GAME_STATE, 'roper')
    check('switching it off closed the running overlay', killed.dormant === true && killed.active === false,
      `dormant=${killed.dormant} active=${killed.active}`)
    await shot('20-closed-by-switch')
  } finally {
    const pass = checks.filter(c => c.ok).length
    console.log(`\n${pass}/${checks.length} checks passed`)
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 2))
    await browser.close()
    process.exitCode = pass === checks.length ? 0 : 1
  }
}

main()
