#!/usr/bin/env node
// drive-darts-house — plays the lounge dartboard with Playwright and reports
// what the house did about it.
//
// Vendor-neutral: no bridge, no running renderer to attach to. It opens the
// built preview page, walks to the oche, puts darts in at exact bed centres
// through `RevLounge3D.oche.throwAt`, and reads back the chalkboard state, the
// `lounge3d:call` events and the ledger the page wrote.
//
//   node scripts/drive-darts-house.cjs [--page site-preview/revolucion-lounge.html]
//                                     [--engine chromium|msedge|chrome]
//                                     [--shot darts.png] [--keep]
//
// Build the page first: npx tsx scripts/intel-build-revolucion-site.ts --preview site-preview

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
    case 'chrome': return { type: chromium, opts: { channel: 'chrome' } }
    default: return { type: chromium, opts: {} }
  }
}

const pass = []
const fail = []
function check(name, ok, detail) {
  ;(ok ? pass : fail).push(detail ? `${name} — ${detail}` : name)
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const pageFile = String(arg('page', 'site-preview/revolucion-lounge.html'))
  const url = 'file:///' + path.resolve(pageFile).replace(/\\/g, '/')
  const { type, opts } = launcherFor(arg('engine', 'chromium'))
  const browser = await type.launch({ headless: !arg('keep', false), ...opts })
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(url, { waitUntil: 'load' })

  // the room boots off an idle callback
  await page.waitForFunction(() => !!window.RevLounge3D?.oche, null, { timeout: 20000 })
    .catch(() => {})
  const booted = await page.evaluate(() => !!window.RevLounge3D?.oche)
  check('the room boots and exposes the oche', booted)
  if (!booted) {
    console.log(errors.slice(0, 6).join('\n'))
    await browser.close()
    process.exit(1)
  }

  // record every call the board pays, and step the clock ourselves so the test
  // does not depend on how fast this machine paints
  await page.evaluate(() => {
    window.__calls = []
    window.addEventListener('lounge3d:call', e => window.__calls.push(e.detail))
    window.__matches = []
    window.addEventListener('lounge3d:match', e => window.__matches.push(e.detail))
    window.RevLounge3D.view('darts')
  })
  const step = (n = 90) => page.evaluate(k => {
    for (let i = 0; i < k; i++) window.RevLounge3D.frame()
  }, n)
  const state = () => page.evaluate(() => window.RevLounge3D.oche.state())
  const calls = () => page.evaluate(() => window.__calls.slice())
  // Board-local bed centres, computed by the same rules the board scores with.
  const NUMS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]
  const bed = (n, mult) => {
    if (n === 25) return { x: 0, y: 0 }
    const R = 0.27
    const rings = { dblOut: 0.78125, dblIn: 0.7445, trOut: 0.4917, trIn: 0.455 }
    const a = NUMS.indexOf(n) * ((Math.PI * 2) / 20)
    const r = mult === 3 ? (rings.trIn + rings.trOut) / 2
      : mult === 2 ? (rings.dblIn + rings.dblOut) / 2
        : (rings.trOut + rings.dblIn) / 2
    return { x: Math.sin(a) * r * R, y: Math.cos(a) * r * R }
  }
  /** Put one dart in and let it land (the flight is 0.26s). */
  const throwAt = async (n, mult, jitter = 0) => {
    const c = bed(n, mult)
    const ok = await page.evaluate(({ x, y }) => window.RevLounge3D.oche.throwAt(x, y),
      { x: c.x + jitter, y: c.y })
    await step(40)
    return ok
  }
  /** Wait out the between-turns beat and the Colonel's three darts. */
  const untilMyThrow = async (limit = 60) => {
    for (let i = 0; i < limit; i++) {
      const s = await state()
      if (s.turn === 'you' && s.darts.length === 0) return true
      await step(30)
    }
    return false
  }

  await step(120)
  const first = await state()
  check('the room commits to the board at the oche',
    first.oche > 0.8 && first.crowdUp >= 2, `oche ${first.oche}, ${first.crowdUp} standing`)
  check('two regulars are there before you', first.fans === 2 && first.mult === 1,
    `fans ${first.fans} ×${first.mult}`)
  check('a side bet is drawn and chalked', typeof first.sideBet === 'string' && !!first.sideBet,
    String(first.sideBet))

  if (first.turn !== 'you') await untilMyThrow()

  // ── A TON EIGHTY ───────────────────────────────────────────────────────
  await throwAt(20, 3)
  const afterOne = await state()
  check('a treble brings one over and scores the ring on the tally',
    afterOne.fans === 3 && afterOne.tally >= 9, `fans ${afterOne.fans}, tally ${afterOne.tally}`)
  check('the crowd is already worth double', afterOne.mult === 2, `×${afterOne.mult}`)
  await throwAt(20, 3)
  await throwAt(20, 3)
  const after180 = await state()
  check('180 is called a ton eighty', after180.shout === 'TON EIGHTY', after180.shout)
  check('the maximum fills the room', after180.fans >= 9 && after180.mult === 4,
    `fans ${after180.fans} ×${after180.mult}`)
  check('501 came down by 180, and by nothing else',
    after180.you === 321, `you ${after180.you}`)
  const paid180 = await calls()
  const ton80 = paid180.find(c => c.id === 'ton80')
  check('the ton eighty pays at the multiplier the room reached',
    !!ton80 && ton80.embers === ton80.base * ton80.mult && ton80.mult > 1,
    ton80 && `${ton80.base} × ${ton80.mult} = ${ton80.embers}`)
  check('the side bets under it paid too, quietly',
    paid180.some(c => c.id === 'ring') && paid180.some(c => c.id === 'evens'),
    paid180.map(c => c.id).join(', '))
  check('the tally counted 27 for three trebles', after180.tally >= 27, String(after180.tally))

  // ── A STRAIGHT ─────────────────────────────────────────────────────────
  await untilMyThrow()
  await throwAt(20, 3)
  await throwAt(19, 3)
  await throwAt(18, 3)
  const straight = await state()
  const paidStraight = (await calls()).filter(c => c.id === 'straight')
  check('20, 19, 18 in the treble ring is a straight',
    paidStraight.length === 1, straight.shout + ' / ' + JSON.stringify(paidStraight[0] || {}))
  check('the straight outranks the staircase and the treble ring',
    !(await calls()).some(c => ['staircase'].includes(c.id)))

  // ── A SMOKE RING, PUT THROUGH THE EYE ──────────────────────────────────
  await untilMyThrow()
  let ring = null
  for (let i = 0; i < 60 && !ring; i++) {
    await step(60)
    ring = (await state()).ring
  }
  check('a smoke ring drifts onto the board', !!ring, ring && JSON.stringify(ring))
  if (ring) {
    // wait for it to be properly lit, then put one through the middle of it
    for (let i = 0; i < 20; i++) {
      const s = await state()
      if (s.ring && s.ring.lit > 0.2) { ring = s.ring; break }
      await step(10)
    }
    const threaded = await page.evaluate(({ x, y }) => window.RevLounge3D.oche.throwAt(x, y), ring)
    await step(40)
    const eye = (await calls()).find(c => String(c.id).startsWith('smoke'))
    check('a dart through the eye of it pays for the accuracy',
      threaded && !!eye, eye && `${eye.id} ${eye.base} × ${eye.mult} = ${eye.embers}`)
    check('the ring is spent once it has been threaded', !(await state()).ring)
  }

  // ── THE LEDGER ─────────────────────────────────────────────────────────
  const ledger = await page.evaluate(() => ({
    balance: window.RevEmbers.balance(),
    entries: window.RevEmbers.entries().filter(e => String(e.k).startsWith('call:')),
  }))
  const events = await calls()
  const owed = events.reduce((n, c) => n + c.embers, 0)
  check('every call the board made is a claim in the ledger',
    ledger.entries.length === events.length,
    `${ledger.entries.length} entries / ${events.length} calls`)
  check('the ledger paid exactly what the board called',
    ledger.entries.reduce((n, e) => n + e.d, 0) === owed, `${owed} embers`)
  check('no claim key repeats — every occasion is its own occasion',
    new Set(ledger.entries.map(e => e.k)).size === ledger.entries.length)

  const finalState = await state()
  console.log('\nchalkboard: ' + JSON.stringify(finalState, null, 1))
  console.log('the house paid: ' + events.map(c => `${c.id} +${c.embers}`).join(', '))
  console.log('purse: ' + ledger.balance + ' embers')

  check('the room threw no errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  const shot = arg('shot', null)
  if (shot) {
    await page.evaluate(() => {
      const b = document.querySelector('[data-walkin], .stagewrap');
      if (window.__loungeWalkIn) window.__loungeWalkIn()
      return !!b
    })
    await step(60)
    await page.screenshot({ path: String(shot) })
    console.log('shot → ' + shot)
  }

  if (!arg('keep', false)) await browser.close()
  console.log(`\n${pass.length} ok, ${fail.length} failed`)
  process.exit(fail.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
