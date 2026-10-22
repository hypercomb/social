// scripts/drive-swarm-categories-settle.cjs
//
// CATEGORIES SETTLE BY COUNT (documentation/swarm-pools.md, step seven).
// Three people share a tile. A category is settled when at least two of them,
// and at least half the room, hold it:
//
//   - Energy (Ana, Ben) and Genetics (Ana, Cy) settle — they wear the mark
//   - Ben, who lacks Genetics, is offered the room's structure, settled first
//   - one tap takes it: Genetics joins his tree, and nothing else moves
//
//   node scripts/drive-swarm-categories-settle.cjs --url http://localhost:4251/ --relay ws://localhost:7791

const H = require('./drive-swarm-connectivity.cjs')

const zone = { room: `settle-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: {
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

const joined = (c) => H.evalSafe(() => c.page.evaluate(() => localStorage.getItem('hc:mesh-public') === 'true'))

const openDesk = (c, label, cell) => H.evalSafe(() => c.page.evaluate(({ label, cell }) => {
  window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').setMyLabel(label)
  window.__hypercombEffectBus.emit('notes:panel', { visible: true })
  const cmp = window.ng?.getComponent?.(document.querySelector('hc-notes-strip'))
  cmp?.setTab?.('notes')
  cmp?.activateCell?.(cell)
  return !!cmp
}, { label, cell }))

const write = (c, cell, text) => H.evalSafe(() => c.page.evaluate(({ cell, text }) => {
  window.__hypercombEffectBus.emit('note:commit', { cellLabel: cell, text, mark: null }); return true
}, { cell, text }))

/** Name a category the way `+` does — the service the button calls. */
const name = (c, cell, n) => H.evalSafe(() => c.page.evaluate(async ({ cell, n }) => {
  await window.ioc.get('@diamondcoreprocessor.com/NoteCategories').add(cell, [], n); return true
}, { cell, n }))

/** The tree as the desk paints it: name → { count, held }, and the room's offers. */
const tree = (c) => H.evalSafe(() => c.page.evaluate(async (tile) => {
  await window.ioc.get('@diamondcoreprocessor.com/SwarmNotes')?.refresh?.(tile)
  const el = document.querySelector('hc-notes-strip')
  const mine = {}
  for (const b of el?.querySelectorAll('.cv2-cat-row .cv2-cat:not(.is-room)') ?? []) {
    mine[b.querySelector('.cv2-cat-name')?.textContent.trim()] = b.querySelector('.cv2-cat-held')?.textContent.trim() ?? ''
  }
  const room = [...(el?.querySelectorAll('.cv2-cats-room .cv2-cat-name') ?? [])].map(n => n.textContent.trim())
  return { mine, room }
}, TILE))

const glyphs = (c) => H.evalSafe(() => c.page.evaluate(async (tile) => {
  await window.ioc.get('@diamondcoreprocessor.com/SwarmNotes')?.refresh?.(tile)
  const el = document.querySelector('hc-notes-strip')
  const mine = {}
  for (const b of el?.querySelectorAll('.cv2-cat-row .cv2-cat:not(.is-room)') ?? []) {
    mine[b.querySelector('.cv2-cat-name')?.textContent.trim()] = b.querySelector('.cv2-cat-glyph')?.textContent.trim()
  }
  const take = el?.querySelector('.cv2-cats-take')?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  const room = [...(el?.querySelectorAll('.cv2-cats-room .cv2-cat') ?? [])].map(r => ({ name: r.querySelector('.cv2-cat-name')?.textContent.trim(), settled: r.classList.contains('is-settled') }))
  return { mine, take, room }
}, TILE))

;(async () => {
  const a = await boot('A'), b = await boot('B'), c = await boot('C')
  for (const x of [a, b, c]) {
    await word(x, '/join')
    H.check('joined the room', (await H.waitFor(() => joined(x), v => v, 30000, 500)).ok)
  }
  await H.addTile(a.page, TILE)
  await H.sleep(2500)
  H.check('three desks open on the shared tile', (await openDesk(a, 'Ana', TILE)) && (await openDesk(b, 'Ben', TILE)) && (await openDesk(c, 'Cy', TILE)))
  await write(a, TILE, 'ATP is made in the mitochondria')
  await write(b, TILE, 'Glycolysis splits glucose')
  await write(c, TILE, 'DNA is a double helix')
  await H.sleep(3000)
  await name(a, TILE, 'Energy'); await name(a, TILE, 'Genetics')
  await name(b, TILE, 'Energy')
  await name(c, TILE, 'Genetics')

  const atA = await H.waitFor(() => glyphs(a), v => v?.mine?.Energy === 'verified' && v?.mine?.Genetics === 'verified', 90000, 2000)
  H.check('Energy and Genetics settle — two of three hold each', atA.ok, JSON.stringify(atA.value?.mine))
  const atB = await H.waitFor(() => glyphs(b), v => v?.mine?.Energy === 'verified' && /structure/i.test(v?.take ?? ''), 90000, 2000)
  H.check('Ben sees Energy settled', atB.value?.mine?.Energy === 'verified', JSON.stringify(atB.value?.mine))
  H.check("…and is offered the room's structure, one missing", /1/.test(atB.value?.take ?? ''), atB.value?.take)
  H.check('…with Genetics first in the room, marked settled', atB.value?.room?.[0]?.name === 'Genetics' && atB.value.room[0].settled, JSON.stringify(atB.value?.room))

  await H.evalSafe(() => b.page.evaluate(() => { document.querySelector('hc-notes-strip .cv2-cats-take')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true }))
  const took = await H.waitFor(() => glyphs(b), v => v?.mine?.Genetics === 'verified' && !v.take, 60000, 1500)
  H.check('one tap takes it: Genetics is his, settled, nothing left to take', took.ok, JSON.stringify(took.value))
  H.check('…and nothing else moved', Object.keys(took.value?.mine ?? {}).sort().join() === 'Energy,Genetics', JSON.stringify(took.value?.mine))

  console.log('\n========== categories settle ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  for (const x of [a, b, c]) { try { await x.browser.close() } catch { /* gone */ } }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
