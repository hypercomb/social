// scripts/drive-questions-game.cjs
//
// HYPERCOMB Q AND A (documentation/hypercomb-q-and-a.md). Two participants in
// one room play the game through its words and the swarm's own acts:
//
//   - `start hypercomb q and a` mints the game tile, walks the host in, and
//     makes the host the organizer; the host lays two categories out
//   - a guest takes the game tile, enters, takes a category, enters it, and
//     asks with `question <text>` — the tiles reach the organizer, who takes them
//   - clicking a question OPENS its answers (the desk) instead of entering it
//   - an answer is a note; it reaches the organizer's desk; the organizer takes it
//   - `tally` writes the ranking on the question and the scoreboard on the page
//   - a question asked at the game's root settles into its category layer
//     (Jev's sort is stood in for on the organizer's page — no model runs)
//
//   node scripts/drive-questions-game.cjs --url http://localhost:4253/ --relay ws://localhost:7777

const H = require('./drive-swarm-connectivity.cjs')

const GAME = 'hypercomb q and a'
const zone = { room: `qanda-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: {
  'hc:swarm:sticky': '1',
} }

async function boot(label) {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const c = await H.newClient(browser, label, zone); c.browser = browser
  await c.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(c.page); await H.installIfNeeded(c.page, label)
  if (!(await H.waitForReady(c.page))) throw new Error(`${label}: not ready`)
  await H.settle(c.page)
  await H.evalSafe(() => c.page.evaluate((label) => { window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').setMyLabel(label) }, label))
  return c
}

const word = (c, text) => H.evalSafe(() => c.page.evaluate((text) => {
  window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').emitEffect('command-line:remote-submit', { text })
  return true
}, text))

const joined = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const d = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')?.debug?.() ?? {}
  return { meshPublic: localStorage.getItem('hc:mesh-public'), sig: d.currentSig ?? '' }
}))

const segments = (c) => H.evalSafe(() => c.page.evaluate(() => window.ioc.get('@hypercomb.social/Lineage').explorerSegments()))

const goTo = (c, segs) => H.evalSafe(() => c.page.evaluate((segs) => { window.ioc.get('@hypercomb.social/Navigation').goRaw(segs); return true }, segs))

/** This hive's own tiles at a path. */
const childrenAt = (c, segs) => H.evalSafe(() => c.page.evaluate(async (segs) => {
  const h = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
  const layer = await h.currentLayerAt(await h.sign({ explorerSegments: () => segs }))
  const names = []
  for (const s of (layer?.children ?? [])) { try { const l = await h.getLayerBySig(s); if (l?.name) names.push(l.name) } catch { /* cold */ } }
  return names
}, segs))

const peerTiles = (c) => H.evalSafe(() => c.page.evaluate(() =>
  (window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').peerTilesAtCurrentSig?.() ?? []).map(t => t.name)))

const adopt = (c, label) => H.evalSafe(() => c.page.evaluate((label) => {
  const a = window.ioc.get('@diamondcoreprocessor.com/SwarmAdoptDrone')
  if (!a?.wandEligible?.(label)) return false
  window.__hypercombEffectBus.emit('tile:action', { action: 'adopt', label, q: 0, r: 0, index: 0 })
  return true
}, label))

const settleNow = (c) => H.evalSafe(() => c.page.evaluate(async () => {
  const q = window.ioc.get('@diamondcoreprocessor.com/Questions')
  return q ? await q.settle() : null
}))

/** Stand in for Jev on the organizer's page: a sort that files bags and
 *  pools under storage and people under people. No model runs. */
const fakeJev = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const sort = async ({ notes, categories }) => ({ placed: notes.map(n =>
    /dana/i.test(n) ? categories.findIndex(k => /people/i.test(k))
    : /bag|pool/i.test(n) ? categories.findIndex(k => /storage/i.test(k))
    : -1) })
  const jev = window.ioc.get('@hypercomb.social/JevDecision')
  if (jev) { jev.readyForHive = () => true; jev.sort = sort; return 'patched' }
  window.ioc.register('@hypercomb.social/JevDecision', { readyForHive: () => true, sort })
  return 'registered'
}))

/** Enter a tile the way every entry gesture does — through the overlay's choke point. */
const enter = (c, label) => H.evalSafe(() => c.page.evaluate((label) => {
  window.__hypercombEffectBus.emit('tile:enter-request', { label })
  return true
}, label))

const deskState = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const el = document.querySelector('hc-notes-strip')
  const cmp = window.ng?.getComponent?.(el)
  const rows = [...(el?.querySelectorAll('.cv2-list .cv2-note[data-note-id]') ?? [])].map(r => ({
    text: r.querySelector('.cv2-note-text')?.textContent?.trim() ?? '',
    peer: r.classList.contains('is-peer'),
    by: r.querySelector('.cv2-peer-by')?.textContent ?? '',
    held: r.querySelector('.cv2-peer-held')?.textContent ?? '',
  }))
  return { open: !!el && getComputedStyle(el).display !== 'none', cell: cmp?.cell?.() ?? null, rows }
}))

const openDesk = (c, cell) => H.evalSafe(() => c.page.evaluate((cell) => {
  window.__hypercombEffectBus.emit('notes:panel', { visible: true })
  const cmp = window.ng?.getComponent?.(document.querySelector('hc-notes-strip'))
  cmp?.setTab?.('notes')
  cmp?.activateCell?.(cell)
  return !!cmp
}, cell))

const write = (c, cell, text) => H.evalSafe(() => c.page.evaluate(({ cell, text }) => {
  window.__hypercombEffectBus.emit('note:commit', { cellLabel: cell, text, mark: null })
  return true
}, { cell, text }))

const take = (c, text) => H.evalSafe(() => c.page.evaluate((text) => {
  const row = [...document.querySelectorAll('hc-notes-strip .cv2-note[data-note-id]')]
    .find(r => r.querySelector('.cv2-note-text')?.textContent?.trim() === text)
  const btn = row?.querySelector('.cv2-peer-check')
  if (!btn) return false
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return true
}, text))

const notesAt = (c, segs) => H.evalSafe(() => c.page.evaluate(async (segs) =>
  (await window.ioc.get('@diamondcoreprocessor.com/NotesService').getNotesAtSegments(segs)).map(n => n.text), segs))

/** Tile names are normalized by the create commit (lower, hyphens, no
 *  punctuation) — compare the way the hive names. */
const slug = (s) => String(s).trim().toLowerCase().replace(/[._\s]+/g, '-').replace(/[^\p{L}\p{N}\-]/gu, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
const has = (list, name) => (list ?? []).some(n => slug(n) === slug(name))
const row = (view, text) => (view?.rows ?? []).find(r => r.text === text)

;(async () => {
  const a = await boot('Ana'), b = await boot('Ben')

  for (const c of [a, b]) {
    await word(c, '/join')
    const j = await H.waitFor(() => joined(c), m => m.meshPublic === 'true' && !!m.sig, 30000, 500)
    H.check('joined the room', j.ok, JSON.stringify(j.value))
  }

  // ── START ──────────────────────────────────────────────────────────────
  await fakeJev(a)
  await word(a, `/start ${GAME}`)
  const started = await H.waitFor(async () => ({ segs: await segments(a), root: await childrenAt(a, []) }),
    v => JSON.stringify(v.segs) === JSON.stringify([GAME]) && has(v.root, GAME), 30000, 500)
  H.check('`start hypercomb q and a` mints the game tile and walks the host in', started.ok, JSON.stringify(started.value))

  // The host lays two categories out beforehand.
  await H.addTile(a.page, 'storage'); await H.sleep(1500)
  await H.addTile(a.page, 'people'); await H.sleep(1500)
  const laid = await H.waitFor(() => childrenAt(a, [GAME]), v => has(v, 'storage') && has(v, 'people'), 20000, 500)
  H.check('the host lays categories out as tiles in the game', laid.ok, JSON.stringify(laid.value))

  // ── THE GUEST ARRIVES ──────────────────────────────────────────────────
  const offered = await H.waitFor(() => peerTiles(b), v => has(v, GAME), 45000, 750)
  H.check('the game tile reaches the room', offered.ok, `${offered.waitedMs}ms — ${JSON.stringify(offered.value)}`)
  await H.waitFor(() => adopt(b, GAME), ok => ok === true, 30000, 1000)
  const tookGame = await H.waitFor(() => childrenAt(b, []), v => has(v, GAME), 30000, 500)
  H.check('a participant takes the game tile', tookGame.ok, JSON.stringify(tookGame.value))
  await goTo(b, [GAME]); await H.sleep(1500)

  const cats = await H.waitFor(() => peerTiles(b), v => has(v, 'storage') && has(v, 'people'), 45000, 750)
  H.check("the host's categories reach the room", cats.ok, `${cats.waitedMs}ms — ${JSON.stringify(cats.value)}`)
  await H.waitFor(() => adopt(b, 'storage'), ok => ok === true, 30000, 1000)
  const tookCat = await H.waitFor(() => childrenAt(b, [GAME]), v => has(v, 'storage'), 30000, 500)
  H.check('the participant takes a category', tookCat.ok, JSON.stringify(tookCat.value))
  await goTo(b, [GAME, 'storage']); await H.sleep(1500)

  // ── ASK ────────────────────────────────────────────────────────────────
  const Q1 = 'what is a bag?'
  const Q2 = 'what is a pool of meaning?'
  await word(b, `/question ${Q1}`); await H.sleep(2000)
  await word(b, `/question ${Q2}`)
  const asked = await H.waitFor(() => childrenAt(b, [GAME, 'storage']), v => has(v, Q1) && has(v, Q2), 30000, 500)
  H.check('`question <text>` makes a tile named with the question', asked.ok, JSON.stringify(asked.value))

  // The organizer walks into the category; the questions are peer tiles there,
  // and the settle takes them.
  await goTo(a, [GAME, 'storage']); await H.sleep(1500)
  const seen = await H.waitFor(() => peerTiles(a), v => has(v, Q1) && has(v, Q2), 45000, 750)
  H.check("the questions reach the organizer's page", seen.ok, `${seen.waitedMs}ms — ${JSON.stringify(seen.value)}`)
  const taken = await H.waitFor(async () => { await settleNow(a); return childrenAt(a, [GAME, 'storage']) }, v => has(v, Q1) && has(v, Q2), 60000, 3000)
  H.check("the organizer's settle takes the room's questions", taken.ok, JSON.stringify(taken.value))

  // ── THE DOOR ───────────────────────────────────────────────────────────
  await enter(b, slug(Q1))
  const door = await H.waitFor(async () => ({ segs: await segments(b), desk: await deskState(b) }),
    v => JSON.stringify(v.segs) === JSON.stringify([GAME, 'storage']) && v.desk.open && v.desk.cell === slug(Q1), 15000, 500)
  H.check('clicking a question opens its answers instead of entering it', door.ok, JSON.stringify({ segs: door.value?.segs, open: door.value?.desk?.open, cell: door.value?.desk?.cell }))

  // ── ANSWER, SEE, TAKE ──────────────────────────────────────────────────
  const ANSWER = 'a bag is a lineage of markers'
  await write(b, slug(Q1), ANSWER)
  await openDesk(a, slug(Q1))
  const arrives = await H.waitFor(() => deskState(a), v => !!row(v, ANSWER), 60000, 750)
  const r = row(arrives.value, ANSWER)
  H.check("the answer reaches the organizer's desk, in the guest's name", arrives.ok && !!r?.peer && r?.by === 'Ben', JSON.stringify(r))
  await take(a, ANSWER)
  const mine = await H.waitFor(() => deskState(a), v => { const x = row(v, ANSWER); return !!x && !x.peer }, 20000, 500)
  H.check('taking an answer makes it the taker\'s too', mine.ok, JSON.stringify(row(mine.value, ANSWER)))

  // ── TALLY ──────────────────────────────────────────────────────────────
  await word(a, '/tally')
  const tallied = await H.waitFor(async () => ({ q: await notesAt(a, [GAME, 'storage', slug(Q1)]), page: await notesAt(a, [GAME]) }),
    v => v.q.some(t => t.startsWith('Tally ·') && /1 take · Ben/.test(t)) && v.page.some(t => t.startsWith('Scoreboard ·') && /Ben — 1 take/.test(t)), 30000, 750)
  H.check('`tally` ranks the answers on the question and scores the game tile', tallied.ok, JSON.stringify(tallied.value))

  // ── A QUESTION AT THE ROOT SETTLES INTO ITS CATEGORY ───────────────────
  const Q3 = 'who is dana?'
  await goTo(b, [GAME]); await H.sleep(1500)
  await word(b, `/question ${Q3}`)
  await H.waitFor(() => childrenAt(b, [GAME]), v => has(v, Q3), 30000, 500)
  await goTo(a, [GAME]); await H.sleep(1500)
  const settled = await H.waitFor(async () => { await settleNow(a); return { root: await childrenAt(a, [GAME]), people: await childrenAt(a, [GAME, 'people']) } },
    v => has(v.people, Q3) && !has(v.root, Q3), 90000, 3000)
  H.check('a question asked at the root settles into its category layer', settled.ok, JSON.stringify(settled.value))

  // ── LIVE NAMING: a category nobody laid out materializes, named by the namer
  // (the participant's AI; stood in for here — no model may read this hive).
  const namer = await H.evalSafe(() => a.page.evaluate(() => {
    const q = window.ioc.get('@diamondcoreprocessor.com/Questions')
    q.suggestNames = async (questions) => questions.some(x => /copper|iron/i.test(x)) ? ['Materials'] : []
    const jev = window.ioc.get('@hypercomb.social/JevDecision')
    jev.readyForHive = () => true
    jev.sort = async ({ notes, categories }) => ({ placed: notes.map(n =>
      /copper|iron/i.test(n) ? categories.findIndex(k => /materials/i.test(k))
      : /dana/i.test(n) ? categories.findIndex(k => /people/i.test(k))
      : /bag|pool/i.test(n) ? categories.findIndex(k => /storage/i.test(k))
      : -1) })
    return typeof q.suggestNames === 'function'
  }))
  H.check('the namer is a seam a participant can stand another namer in', namer === true)
  const Q4 = 'what is copper?'
  const Q5 = 'what is iron?'
  await word(b, `/question ${Q4}`); await H.sleep(2000)
  await word(b, `/question ${Q5}`)
  await H.waitFor(() => childrenAt(b, [GAME]), v => has(v, Q4) && has(v, Q5), 30000, 500)
  const named = await H.waitFor(async () => { await settleNow(a); return { root: await childrenAt(a, [GAME]), materials: await childrenAt(a, [GAME, 'Materials']) } },
    v => has(v.root, 'Materials') && has(v.materials, Q4) && has(v.materials, Q5) && !has(v.root, Q4) && !has(v.root, Q5), 90000, 3000)
  H.check('a category nobody laid out materializes at two questions, named by the namer', named.ok, JSON.stringify(named.value))

  // ── RETRACT: someone files one of its two questions elsewhere by hand; the
  // thin category comes back up and its tile goes.
  await H.evalSafe(() => a.page.evaluate(async ({ game, q }) => {
    const move = window.ioc.get('@diamondcoreprocessor.com/MoveDrone')
    return (await move.commitMoveInto([q], [game, 'Materials'], [game, 'people'])).length
  }, { game: GAME, q: slug(Q5) }))
  const retracted = await H.waitFor(async () => { await settleNow(a); return { root: await childrenAt(a, [GAME]), people: await childrenAt(a, [GAME, 'people']) } },
    v => has(v.root, Q4) && !has(v.root, 'Materials') && has(v.people, Q5), 90000, 3000)
  H.check('a category left with one question retracts — it comes up and the tile goes', retracted.ok, JSON.stringify(retracted.value))
  if (!retracted.ok) console.log('DEBUG lastSettle', JSON.stringify(await H.evalSafe(() => a.page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/Questions').lastSettle.map(p => ({ page: p.page, tiles: p.tiles.map(t => [t.name, t.question ? 'Q' : t.inside.join('|'), t.children]), plan: p.plan, moved: p.moved }))))))

  // ── THE TREE TALLY: standing at the game's root, every question of the tree
  // is tallied from what this hive holds and what its ledger saw.
  const ANSWER2 = 'a pool is a folder of meaning'
  await goTo(b, [GAME, 'storage']); await H.sleep(1500)
  await write(b, slug(Q2), ANSWER2)
  await goTo(a, [GAME, 'storage']); await H.sleep(1500)
  const seenAt = (c, cell) => H.evalSafe(() => c.page.evaluate((cell) =>
    [...window.ioc.get('@diamondcoreprocessor.com/Questions').seen(cell).values()].map(v => ({ text: v.text, holders: v.holders.size })), cell))
  const ledger = await H.waitFor(() => seenAt(a, slug(Q2)), v => (v ?? []).some(x => x.text === ANSWER2), 60000, 1500)
  H.check("the organizer's ledger sees an answer while standing where the question is", ledger.ok, JSON.stringify(ledger.value))
  await goTo(a, [GAME]); await H.sleep(1500)
  await word(a, '/tally')
  const tree = await H.waitFor(async () => ({
    pool: await notesAt(a, [GAME, 'storage', slug(Q2)]),
    board: await notesAt(a, [GAME]),
  }), v => v.pool.some(t => t.startsWith('Tally ·') && t.includes(ANSWER2) && /0 takes · Ben/.test(t))
      && v.board.some(t => t.startsWith('Scoreboard ·') && /Ben — 1 take, 1 best, 2 answers/.test(t)), 45000, 1000)
  H.check("tally at the game's root ranks every question in the tree and scores the game tile", tree.ok, JSON.stringify(tree.value))

  console.log('\n========== hypercomb q and a ==========')
  for (const x of H.results) console.log(`  ${x.ok ? '✓' : '✗'} ${x.name}${x.detail ? '  — ' + x.detail : ''}`)
  console.log(`========== ${H.results.filter(x => x.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } }
  process.exit(H.results.every(x => x.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
