// scripts/drive-swarm-notes.cjs
//
// NOTES IN THE SWARM (jwize 2026-10-13: "integrate this into our notes … and
// make them possible to swarm with"). Two participants join one room and open
// the notes desk on the one tile they share, and the swarm's acts hold for
// notes in the SAME desk:
//
//   - each one's notes reach the other in the notes tree (read from the peer's
//     layer for the tile — no new wire), text and all
//   - a peer's note wears its author's colour and name, with a Take
//   - the footer counts the room: here · notes · yours · to take
//   - TAKE collects it (one note, two holders — never a copy)
//   - leaving takes your untaken notes with you; taken ones stay
//
//   node scripts/drive-swarm-notes.cjs --url http://localhost:4251/ --relay ws://localhost:7777

const H = require('./drive-swarm-connectivity.cjs')

const zone = { room: `notes-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: {
  'hc:swarm:sticky': '1',
} }
const TILE = 'lecture'

async function boot(label) {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const c = await H.newClient(browser, label, zone); c.browser = browser
  await c.page.goto(H.URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(c.page); await H.installIfNeeded(c.page, label)
  if (!(await H.waitForReady(c.page))) throw new Error(`${label}: not ready`)
  await H.settle(c.page)
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

/** Open the desk on the tile — the control bar's toggle, then the tile made
 *  active the way a click on it in the tile list makes it active. */
const openDesk = (c, label, cell) => H.evalSafe(() => c.page.evaluate(({ label, cell }) => {
  window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').setMyLabel(label)
  window.__hypercombEffectBus.emit('notes:panel', { visible: true })
  const el = document.querySelector('hc-notes-strip')
  const cmp = window.ng?.getComponent?.(el)
  cmp?.setTab?.('notes')
  cmp?.activateCell?.(cell)
  return !!cmp
}, { label, cell }))

const write = (c, cell, text) => H.evalSafe(() => c.page.evaluate(({ cell, text }) => {
  window.__hypercombEffectBus.emit('note:commit', { cellLabel: cell, text, mark: null })
  return true
}, { cell, text }))

/** What the desk shows, read off its DOM. */
const desk = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const el = document.querySelector('hc-notes-strip')
  const rows = [...(el?.querySelectorAll('.cv2-list .cv2-note[data-note-id]') ?? [])].map(r => ({
    text: r.querySelector('.cv2-note-text')?.textContent?.trim() ?? '',
    peer: r.classList.contains('is-peer'),
    colour: r.style.getPropertyValue('--peer'),
    by: r.querySelector('.cv2-peer-by')?.textContent ?? '',
    held: r.querySelector('.cv2-peer-held')?.textContent ?? '',
    take: !!r.querySelector('.cv2-peer-check'),
    dismiss: !!r.querySelector('.cv2-peer-dismiss'),
  }))
  return { rows, counts: el?.querySelector('.cv2-swarm-counts')?.textContent?.trim() ?? '', footer: el?.querySelector('.cv2-foot')?.textContent?.replace(/\s+/g, ' ').trim() ?? '' }
}))

const take = (c, text) => H.evalSafe(() => c.page.evaluate((text) => {
  const row = [...document.querySelectorAll('hc-notes-strip .cv2-note[data-note-id]')]
    .find(r => r.querySelector('.cv2-note-text')?.textContent?.trim() === text)
  const btn = row?.querySelector('.cv2-peer-check')
  if (!btn) return false
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return true
}, text))

const row = (view, text) => (view?.rows ?? []).find(r => r.text === text)

;(async () => {
  const a = await boot('A'), b = await boot('B')

  for (const c of [a, b]) {
    await word(c, '/join')
    const j = await H.waitFor(() => joined(c), m => m.meshPublic === 'true' && !!m.sig, 30000, 500)
    H.check('joined the room', j.ok, JSON.stringify(j.value))
  }

  // A makes the tile in the room (public, as a tile made in a swarm is).
  await H.addTile(a.page, TILE)
  await H.sleep(2500)
  H.check('the desk opens on the shared tile', (await openDesk(a, 'Ana', TILE)) && (await openDesk(b, 'Ben', TILE)))

  await write(a, TILE, 'alpha — Ana wrote this')
  const bSees = await H.waitFor(() => desk(b), v => !!row(v, 'alpha — Ana wrote this'), 45000, 750)
  const alphaAtB = row(bSees.value, 'alpha — Ana wrote this')
  H.check("Ana's note reaches Ben's notes tree", bSees.ok, `${bSees.waitedMs}ms — ${JSON.stringify(bSees.value?.rows)}`)
  H.check('it is hers: her colour, her name, a Take', !!alphaAtB && alphaAtB.peer && !!alphaAtB.colour && alphaAtB.by === 'Ana' && alphaAtB.take, JSON.stringify(alphaAtB))

  await write(b, TILE, 'beta — Ben wrote this')
  const aSees = await H.waitFor(() => desk(a), v => !!row(v, 'beta — Ben wrote this'), 45000, 750)
  H.check("Ben's note reaches Ana (his first note shared his tile)", aSees.ok, `${aSees.waitedMs}ms — ${JSON.stringify(aSees.value?.rows)}`)
  if (!aSees.ok) {
    const dump = (c) => H.evalSafe(() => c.page.evaluate(async (tile) => {
      const sw = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
      const h = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
      const layer = await h.currentLayerAt(await h.sign({ explorerSegments: () => [tile] }))
      return {
        segs: window.ioc.get('@hypercomb.social/Lineage').explorerSegments(),
        notesSlot: layer?.notes ?? null,
        publicRoot: localStorage.getItem('hc:public-tiles:/'),
        peerTiles: (sw.peerTilesAtCurrentSig?.() ?? []).map(t => ({ name: t.name, by: t.peerPubkey.slice(0, 6), layer: String(t.layerSig ?? '').slice(0, 8), served: t.served })),
        roots: window.ioc.get('@diamondcoreprocessor.com/SwarmNotes').rootsFor(tile).map(r => r.note.text),
        rootChildren: await Promise.all(((await h.currentLayerAt(await h.sign({ explorerSegments: () => [] })))?.children ?? []).map(async s => (await h.getLayerBySig(s))?.name)),
        debug: (() => { const d = sw.debug?.() ?? {}; return { walks: d.walks ?? d.walkStats, share: d.shareStatus, keys: Object.keys(d) } })(),
      }
    }, TILE))
    console.log('DEBUG A', JSON.stringify(await dump(a)))
    console.log('DEBUG B', JSON.stringify(await dump(b)))
  }

  if (process.argv.includes('--debug')) console.log('DEBUG DESK B', JSON.stringify(await H.evalSafe(() => b.page.evaluate(() => {
    const cmp = window.ng?.getComponent?.(document.querySelector('hc-notes-strip'))
    return { cell: cmp?.cell?.(), notes: cmp?.notes?.().map(n => n.text), peers: cmp?.peerRoots?.().length, counts: cmp?.swarmCounts?.(),
      segs: window.ioc.get('@hypercomb.social/Lineage').explorerSegments(), sel: window.ioc.get('@diamondcoreprocessor.com/SelectionService')?.active,
      rows: document.querySelectorAll('hc-notes-strip .cv2-note').length, open: getComputedStyle(document.querySelector('hc-notes-strip')).display }
  }))))
  const counts = await H.waitFor(() => desk(b), v => /^2 here/.test(v.counts) && /1 to take/.test(v.counts), 20000, 500)
  H.check('the footer counts the room', counts.ok, counts.value?.counts)

  await take(b, 'alpha — Ana wrote this')
  const taken = await H.waitFor(() => desk(b), v => { const r = row(v, 'alpha — Ana wrote this'); return !!r && !r.peer }, 20000, 500)
  H.check('TAKE makes it yours', taken.ok, JSON.stringify(row(taken.value, 'alpha — Ana wrote this')))
  const two = await H.waitFor(() => desk(a), v => row(v, 'alpha — Ana wrote this')?.held === '×2', 45000, 750)
  H.check('one note, two holders — never a copy', two.ok, JSON.stringify(row(two.value, 'alpha — Ana wrote this')))

  // DISMISS waves a line off for the session; the footer brings it back.
  await write(a, TILE, 'delta — Ben dismisses this')
  await H.waitFor(() => desk(b), v => !!row(v, 'delta — Ben dismisses this'), 45000, 750)
  await H.evalSafe(() => b.page.evaluate(() => {
    const r = [...document.querySelectorAll('hc-notes-strip .cv2-note[data-note-id]')].find(x => x.querySelector('.cv2-note-text')?.textContent?.trim() === 'delta — Ben dismisses this')
    r?.querySelector('.cv2-peer-dismiss')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }))
  const dismissed = await H.waitFor(() => desk(b), v => !row(v, 'delta — Ben dismisses this') && /dismissed/.test(v.footer ?? ''), 10000, 300)
  H.check('dismiss hides the line and the footer says so', dismissed.ok, JSON.stringify(dismissed.value?.footer))

  await write(a, TILE, 'gamma — Ben never takes this')
  const gamma = await H.waitFor(() => desk(b), v => !!row(v, 'gamma — Ben never takes this'), 45000, 750)
  H.check('a third note arrives', gamma.ok, `${gamma.waitedMs}ms`)

  // ONE LIST, THE SAME FOR EVERYONE: lines read in the order they were
  // written (each writer's arrival time), not "mine first" on each desk.
  const order = (v) => (v?.rows ?? []).map(r => r.text).filter(t => !t.startsWith('delta'))
  const same = await H.waitFor(async () => [order(await desk(a)), order(await desk(b))],
    ([x, y]) => x.length >= 3 && JSON.stringify(x) === JSON.stringify(y), 20000, 750)
  H.check('both desks show the room in the same written order', same.ok, JSON.stringify(same.value))
  await word(a, '/leave')
  const gone = await H.waitFor(() => desk(b), v => !row(v, 'gamma — Ben never takes this'), 90000, 1000)
  H.check('leaving takes the untaken note away', gone.ok, `${gone.waitedMs}ms — ${JSON.stringify(gone.value?.rows?.map(r => r.text))}`)
  H.check('the taken note stays', !!row(gone.value, 'alpha — Ana wrote this'), JSON.stringify(gone.value?.rows?.map(r => r.text)))

  console.log('\n========== notes in the swarm ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
