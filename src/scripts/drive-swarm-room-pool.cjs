// scripts/drive-swarm-room-pool.cjs
//
// A SWARM ROOM IS A POOL (documentation/swarm-pools.md, step two). Two
// participants meet at a scratch relay running this tree's relay.js — the
// room's host — and the room's pool keeps what was shared:
//
//   - sharing a page writes a signed member to the room pool on the host,
//     naming the exact word the relay took (uploaded there as an atom)
//   - a participant who joins reads the pool back: the other's member stands
//   - after the sharer LEAVES, the member and the word are still on the host
//     (presence decides what the room shows; the pool is what stays)
//
//   node scripts/drive-swarm-room-pool.cjs --url http://localhost:4251/ [--relay-port 7791]

const H = require('./drive-swarm-connectivity.cjs')

const PORT = Number((process.argv.find((a, i) => process.argv[i - 1] === '--relay-port')) || 7791)
let zone

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

const joined = (c) => H.evalSafe(() => c.page.evaluate(() => ({
  meshPublic: localStorage.getItem('hc:mesh-public'),
  sig: window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')?.debug?.()?.currentSig ?? '',
})))

const pool = (c) => H.evalSafe(() => c.page.evaluate(async () => {
  const rp = window.ioc.get('@diamondcoreprocessor.com/RoomPool')
  return { address: await rp.address(), host: rp.host() }
}))

const standing = (c) => H.evalSafe(() => c.page.evaluate(async () =>
  (await window.ioc.get('@diamondcoreprocessor.com/RoomPool').read()).map(m => ({ signer: m.signer, head: m.head, page: m.page }))))

const pubkey = (c) => H.evalSafe(() => c.page.evaluate(async () =>
  await window.ioc.get('@diamondcoreprocessor.com/NostrSigner').getPublicKeyHex()))

const hostListing = async (address) => {
  const res = await fetch(`http://localhost:${PORT}/${address}/`)
  return res.ok ? (await res.text()).split('\n').filter(Boolean) : []
}

;(async () => {
  const relay = await H.startScratchRelay(PORT, 'swarm')
  zone = { room: `pool-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay, seed: { 'hc:swarm:sticky': '1', ...H.swarmSeed(relay) } }
  const a = await boot('A')
  const b = await boot('B')
  try {
    await word(a, '/join')
    const ja = await H.waitFor(() => joined(a), m => m.meshPublic === 'true' && !!m.sig, 30000, 500)
    H.check('A joined the room', ja.ok, JSON.stringify(ja.value))
    const { address, host } = await pool(a)
    H.check('the room has a pool address on its host', /^[0-9a-f]{64}$/.test(address) && host === `localhost:${PORT}`, JSON.stringify({ address: address.slice(0, 12), host }))

    await H.addTile(a.page, 'lecture')
    const listed = await H.waitFor(() => hostListing(address), names => names.length > 0, 45000, 1000)
    H.check('sharing a page writes a member to the room pool on the host', listed.ok, `${listed.waitedMs}ms — ${listed.value.length} member(s)`)

    const aKey = await pubkey(a)
    const own = await H.waitFor(() => standing(a), s => s.some(m => m.signer === aKey), 15000, 500)
    const head = own.value?.find(m => m.signer === aKey)?.head ?? ''
    const atom = head ? await fetch(`http://localhost:${PORT}/${head}`) : null
    const wordText = atom?.ok ? await atom.text() : ''
    H.check('the member names the exact word, held on the host', /"lecture"/.test(wordText), wordText.slice(0, 120))

    await word(b, '/join')
    const jb = await H.waitFor(() => joined(b), m => m.meshPublic === 'true' && !!m.sig, 30000, 500)
    H.check('B joined the same room', jb.ok && jb.value.sig === ja.value.sig, JSON.stringify(jb.value))
    const bReads = await H.waitFor(() => standing(b), s => s.some(m => m.signer === aKey && m.head === head), 20000, 1000)
    H.check("B reads the pool back: A's member stands", bReads.ok, JSON.stringify(bReads.value))

    await word(a, '/leave')
    await H.sleep(3000)
    const after = await standing(b)
    const still = after.some(m => m.signer === aKey && m.head === head)
    const kept = (await fetch(`http://localhost:${PORT}/${head}`)).ok
    H.check('after A leaves, the pool still holds A\'s member and its word', still && kept, JSON.stringify({ still, kept }))
  } finally {
    console.log('\n========== the room pool ==========')
    for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
    console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
    if (!H.KEEP) for (const c of [a, b]) { try { await c.browser.close() } catch { /* gone */ } }
    H.stopScratchRelay()
  }
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); H.stopScratchRelay(); process.exit(1) })
