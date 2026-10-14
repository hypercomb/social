// scripts/drive-swarm-lines.cjs
//
// THE LINES — a swarm room as note lines instead of hexagons (jwize
// 2026-10-13). Two participants join one room, stand on one page, open the
// lines, and prove the swarm's acts hold for notes:
//
//   - each one's notes reach the other as lines, text and all (references on
//     the page's word, bytes by signature from the holder's device)
//   - a line wears the colour of whoever brought it, not the house colour
//   - the top counts the room: people, lines, yours, still to take
//   - TAKE collects a line (one note, two holders — never a copy)
//   - leaving takes your untaken lines with you; taken lines stay
//
//   node scripts/drive-swarm-lines.cjs --url http://localhost:4251/ --relay ws://localhost:7777

const H = require('./drive-swarm-connectivity.cjs')

const zone = { room: `lines-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: {
  'hc:swarm:sticky': '1',
} }
const PAGE = 'lecture'

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

/** What the lines view shows, read off its DOM. */
const lines = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const host = document.getElementById('hc-note-lines-host')
  if (!host) return { open: false, rows: [], counts: '' }
  return {
    open: true,
    counts: host.querySelector('.hc-nl-counts')?.textContent ?? '',
    rows: [...host.querySelectorAll('.hc-nl-line')].map(li => ({
      text: li.querySelector('.hc-nl-text')?.textContent ?? '',
      who: li.querySelector('.hc-nl-who')?.textContent ?? '',
      colour: li.style.getPropertyValue('--hc-nl-by'),
      mine: li.classList.contains('is-mine'),
      held: li.querySelector('.hc-nl-held')?.textContent ?? '',
      take: li.querySelector('[data-take]')?.getAttribute('data-take') ?? '',
    })),
  }
}))

const write = (c, text) => H.evalSafe(() => c.page.evaluate(async (text) => {
  const host = document.getElementById('hc-note-lines-host')
  const field = host.querySelector('.hc-nl-field')
  field.value = text
  host.querySelector('.hc-nl-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  return true
}, text))

const take = (c, text) => H.evalSafe(() => c.page.evaluate((text) => {
  const host = document.getElementById('hc-note-lines-host')
  const li = [...host.querySelectorAll('.hc-nl-line')].find(l => l.querySelector('.hc-nl-text')?.textContent === text)
  const btn = li?.querySelector('[data-take]')
  if (!btn) return false
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  return true
}, text))

const row = (view, text) => (view?.rows ?? []).find(r => r.text === text)
const HOUSE = 'rgb(126, 182, 214)'

;(async () => {
  const a = await boot('A'), b = await boot('B')

  for (const c of [a, b]) {
    await word(c, '/join')
    const j = await H.waitFor(() => joined(c), m => m.meshPublic === 'true' && !!m.sig, 30000, 500)
    H.check(`${c.label ?? ''} joined the room`, j.ok, JSON.stringify(j.value))
  }

  // A makes the page in the room (public, as a tile made in a swarm is); both stand on it.
  await H.addTile(a.page, PAGE)
  await H.sleep(2000)
  for (const c of [a, b]) { await H.navTo(c.page, [PAGE]); await H.sleep(1500); await word(c, '/lines') }
  const opened = await H.waitFor(() => lines(b), v => v.open, 15000, 500)
  H.check('the lines word opens the view', opened.ok, JSON.stringify(opened.value))

  await write(a, 'alpha — A wrote this')
  await write(b, 'beta — B wrote this')

  const bSees = await H.waitFor(() => lines(b), v => !!row(v, 'alpha — A wrote this'), 45000, 750)
  const alphaAtB = row(bSees.value, 'alpha — A wrote this')
  H.check("A's note reaches B as a line, text and all", bSees.ok, `${bSees.waitedMs}ms — ${JSON.stringify(bSees.value?.rows)}`)
  H.check("B sees it in A's colour, not the house colour, with a take", !!alphaAtB && alphaAtB.colour !== HOUSE && !alphaAtB.mine && !!alphaAtB.take, JSON.stringify(alphaAtB))
  const aSees = await H.waitFor(() => lines(a), v => !!row(v, 'beta — B wrote this'), 45000, 750)
  H.check("B's note reaches A", aSees.ok, `${aSees.waitedMs}ms`)
  if (!aSees.ok) {
    const dump = (c) => H.evalSafe(() => c.page.evaluate(async (page) => {
      const sw = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
      const notes = window.ioc.get('@diamondcoreprocessor.com/NotesService')
      const h = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
      const layer = await h.currentLayerAt(await h.sign({ explorerSegments: () => [page] }))
      const pub = JSON.parse(localStorage.getItem('hc:public-tiles:/') ?? 'null')
      const d = sw.debug?.() ?? {}
      return {
        segs: window.ioc.get('@hypercomb.social/Lineage').explorerSegments(),
        currentSig: d.currentSig, pageLayer: !!layer, notesSlot: layer?.notes ?? null,
        own: (await notes.getNotesAtSegments([page])).map(n => n.text),
        publicRoot: pub, peerNotes: sw.peerNotesAtCurrentSig?.().length,
        publicKeys: Object.keys(localStorage).filter(k => k.startsWith('hc:public')),
      }
    }, PAGE))
    console.log('DEBUG A', JSON.stringify(await dump(a)))
    console.log('DEBUG B', JSON.stringify(await dump(b)))
  }

  const counts = await H.waitFor(() => lines(b), v => /2 people/.test(v.counts) && /1 to take/.test(v.counts), 20000, 500)
  H.check('the top counts the room', counts.ok, counts.value?.counts)

  await take(b, 'alpha — A wrote this')
  const taken = await H.waitFor(() => lines(b), v => row(v, 'alpha — A wrote this')?.mine === true, 20000, 500)
  H.check('TAKE collects the line', taken.ok, JSON.stringify(row(taken.value, 'alpha — A wrote this')))
  H.check('a taken line keeps the colour of who brought it', row(taken.value, 'alpha — A wrote this')?.colour === alphaAtB?.colour)
  const twoHolders = await H.waitFor(() => lines(a), v => row(v, 'alpha — A wrote this')?.held === '×2', 45000, 750)
  H.check('one note, two holders — never a copy', twoHolders.ok, JSON.stringify(row(twoHolders.value, 'alpha — A wrote this')))

  // A writes one more that B never takes, then leaves.
  await write(a, 'gamma — B never takes this')
  const gamma = await H.waitFor(() => lines(b), v => !!row(v, 'gamma — B never takes this'), 45000, 750)
  H.check('a third line arrives', gamma.ok, `${gamma.waitedMs}ms`)
  await word(a, '/leave')
  const gone = await H.waitFor(() => lines(b), v => !row(v, 'gamma — B never takes this'), 60000, 1000)
  H.check('leaving takes the untaken line away', gone.ok, `${gone.waitedMs}ms — ${JSON.stringify(gone.value?.rows?.map(r => r.text))}`)
  H.check('the taken line stays', !!row(gone.value, 'alpha — A wrote this'), JSON.stringify(gone.value?.rows?.map(r => r.text)))

  console.log('\n========== the lines ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
