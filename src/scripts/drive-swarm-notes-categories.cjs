// scripts/drive-swarm-notes-categories.cjs
//
// CATEGORIES IN THE ROOM (documentation/swarm-notes.md, "Categories"). Two
// participants share a tile; each one's category tree rides their own layer
// for it, so the room's structure settles by numbers:
//
//   - a category both of them hold counts both (×2), on both desks
//   - a category only one holds is offered to the other under "In the room"
//   - taking it (✓) adds it to the taker's own tree — and then it counts ×2
//
//   node scripts/drive-swarm-notes-categories.cjs --url http://localhost:4251/ --relay ws://localhost:7791

const H = require('./drive-swarm-connectivity.cjs')

const zone = { room: `cats-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: {
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

;(async () => {
  const a = await boot('A'), b = await boot('B')
  for (const c of [a, b]) {
    await word(c, '/join')
    H.check('joined the room', (await H.waitFor(() => joined(c), v => v, 30000, 500)).ok)
  }

  await H.addTile(a.page, TILE)
  await H.sleep(2500)
  H.check('both desks open on the shared tile', (await openDesk(a, 'Ana', TILE)) && (await openDesk(b, 'Ben', TILE)))
  // Each one's first note shares their tile, so their layer — and the tree on
  // it — is in the room.
  await write(a, TILE, 'ATP is made in the mitochondria')
  await write(b, TILE, 'DNA is a double helix')
  await H.sleep(3000)

  await name(a, TILE, 'Energy')
  await name(a, TILE, 'Genetics')
  await name(b, TILE, 'Energy')

  const atA = await H.waitFor(() => tree(a), v => v?.mine?.Energy === '×2', 60000, 1500)
  H.check('a category both hold counts both, on her desk', atA.ok, JSON.stringify(atA.value))
  H.check('one only she holds counts only her', atA.value?.mine?.Genetics === '', JSON.stringify(atA.value?.mine))
  const atB = await H.waitFor(() => tree(b), v => v?.mine?.Energy === '×2' && v?.room?.includes('Genetics'), 60000, 1500)
  H.check('…and on his: Energy ×2', atB.value?.mine?.Energy === '×2', JSON.stringify(atB.value))
  H.check('Genetics is offered to him under "In the room"', !!atB.value?.room?.includes('Genetics'), JSON.stringify(atB.value?.room))

  // He takes it with ✓.
  const took = await H.evalSafe(() => b.page.evaluate(() => {
    const row = [...document.querySelectorAll('hc-notes-strip .cv2-cats-room .cv2-cat-row')]
      .find(r => r.querySelector('.cv2-cat-name')?.textContent.trim() === 'Genetics')
    const btn = row?.querySelector('.cv2-cat-act')
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return !!btn
  }))
  H.check('he takes it', took)
  const taken = await H.waitFor(() => tree(b), v => 'Genetics' in (v?.mine ?? {}) && !v.room.includes('Genetics'), 30000, 1000)
  H.check('it is in his own tree now, no longer an offer', taken.ok, JSON.stringify(taken.value))
  const settled = await H.waitFor(() => tree(a), v => v?.mine?.Genetics === '×2', 60000, 1500)
  H.check('the room settles: Genetics ×2 on her desk too', settled.ok, JSON.stringify(settled.value))

  console.log('\n========== categories in the room ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
