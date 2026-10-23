// scripts/drive-questions-follow.cjs
//
// HYPERCOMB Q AND A, FOLLOW THE LEADER (documentation/hypercomb-q-and-a.md).
// jwize, 2026-10-22: "participants are pinned to the host and the host can
// move them through the hive while they participate in the game — it is like
// follow the leader while teaching."
//
//   - the host says `start hypercomb q and a`: the game's child appears on the
//     page, drawn as the door in the chrome, never as a hexagon
//   - a participant sees the door offer the game, says the same sentence, and
//     JOINS: they follow the host
//   - the host walks into a layer; the participant is moved with them
//   - the participant asks on that layer: the question goes into THAT layer's
//     Q and A; the host's door counts it
//   - the host says `questions`: the room walks into the layer's Q and A
//     together; the host takes the question; the participant answers it
//   - `tally` scores it; `questions back` brings the room back to the layer;
//     `questions leave` stops following
//
//   node scripts/drive-questions-follow.cjs --url http://localhost:4253/ --relay ws://localhost:7777

const H = require('./drive-swarm-connectivity.cjs')

const GAME = 'hypercomb q and a'
const LAYER = 'cells'
const Q = 'what is a cell?'
const ANSWER = 'the smallest unit of life'
const zone = { room: `qanda-follow-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: {
  'hc:swarm:sticky': '1',
} }

async function boot(label) {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const c = await H.newClient(browser, label, zone); c.browser = browser; c.label = label
  await c.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(c.page); await H.installIfNeeded(c.page, label)
  if (!(await H.waitForReady(c.page))) throw new Error(`${label}: not ready`)
  await H.settle(c.page)
  await H.evalSafe(() => c.page.evaluate((label) => { window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').setMyLabel(label) }, label))
  return c
}

const slug = (s) => String(s).trim().toLowerCase().replace(/[._\s]+/g, '-').replace(/[^\p{L}\p{N}\-]/gu, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
const has = (list, name) => (list ?? []).some(n => slug(n) === slug(name))
/** Paths compare the way locations do: each segment folded the hive's way. */
const same = (a, b) => JSON.stringify((a ?? []).map(slug)) === JSON.stringify((b ?? []).map(slug))

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
const childrenAt = (c, segs) => H.evalSafe(() => c.page.evaluate(async (segs) => {
  const h = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
  const layer = await h.currentLayerAt(await h.sign({ explorerSegments: () => segs }))
  const names = []
  for (const s of (layer?.children ?? [])) { try { const l = await h.getLayerBySig(s); if (l?.name) names.push(l.name) } catch { /* cold */ } }
  return names
}, segs))
const peerTiles = (c) => H.evalSafe(() => c.page.evaluate(() =>
  (window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').peerTilesAtCurrentSig?.() ?? []).map(t => t.name)))
/** What the hexagon grid drew last — the labels the render pass replayed. */
const drawn = (c) => H.evalSafe(() => c.page.evaluate(() => new Promise((resolve) => {
  let off = () => {}
  off = window.__hypercombEffectBus.on('render:cell-count', (p) => { resolve(p?.labels ?? []); setTimeout(() => off?.(), 0) })
  setTimeout(() => resolve(null), 1500)
})))
/** The door, read off its element and the service behind it. */
const door = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const el = document.querySelector('hc-questions-door')
  const state = window.ioc.get('@diamondcoreprocessor.com/Questions')?.door?.() ?? null
  return {
    open: !!el && el.hasAttribute('data-open') && getComputedStyle(el).display !== 'none',
    role: el?.getAttribute('data-role') ?? '',
    text: el?.querySelector('.qa-text')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    buttons: [...(el?.querySelectorAll('button[data-act]') ?? [])].map(b => b.dataset.act),
    state,
  }
}))
const following = (c) => H.evalSafe(() => c.page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').following()))
const pubkey = (c) => H.evalSafe(() => c.page.evaluate(async () => await window.ioc.get('@diamondcoreprocessor.com/NostrSigner').getPublicKeyHex()))
const settleNow = (c) => H.evalSafe(() => c.page.evaluate(async () => await window.ioc.get('@diamondcoreprocessor.com/Questions').settle()))
const enter = (c, label) => H.evalSafe(() => c.page.evaluate((label) => { window.__hypercombEffectBus.emit('tile:enter-request', { label }); return true }, label))
const deskState = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const el = document.querySelector('hc-notes-strip')
  const cmp = window.ng?.getComponent?.(el)
  const rows = [...(el?.querySelectorAll('.cv2-list .cv2-note[data-note-id]') ?? [])].map(r => ({
    text: r.querySelector('.cv2-note-text')?.textContent?.trim() ?? '',
    peer: r.classList.contains('is-peer'),
    by: r.querySelector('.cv2-peer-by')?.textContent ?? '',
  }))
  return { open: !!el && getComputedStyle(el).display !== 'none', cell: cmp?.cell?.() ?? null, rows }
}))
const openDesk = (c, cell) => H.evalSafe(() => c.page.evaluate((cell) => {
  window.__hypercombEffectBus.emit('notes:panel', { visible: true })
  const cmp = window.ng?.getComponent?.(document.querySelector('hc-notes-strip'))
  cmp?.setTab?.('notes'); cmp?.activateCell?.(cell)
  return !!cmp
}, cell))
const write = (c, cell, text) => H.evalSafe(() => c.page.evaluate(({ cell, text }) => {
  window.__hypercombEffectBus.emit('note:commit', { cellLabel: cell, text, mark: null }); return true
}, { cell, text }))
const take = (c, text) => H.evalSafe(() => c.page.evaluate((text) => {
  const row = [...document.querySelectorAll('hc-notes-strip .cv2-note[data-note-id]')].find(r => r.querySelector('.cv2-note-text')?.textContent?.trim() === text)
  const btn = row?.querySelector('.cv2-peer-check')
  if (!btn) return false
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true
}, text))
const notesAt = (c, segs) => H.evalSafe(() => c.page.evaluate(async (segs) =>
  (await window.ioc.get('@diamondcoreprocessor.com/NotesService').getNotesAtSegments(segs)).map(n => n.text), segs))
const row = (view, text) => (view?.rows ?? []).find(r => r.text === text)

;(async () => {
  const a = await boot('Ana'), b = await boot('Ben')
  for (const c of [a, b]) {
    await word(c, '/join')
    const j = await H.waitFor(() => joined(c), m => m.meshPublic === 'true' && !!m.sig, 30000, 500)
    H.check(`${c.label} joined the room`, j.ok, JSON.stringify(j.value))
  }
  const anaKey = await pubkey(a)

  // ── THE HOST STARTS ────────────────────────────────────────────────────
  await word(a, `/start ${GAME}`)
  const started = await H.waitFor(async () => ({ root: await childrenAt(a, []), segs: await segments(a), door: await door(a) }),
    v => has(v.root, GAME) && same(v.segs, []) && v.door.open && v.door.role === 'host', 30000, 500)
  H.check('`start hypercomb q and a` leads the game where the host stands; the door says so', started.ok, JSON.stringify({ root: started.value?.root, segs: started.value?.segs, door: started.value?.door?.text }))
  const notHex = await H.waitFor(() => drawn(a), v => Array.isArray(v) && !has(v, GAME), 15000, 750)
  H.check("the game's child is drawn as the door, never as a hexagon", notHex.ok, JSON.stringify(notHex.value))

  // ── A PARTICIPANT SEES THE OFFER AND JOINS ─────────────────────────────
  const offer = await H.waitFor(() => door(b), v => v.open && v.role === 'offered' && v.state?.host === anaKey, 45000, 750)
  H.check('the door offers the game to the room, led by the host', offer.ok, JSON.stringify({ text: offer.value?.text, buttons: offer.value?.buttons }))
  const peerNotHex = await H.waitFor(() => drawn(b), v => Array.isArray(v) && !has(v, GAME), 15000, 750)
  H.check("the host's game child is not a hexagon for the room either", peerNotHex.ok, JSON.stringify(peerNotHex.value))
  await word(b, `/start ${GAME}`)
  const joinedGame = await H.waitFor(async () => ({ following: await following(b), door: await door(b) }), v => v.following === anaKey && v.door.role === 'player', 20000, 500)
  H.check('the same sentence from a participant joins: they follow the host', joinedGame.ok, JSON.stringify({ following: joinedGame.value?.following?.slice(0, 8), door: joinedGame.value?.door?.text }))

  // ── THE HOST WALKS; THE ROOM IS MOVED WITH THEM ────────────────────────
  await H.addTile(a.page, LAYER); await H.sleep(1500)
  await H.waitFor(() => childrenAt(a, []), v => has(v, LAYER), 20000, 500)
  await goTo(a, [LAYER])
  const moved = await H.waitFor(() => segments(b), v => same(v, [LAYER]), 45000, 750)
  H.check('the host walks into a layer and the participant is moved with them', moved.ok, JSON.stringify(moved.value))

  // ── A QUESTION ABOUT THIS LAYER ────────────────────────────────────────
  await H.sleep(1500)
  await word(b, `/question ${Q}`)
  const askedB = await H.waitFor(() => childrenAt(b, [LAYER, GAME]), v => has(v, Q), 30000, 750)
  H.check("asked on the layer, the question goes into that layer's Q and A", askedB.ok, JSON.stringify(askedB.value))
  const counted = await H.waitFor(() => door(a), v => (v.state?.count ?? 0) >= 1, 60000, 1500)
  H.check("the host's door counts the room's question on this layer", counted.ok, JSON.stringify({ text: counted.value?.text, count: counted.value?.state?.count }))
  if (!counted.ok) console.log('DEBUG count', JSON.stringify(await H.evalSafe(() => a.page.evaluate(async (game) => {
    const sw = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
    const broker = window.ioc.get('@diamondcoreprocessor.com/ContentBrokerDrone')
    const tiles = (sw.peerTilesAtCurrentSig?.() ?? []).map(t => ({ name: t.name, layerSig: String(t.layerSig ?? '').slice(0, 12), keys: Object.keys(t) }))
    const g = (sw.peerTilesAtCurrentSig?.() ?? []).find(t => String(t.name).toLowerCase().replace(/[-_\s]+/g, ' ') === game)
    let layer = null, kids = []
    if (g?.layerSig) {
      try { const b = await broker.fetchBySig(g.layerSig, 'layer', 8000); layer = b ? JSON.parse(new TextDecoder().decode(b)) : null } catch (e) { layer = String(e) }
      for (const c of (layer?.children ?? [])) { try { const b = await broker.fetchBySig(c, 'layer', 8000); kids.push(b ? JSON.parse(new TextDecoder().decode(b)).name : null) } catch (e) { kids.push(String(e)) } }
    }
    return { segs: window.ioc.get('@hypercomb.social/Lineage').explorerSegments(), tiles, layer: layer && typeof layer === 'object' ? { name: layer.name, children: (layer.children ?? []).length } : layer, kids }
  }, GAME))))

  // ── THE ROOM LOOKS AT THE QUESTIONS TOGETHER ───────────────────────────
  await word(a, '/questions')
  const together = await H.waitFor(async () => ({ a: await segments(a), b: await segments(b) }),
    v => same(v.a, [LAYER, GAME]) && same(v.b, [LAYER, GAME]), 45000, 750)
  H.check("`questions` walks the room into this layer's Q and A together", together.ok, JSON.stringify(together.value))
  await H.waitFor(() => peerTiles(a), v => has(v, Q), 45000, 750)
  const taken = await H.waitFor(async () => { await settleNow(a); return childrenAt(a, [LAYER, GAME]) }, v => has(v, Q), 60000, 3000)
  H.check("the host's settle takes the participant's question", taken.ok, JSON.stringify(taken.value))

  await enter(b, slug(Q))
  const opened = await H.waitFor(() => deskState(b), v => v.open && v.cell === slug(Q), 15000, 500)
  H.check('clicking the question opens its answers', opened.ok, JSON.stringify({ cell: opened.value?.cell }))
  await write(b, slug(Q), ANSWER)
  await openDesk(a, slug(Q))
  const arrives = await H.waitFor(() => deskState(a), v => !!row(v, ANSWER), 60000, 750)
  H.check("the answer reaches the host's desk in the participant's name", arrives.ok && row(arrives.value, ANSWER)?.by === 'Ben', JSON.stringify(row(arrives.value, ANSWER)))
  await take(a, ANSWER)
  await H.waitFor(() => deskState(a), v => { const r = row(v, ANSWER); return !!r && !r.peer }, 20000, 500)
  await word(a, '/tally')
  const tallied = await H.waitFor(async () => ({ q: await notesAt(a, [LAYER, GAME, slug(Q)]), board: await notesAt(a, [LAYER, GAME]) }),
    v => v.q.some(t => t.startsWith('Tally ·') && /1 take · Ben/.test(t)) && v.board.some(t => t.startsWith('Scoreboard ·') && /Ben — 1 take/.test(t)), 30000, 750)
  H.check("`tally` ranks the layer's answers and scores its Q and A", tallied.ok, JSON.stringify(tallied.value))

  // ── BACK TO THE LAYER, AND LEAVING ─────────────────────────────────────
  await word(a, '/questions back')
  const back = await H.waitFor(async () => ({ a: await segments(a), b: await segments(b) }), v => same(v.a, [LAYER]) && same(v.b, [LAYER]), 45000, 750)
  H.check('`questions back` brings the room back to the layer', back.ok, JSON.stringify(back.value))
  await word(b, '/questions leave')
  const left = await H.waitFor(async () => ({ following: await following(b), door: await door(b) }), v => !v.following && v.door.role !== 'player', 20000, 500)
  H.check('`questions leave` stops following the host', left.ok, JSON.stringify({ following: left.value?.following, role: left.value?.door?.role }))

  console.log('\n========== hypercomb q and a, follow the leader ==========')
  for (const x of H.results) console.log(`  ${x.ok ? '✓' : '✗'} ${x.name}${x.detail ? '  — ' + x.detail : ''}`)
  console.log(`========== ${H.results.filter(x => x.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } }
  process.exit(H.results.every(x => x.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
