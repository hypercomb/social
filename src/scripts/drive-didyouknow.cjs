// scripts/drive-didyouknow.cjs
//
// DID YOU KNOW (documentation/did-you-know.md). Three participants in one room
// play the meeting exercise through its words and the notes desk:
//
//   - `start did you know` makes the game's tile and opens the desk (the host)
//   - two participants each `did-you-know <idea>`; the ideas reach everyone
//   - the desk shows the words and NOT who brought them (no name, no colour),
//     for the host and for a participant who did not write the idea
//   - the concealment is scoped to the game's tile
//   - `collect` takes the room's ideas onto the participant's own tile
//   - `reveal` writes one note naming who brought each idea; the desks then
//     show names again; `collect` after the reveal leaves the reveal behind
//   - the game is a TOGGLE a layer declares: `start` at the root switches it on
//     everywhere; a participant joins a room without switching anything on;
//     ideas belong to the layer they were shared on; `off` at a layer that
//     inherits the mark changes nothing; off at the root closes the layers
//     beneath; `on` on a branch opens that branch and what is beneath it, not
//     its sibling; `everywhere` opens the sibling; the word alone flips
//
//   node scripts/drive-didyouknow.cjs --url http://localhost:4253/ --relay ws://localhost:7777

const H = require('./drive-swarm-connectivity.cjs')

const GAME = 'did you know'
const IDEA_BEN = 'octopuses have three hearts'
const IDEA_CY = 'honey never spoils'
const zone = { room: `dyk-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: {
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

const notesAt = (c, segs) => H.evalSafe(() => c.page.evaluate(async (segs) =>
  (await window.ioc.get('@diamondcoreprocessor.com/NotesService').getNotesAtSegments(segs)).map(n => n.text), segs))

/** The desk as a reader sees it: every row, whether it is a peer's, the name
 *  and the colour it wears, and whether the desk is hiding authors. */
const deskState = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const el = document.querySelector('hc-notes-strip')
  const cmp = window.ng?.getComponent?.(el)
  const rows = [...(el?.querySelectorAll('.cv2-list .cv2-note[data-note-id]') ?? [])].map(r => ({
    text: r.querySelector('.cv2-note-text')?.textContent?.trim() ?? '',
    peer: r.classList.contains('is-peer'),
    by: r.querySelector('.cv2-peer-by')?.textContent?.trim() ?? '',
    color: r.style.getPropertyValue('--peer') ?? '',
  }))
  return { open: !!el && getComputedStyle(el).display !== 'none', cell: cmp?.cell?.() ?? null, hidden: cmp?.authorsHidden?.() ?? null, rows }
}))

const openDesk = (c, cell) => H.evalSafe(() => c.page.evaluate((cell) => {
  window.__hypercombEffectBus.emit('notes:panel', { visible: true })
  const cmp = window.ng?.getComponent?.(document.querySelector('hc-notes-strip'))
  cmp?.setTab?.('notes')
  cmp?.activateCell?.(cell)
  return !!cmp
}, cell))

const service = (c, call, ...args) => H.evalSafe(() => c.page.evaluate(async ({ call, args }) => {
  const s = window.ioc.get('@diamondcoreprocessor.com/DidYouKnow')
  return s ? await s[call](...args) : null
}, { call, args }))

const goTo = (c, segs) => H.evalSafe(() => c.page.evaluate((segs) => { window.ioc.get('@hypercomb.social/Navigation').goRaw(segs); return true }, segs))

const slug = (s) => String(s).trim().toLowerCase().replace(/[._\s]+/g, '-').replace(/[^\p{L}\p{N}\-]/gu, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
const has = (list, name) => (list ?? []).some(n => slug(n) === slug(name))
const row = (view, text) => (view?.rows ?? []).find(r => r.text === text)

;(async () => {
  const a = await boot('Ana'), b = await boot('Ben'), c = await boot('Cy')
  const all = [a, b, c]

  for (const x of all) {
    await word(x, '/join')
    const j = await H.waitFor(() => joined(x), m => m.meshPublic === 'true' && !!m.sig, 30000, 500)
    H.check('joined the room', j.ok, JSON.stringify(j.value))
  }

  // ── START (the host) ───────────────────────────────────────────────────
  await word(a, `/start ${GAME}`)
  const started = await H.waitFor(async () => ({ root: await childrenAt(a, []), desk: await deskState(a) }),
    v => has(v.root, GAME) && v.desk.open && slug(v.desk.cell ?? '') === slug(GAME), 45000, 750)
  H.check('`start did you know` makes the game tile and opens the desk on it', started.ok, JSON.stringify({ root: started.value?.root, open: started.value?.desk?.open, cell: started.value?.desk?.cell }))
  const tile = (await childrenAt(a, [])).find(n => slug(n) === slug(GAME)) ?? GAME

  // ── THE ROOM SEES THE GAME; TWO PARTICIPANTS SHARE ─────────────────────
  for (const x of [b, c]) {
    const offered = await H.waitFor(() => peerTiles(x), v => has(v, GAME), 60000, 750)
    H.check('the game tile reaches a participant', offered.ok, `${offered.waitedMs}ms — ${JSON.stringify(offered.value)}`)
  }
  await word(b, `/did-you-know ${IDEA_BEN}`)
  const benShared = await H.waitFor(async () => ({ root: await childrenAt(b, []), notes: await notesAt(b, [tile]) }),
    v => has(v.root, GAME) && v.notes.includes(IDEA_BEN), 45000, 750)
  H.check('`did-you-know <idea>` makes the participant\'s tile and writes the idea on it', benShared.ok, JSON.stringify(benShared.value))
  await word(c, `/did-you-know ${IDEA_CY}`)
  const cyShared = await H.waitFor(() => notesAt(c, [tile]), v => v.includes(IDEA_CY), 45000, 750)
  H.check('a second participant shares an idea', cyShared.ok, JSON.stringify(cyShared.value))

  // ── ANONYMOUS: words, not who ──────────────────────────────────────────
  await openDesk(a, tile); await openDesk(c, tile)
  const hostSees = await H.waitFor(() => deskState(a), v => !!row(v, IDEA_BEN) && !!row(v, IDEA_CY), 90000, 1000)
  const hb = row(hostSees.value, IDEA_BEN), hc = row(hostSees.value, IDEA_CY)
  H.check("the host's desk shows both ideas as plain words — no name, no colour",
    hostSees.ok && hb?.peer && hc?.peer && hb.by === '' && hc.by === '' && hb.color === '' && hc.color === '' && hostSees.value.hidden === true,
    JSON.stringify(hostSees.value))
  const cySees = await H.waitFor(() => deskState(c), v => !!row(v, IDEA_BEN), 90000, 1000)
  const cb = row(cySees.value, IDEA_BEN)
  H.check("a participant reads another's idea with no name and no colour", cySees.ok && cb?.peer && cb.by === '' && cb.color === '' && cySees.value.hidden === true, JSON.stringify(cySees.value))
  const scoped = await H.evalSafe(() => a.page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/SwarmNotes').authorsHidden('lecture', ['anything'])))
  H.check('the concealment is scoped to the game tile', scoped === false, String(scoped))

  // ── COLLECT (before the reveal) ────────────────────────────────────────
  await word(c, '/collect')
  const cyHolds = await H.waitFor(() => notesAt(c, [tile]), v => v.includes(IDEA_BEN) && v.includes(IDEA_CY), 60000, 1000)
  H.check('`collect` takes the room\'s idea onto the participant\'s own tile', cyHolds.ok, JSON.stringify(cyHolds.value))
  const again = await service(c, 'collect')
  H.check('collecting again finds nothing new', again && again.taken === 0 && again.waiting === 0, JSON.stringify(again))

  // ── REVEAL ─────────────────────────────────────────────────────────────
  await word(a, '/reveal')
  const revealed = await H.waitFor(() => notesAt(a, [tile]), v => v.some(t => t.startsWith('Revealed ·')), 45000, 750)
  const note = (revealed.value ?? []).find(t => t.startsWith('Revealed ·')) ?? ''
  H.check('`reveal` writes one note naming who brought each idea',
    revealed.ok && /Revealed · 2 ideas/.test(note) && note.includes(`${IDEA_BEN} — Ben`) && note.includes(`${IDEA_CY} — Cy`), JSON.stringify(note))
  const twice = await service(a, 'reveal')
  H.check('a second reveal says it is already revealed and writes nothing more', twice === 'already' && (await notesAt(a, [tile])).filter(t => t.startsWith('Revealed ·')).length === 1, JSON.stringify(twice))

  // ── NAMES RETURN ───────────────────────────────────────────────────────
  await openDesk(b, tile)
  const benSees = await H.waitFor(() => deskState(b), v => !!row(v, IDEA_CY) && v.hidden === false, 90000, 1000)
  const bc = row(benSees.value, IDEA_CY)
  H.check("after the reveal a participant's desk shows who brought an idea", benSees.ok && bc?.peer && bc.by === 'Cy' && bc.color !== '', JSON.stringify(benSees.value))

  // ── COLLECT (after the reveal) leaves the reveal behind ────────────────
  await word(b, '/collect')
  const benHolds = await H.waitFor(() => notesAt(b, [tile]), v => v.includes(IDEA_BEN) && v.includes(IDEA_CY), 60000, 1000)
  H.check('`collect` after the reveal takes the ideas and leaves the reveal where it is',
    benHolds.ok && !(benHolds.value ?? []).some(t => t.startsWith('Revealed ·')), JSON.stringify(benHolds.value))

  // ── THE TOGGLE: where the game is on ───────────────────────────────────
  // Ben joined the room and played without switching anything on: the room
  // being there was enough, and his hive declares nothing.
  const benDeclares = await service(b, 'toggle', 'off')
  H.check('a participant plays a room without switching anything on', benDeclares?.state === 'none', JSON.stringify(benDeclares))

  // `start` at the root switched the game on everywhere. A layer with no room
  // and no mark of its own plays; its ideas belong to it, not to the root.
  await H.addTile(a.page, 'lecture'); await H.sleep(1500)
  await goTo(a, ['lecture']); await H.sleep(2000)
  const everywhere = await service(a, 'availability', ['lecture'])
  H.check('`start` at the root switched the game on everywhere', everywhere === 'ok', JSON.stringify(everywhere))
  const IDEA_LAYER = 'light bends around heavy things'
  const sharedHere = await service(a, 'share', IDEA_LAYER)
  const layerNotes = await H.waitFor(() => notesAt(a, ['lecture', tile]), v => v.includes(IDEA_LAYER), 30000, 750)
  const rootNotes = await notesAt(a, [tile])
  H.check("an idea shared on a layer is that layer's data — the root's tile does not hold it",
    sharedHere === 'shared' && layerNotes.ok && !rootNotes.includes(IDEA_LAYER), JSON.stringify({ sharedHere, layer: layerNotes.value, root: rootNotes }))

  const inherited = await service(a, 'toggle', 'off')
  H.check('`off` on a layer that only inherits the mark changes nothing and says where it is held',
    inherited?.state === 'inherited' && inherited.at.length === 0, JSON.stringify(inherited))

  // Off at the root closes every layer that held no mark of its own.
  await goTo(a, []); await H.sleep(1500)
  const closed = await service(a, 'toggle', 'off')
  await goTo(a, ['lecture']); await H.sleep(2000)
  const afterClose = await service(a, 'availability', ['lecture'])
  const refused = await service(a, 'share', 'this should not be written')
  const stillOne = await notesAt(a, ['lecture', tile])
  H.check('off at the root closes the layers beneath: the word is refused and writes nothing',
    closed?.state === 'off' && afterClose === 'off' && refused === 'off' && !stillOne.includes('this should not be written'),
    JSON.stringify({ closed, afterClose, refused, stillOne }))

  // A branch: on at /lecture opens /lecture and what is beneath it.
  await word(a, '/did-you-know on')
  const branchOn = await H.waitFor(() => service(a, 'availability', ['lecture']), v => v === 'ok', 30000, 750)
  H.check('`did-you-know on` on a layer opens that layer', branchOn.ok, JSON.stringify(branchOn.value))
  const onTwice = await service(a, 'toggle', 'on')
  H.check('saying it again finds it already there', onTwice?.state === 'on' && onTwice.changed === false, JSON.stringify(onTwice))
  await H.addTile(a.page, 'biology'); await H.sleep(1500)
  await goTo(a, ['lecture', 'biology']); await H.sleep(2000)
  const beneath = await service(a, 'availability', ['lecture', 'biology'])
  const IDEA_DEEP = 'cells keep their own time'
  const deepShared = await service(a, 'share', IDEA_DEEP)
  const deepNotes = await H.waitFor(() => notesAt(a, ['lecture', 'biology', tile]), v => v.includes(IDEA_DEEP), 30000, 750)
  H.check('the mark holds for everything beneath it — a deeper layer plays, with its own ideas',
    beneath === 'ok' && deepShared === 'shared' && deepNotes.ok, JSON.stringify({ beneath, deepShared, deep: deepNotes.value }))

  // The word alone flips the layer it is said on (no layer above holds a mark
  // yet, so turning it back on writes one here).
  await goTo(a, ['lecture']); await H.sleep(1500)
  const flippedOff = await service(a, 'toggle', 'flip')
  const flippedOn = await service(a, 'toggle', 'flip')
  H.check('the word alone flips the game on a layer', flippedOff?.state === 'off' && flippedOn?.state === 'on' && flippedOn.changed === true, JSON.stringify({ flippedOff, flippedOn }))

  // A sibling branch is not covered; `everywhere` covers it.
  await goTo(a, []); await H.sleep(1500)
  await H.addTile(a.page, 'other'); await H.sleep(1500)
  await goTo(a, ['other']); await H.sleep(2000)
  const sibling = await service(a, 'availability', ['other'])
  H.check('a sibling branch is not covered by the mark on /lecture', sibling === 'off', JSON.stringify(sibling))
  const wide = await service(a, 'toggle', 'everywhere')
  const siblingNow = await service(a, 'availability', ['other'])
  H.check('`everywhere` switches the game on for the whole hive', wide?.state === 'on' && wide.at.length === 0 && siblingNow === 'ok', JSON.stringify({ wide, siblingNow }))

  // With the whole hive on, saying `on` on a layer below only says it is covered.
  await goTo(a, ['lecture', 'biology']); await H.sleep(1500)
  const covered = await service(a, 'toggle', 'on')
  H.check('`on` below a layer that already holds the mark says the nearest one covers it and writes nothing', covered?.state === 'covered' && covered.at.join('/') === 'lecture', JSON.stringify(covered))

  console.log('\n========== did you know ==========')
  for (const x of H.results) console.log(`  ${x.ok ? '✓' : '✗'} ${x.name}${x.detail ? '  — ' + x.detail : ''}`)
  console.log(`========== ${H.results.filter(x => x.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) for (const x of all) { try { await x.browser.close() } catch { /* gone */ } }
  process.exit(H.results.every(x => x.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
