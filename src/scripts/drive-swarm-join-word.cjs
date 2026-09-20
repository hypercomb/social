// scripts/drive-swarm-join-word.cjs
//
// THE WORD THAT PUTS YOU IN A SWARM. Joining had no beehavior — only a
// keyboard shortcut and a control — and a hive sat outside a swarm for an
// evening with `hc:mesh-public: "false"`, an empty zone signature, and a crumb
// that read "public · humble slope · secure" (world mode and the zone's words,
// not membership). Nothing anywhere said "you never joined".
//
// Proves the word does what the control does, and says so when there is
// nothing to do:
//
//   - a fresh hive is NOT in a swarm, whatever the crumb says
//   - `/join` composes a zone signature and flips the flag
//   - `/join` again is idempotent — it never toggles a joined hive back out
//   - `/leave` puts it back, and is idempotent too
//   - two hives that both said the word see each other
//
//   node scripts/drive-swarm-join-word.cjs --relay ws://localhost:7777

const H = require('./drive-swarm-connectivity.cjs')

const zone = { room: `joinword-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY, seed: {
  'hc:swarm:sticky': '1',
  // The AVAILABILITY GATE holds public tiles whose closure has no host
  // receipts. This run has no host, and it is testing the WORD, not the gate
  // — the sanctioned bypass is the same one /use-live-relay sets.
  'hc:swarm:ungated': '1',
} }

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

/** Exactly what the participant's own diagnostic reads. */
const membership = (c) => H.evalSafe(() => c.page.evaluate(() => {
  const s = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
  const d = s?.debug?.() ?? {}
  return {
    meshPublic: localStorage.getItem('hc:mesh-public'),
    sig: d.currentSig ?? '',
    peerTiles: (s?.peerTilesAtCurrentSig?.() ?? []).map(t => t.name),
  }
}))

const word = (c, text) => H.evalSafe(() => c.page.evaluate((text) => {
  const bee = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
  bee.emitEffect('command-line:remote-submit', { text })
  return true
}, text))

const wordRegistered = (c) => H.evalSafe(() => c.page.evaluate(() => ({
  join: !!window.ioc.get('@diamondcoreprocessor.com/JoinQueenBee'),
  leave: !!window.ioc.get('@diamondcoreprocessor.com/LeaveQueenBee'),
  inCensus: (window.ioc.get('@diamondcoreprocessor.com/SlashBehaviourDrone')?.entries?.() ?? [])
    .filter(e => e.name === 'join' || e.name === 'leave').map(e => e.name).sort(),
})))

;(async () => {
  const a = await boot('A'), b = await boot('B')

  const reg = await wordRegistered(a)
  H.check('join and leave are registered behaviours', reg.join && reg.leave, JSON.stringify(reg))
  H.check('and both are in the spoken census', JSON.stringify(reg.inCensus) === '["join","leave"]', JSON.stringify(reg.inCensus))

  const before = await membership(a)
  H.check('a fresh hive is NOT in a swarm', before.meshPublic !== 'true' && !before.sig, JSON.stringify(before))

  await word(a, '/join')
  const joined = await H.waitFor(() => membership(a), m => m.meshPublic === 'true' && !!m.sig, 30000, 500)
  H.check('/join puts the hive in the swarm', joined.ok, JSON.stringify(joined.value))

  // Saying it twice must not toggle back out — the trap a bare toggle sets.
  await word(a, '/join')
  await H.sleep(2500)
  const twice = await membership(a)
  H.check('/join again leaves it joined', twice.meshPublic === 'true' && !!twice.sig, JSON.stringify(twice))

  // The other hive says the word too, then they must find each other.
  await word(b, '/join')
  await H.waitFor(() => membership(b), m => m.meshPublic === 'true' && !!m.sig, 30000, 500)
  await H.addTile(a.page, 'orchard')
  const sees = await H.waitFor(() => H.peerTilesNow(b.page), t => t.includes('orchard'), 30000, 500)
  H.check('two hives that said the word see each other', sees.ok, `${sees.waitedMs}ms — ${JSON.stringify(sees.value)}`)

  await word(b, '/leave')
  const left = await H.waitFor(() => membership(b), m => m.meshPublic !== 'true', 30000, 500)
  H.check('/leave puts it back out', left.ok, JSON.stringify(left.value))
  await word(b, '/leave')
  await H.sleep(2500)
  H.check('/leave again leaves it out', (await membership(b)).meshPublic !== 'true')

  console.log('\n========== the join word ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  if (!H.KEEP) for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
