#!/usr/bin/env node
// verify-boot-word — A WORD SAID WHILE ITS BEE IS STILL LOADING WAITS FOR IT.
//
// 2026-09-23, scripts/verify-hive-publish.cjs: `module commit …` was said right
// after a reload, while the module bee was still loading. The command line did
// not know the word yet and made a tile named after the whole line. Since step 6
// of the atomic-modules plan every word is a bee, so any line said in that
// window could do the same (hypercomb-shared/ui/command-line/word-arrival.ts).
//
// On a fresh profile, after a reload, this says a module line the moment the
// command line listens — before it knows the word — and checks:
//   1. the line really was said before the command line knew `module`
//   2. it was decided the moment `module` arrived — it waited for its word,
//      not for the whole hive
//   3. no tile was made from it; it ran `module`, and the module word answered
// Then it says a phrase no bee claims, which must still become a tile: making a
// tile from plain text is intended.
//
//   node scripts/verify-boot-word.cjs [web=http://localhost:4260]
//   (PW_CHROMIUM=<path> launches that browser instead of Playwright's own)
const { chromium } = require('playwright')
const H = require('./hive-harness.cjs')

const WEB = process.argv[2] || 'http://localhost:4260'
const PROOF = `proof-${Date.now().toString(36)}`
const KNOWN = `module list ${PROOF}-mine @content.localhost:4291`
const UNKNOWN = `zq-${PROOF}`
const ARM = 'hc:verify:boot-word'

/** Runs at document start on every load; says the armed line once, the moment
 *  the command line listens, and records what happened and when. */
const probe = () => {
  const line = localStorage.getItem('hc:verify:boot-word')
  if (!line) return
  localStorage.removeItem('hc:verify:boot-word')
  const BEE = '@diamondcoreprocessor.com/ModuleQueenBee'
  const CENSUS = '@diamondcoreprocessor.com/SlashBehaviourDrone'
  const READER = '@diamondcoreprocessor.com/UtteranceReader'
  const t0 = performance.now()
  const at = () => Math.round(performance.now() - t0)
  const rec = window.__bootWord = {
    line, said: null, knownAtSay: null, beeAt: null, censusAt: null, readerAt: null, knownAt: null,
    accepted: false, outcome: null, outcomeAt: null, settledAt: null, added: [], toasts: [], sayings: [],
  }
  // What the remote door reads `module` through: the reader, over the census.
  const knows = ioc => !!ioc.get(READER) && ioc.get(CENSUS)?.has?.('module') === true
  const note = ioc => {
    if (rec.beeAt === null && ioc.get(BEE)) rec.beeAt = at()
    if (rec.censusAt === null && ioc.get(CENSUS)) rec.censusAt = at()
    if (rec.readerAt === null && ioc.get(READER)) rec.readerAt = at()
    if (rec.knownAt === null && knows(ioc)) rec.knownAt = at()
  }
  let wired = false
  const tick = setInterval(() => {
    const bus = globalThis.__hypercombEffectBus
    const ioc = window.ioc
    if (!bus || !ioc) return
    if (!wired) {
      wired = true
      note(ioc)
      ioc.onRegister?.(() => queueMicrotask(() => note(ioc)))
      let live = false // ignore the last-value replay on subscribe
      // The line announces a tile it makes; the committer echoes it once committed.
      bus.on('cell:added', p => { if (live) rec.added.push({ cell: String(p?.cell ?? ''), at: at(), by: p?.fromCascade ? 'commit' : 'line' }) })
      bus.on('toast:show', p => { if (live) rec.toasts.push({ message: String(p?.message ?? ''), at: at() }) })
      bus.on('loader:bees-done', () => { if (live && rec.settledAt === null) rec.settledAt = at() })
      live = true
      // Every time this line is said — first here, then again by a command
      // line that held it — so the driver sees WHEN it was decided.
      const emitTransient = bus.emitTransient.bind(bus)
      bus.emitTransient = (effect, payload) => {
        if (effect === 'command-line:remote-submit' && payload?.text === line) rec.sayings.push(at())
        return emitTransient(effect, payload)
      }
    }
    if (!bus.listens('command-line:remote-submit')) return
    clearInterval(tick)
    note(ioc)
    rec.said = at()
    rec.knownAtSay = knows(ioc)
    bus.emitTransient('command-line:remote-submit', {
      text: line,
      accept: () => { rec.accepted = true },
      complete: outcome => { rec.outcome = outcome; rec.outcomeAt = at() },
    })
  }, 2)
}

/** The names of the tiles on the page the participant stands on (a cold head
 *  answers null — asked again until it is warm). */
const tileNames = page => H.waitFor(() => page.evaluate(async () => {
  const history = window.ioc?.get('@HistoryService')
  const lineage = window.ioc?.get('@hypercomb.social/Lineage')
  if (!history || !lineage) return null
  const here = await history.currentLayerAt(await history.sign(lineage))
  if (!here) return null
  const names = []
  for (const sig of here.children ?? []) names.push((await history.getLayerBySig(sig))?.name ?? '?')
  return names
}), 20_000, 500)

;(async () => {
  const { check, finish } = H.checker()
  const browser = await chromium.launch({
    headless: true,
    // Software WebGL where there is no GPU, so the hive renders as it would.
    args: ['--enable-unsafe-swiftshader'],
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  })
  try {
    const hive = await H.openHive(browser, 'boot-word', WEB)
    const page = hive.page
    await page.context().addInitScript(probe)

    /** Reload with `line` armed; wait for its answer, then for the hive to
     *  settle and a little longer — a tile made from the line is on the page
     *  by then. */
    const sayDuringBoot = async line => {
      await page.evaluate(([arm, l]) => localStorage.setItem(arm, l), [ARM, line])
      await page.reload({ waitUntil: 'domcontentloaded' })
      await H.waitFor(() => page.evaluate(() => window.__bootWord?.outcome ?? null), 60_000, 250)
      await H.waitFor(() => page.evaluate(() => window.__bootWord?.settledAt ?? null), 60_000, 250)
      await H.sleep(2500)
      const rec = await page.evaluate(() => window.__bootWord)
      const names = await tileNames(page) ?? []
      console.log(`   "${line}"`)
      console.log(`     said ${rec.said}ms (command line ${rec.knownAtSay ? 'knew' : 'did not know'} \`module\`); bee ${rec.beeAt}ms, census ${rec.censusAt}ms, reader ${rec.readerAt}ms, known ${rec.knownAt}ms; said again ${JSON.stringify(rec.sayings.slice(1))}ms; answered ${rec.outcomeAt}ms; settled ${rec.settledAt}ms`)
      console.log(`     outcome ${JSON.stringify(rec.outcome)}`)
      console.log(`     tiles made ${JSON.stringify(rec.added.map(a => `${a.cell} (${a.by}) @${a.at}ms`))}; on the page ${JSON.stringify(names)}`)
      return { rec, names }
    }

    // ── A KNOWN WORD, SAID BEFORE THE COMMAND LINE KNEW IT ─────────────────
    const known = await sayDuringBoot(KNOWN)
    const k = known.rec
    check('the module line was said before the command line knew `module`', k.accepted && k.knownAtSay === false, `said ${k.said}ms, known ${k.knownAt}ms`)
    const junk = [...known.names, ...k.added.map(a => a.cell)].filter(name => name.includes(PROOF))
    check('no tile was made from the line', junk.length === 0, junk.join(' | '))
    const again = k.sayings[1] ?? null
    check('it waited for its word, not for the whole hive: said again as `module` arrived',
      k.sayings.length === 2 && k.knownAt !== null && again >= k.knownAt && again - k.knownAt <= 250 && (k.settledAt === null || again < k.settledAt),
      `known ${k.knownAt}ms, said again ${again}ms, settled ${k.settledAt}ms`)
    const ran = k.outcome?.kind === 'ran' ? k.outcome.actions : []
    check('the line ran `module` once the word arrived',
      ran.length === 1 && ran[0].command === 'module' && ran[0].ok && k.knownAt !== null && k.outcomeAt >= k.knownAt,
      JSON.stringify(k.outcome))
    const answered = k.toasts.filter(t => /draft/i.test(t.message))
    check('the module word answered', answered.length > 0, JSON.stringify(k.toasts.map(t => t.message)))

    // ── A PHRASE NO BEE CLAIMS STILL MAKES A TILE ─────────────────────────
    const unknown = await sayDuringBoot(UNKNOWN)
    const u = unknown.rec
    check('the plain phrase was said while the hive was still loading', u.accepted && u.said !== null && u.settledAt !== null && u.said < u.settledAt, `said ${u.said}ms, settled ${u.settledAt}ms`)
    check('a phrase no bee claims still became a tile', unknown.names.includes(UNKNOWN), JSON.stringify(unknown.names))
  } finally {
    await browser.close()
  }
  process.exit(finish() ? 0 : 1)
})().catch(error => {
  console.error(error)
  process.exit(1)
})
