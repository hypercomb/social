// scripts/drive-tutorial.cjs
//
// `start tutorial`, END TO END (documentation/walk.md, questions/tutorial.drone.ts).
// jwize, 2026-10-24: "start q and a and then the member can join and then we
// all go together … the full explanation auto play and then continue from the
// completion, playing."
//
//   - the host says `start tutorial`: a Hypercomb Q and A begins where they
//     stand, and the explanation is laid out on a `tutorial` tile
//   - a guest taps Join on the game's door (a guest needs no new package —
//     the door and following are already in every hive), and follows the host
//   - the explanation plays itself; at every page the guest stands where the
//     host stands and reads the host's titled tiles
//   - when it ends, host and guest are walked into the questions together; the
//     guest asks one and the host's hive hears it
//
//   node scripts/drive-tutorial.cjs --url http://localhost:4257/ --guest-url https://hypercomb.io/ --relay wss://hypercomb.com

const H = require('./drive-swarm-connectivity.cjs')

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const GUEST_URL = arg('guest-url', H.URL_)
const SECONDS = Number(arg('seconds', '12'))
const FIRST = Number(arg('first', '25'))
const GAME = 'hypercomb q and a'
const Q = 'how do i take an answer'
const zone = { room: `tutorial-${Date.now().toString(36)}`, secret: 'secret-' + Math.random().toString(36).slice(2, 10), relay: H.RELAY ?? 'wss://hypercomb.com', seed: { 'hc:swarm:sticky': '1' } }

const slug = (s) => String(s).trim().toLowerCase().replace(/[._\s]+/g, '-').replace(/[^\p{L}\p{N}\-]/gu, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
const same = (a, b) => JSON.stringify((a ?? []).map(slug)) === JSON.stringify((b ?? []).map(slug))
const evalIn = (c, fn, a) => H.evalSafe(() => c.page.evaluate(fn, a))
const word = (c, text) => evalIn(c, (text) => { window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').emitEffect('command-line:remote-submit', { text }); return true }, text)
const here = (c) => evalIn(c, () => window.ioc.get('@hypercomb.social/Lineage').explorerSegments())
const following = (c) => evalIn(c, () => window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').following?.() ?? '')
const pubkey = (c) => evalIn(c, async () => await window.ioc.get('@diamondcoreprocessor.com/NostrSigner').getPublicKeyHex())
const peerTiles = (c) => evalIn(c, () => (window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').peerTilesAtCurrentSig?.() ?? [])
  .map(t => ({ name: t.name, title: Object.values(t.titles ?? {})[0] ?? '' })))
const childrenAt = (c, segs) => evalIn(c, async (segs) => {
  const h = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
  const layer = await h.currentLayerAt(await h.sign({ explorerSegments: () => segs }))
  const names = []
  for (const s of (layer?.children ?? [])) { try { const l = await h.getLayerBySig(s); if (l?.name) names.push(l.name) } catch { /* cold */ } }
  return names
}, segs)
const door = (c) => evalIn(c, () => {
  const el = document.querySelector('hc-questions-door')
  return {
    open: !!el && el.hasAttribute('data-open') && getComputedStyle(el).display !== 'none',
    role: el?.getAttribute('data-role') ?? '',
    text: el?.querySelector('.qa-text')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    buttons: [...(el?.querySelectorAll('button[data-act]') ?? [])].map(b => b.dataset.act),
  }
})

async function boot(label, url) {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const c = await H.newClient(browser, label, zone); c.browser = browser; c.label = label
  await c.page.goto(url, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(c.page); await H.installIfNeeded(c.page, label)
  if (!(await H.waitForReady(c.page))) throw new Error(`${label}: not ready`)
  await H.settle(c.page)
  await evalIn(c, (label) => { window.ioc.get('@diamondcoreprocessor.com/SwarmDrone').setMyLabel(label); return true }, label)
  return c
}

;(async () => {
  const host = await boot('Host', H.URL_)
  const guest = await boot('Guest', GUEST_URL)
  for (const c of [host, guest]) {
    await word(c, '/join')
    const j = await H.waitFor(() => evalIn(c, () => localStorage.getItem('hc:mesh-public')), v => v === 'true', 30000, 500)
    H.check(`${c.label} joined room ${zone.room} at ${zone.relay}`, j.ok, String(j.value))
  }
  const hostKey = await pubkey(host)
  const has = await evalIn(host, () => !!window.ioc.get('@diamondcoreprocessor.com/TutorialDrone'))
  H.check('the host’s shell carries `start tutorial`', !!has, String(has))
  await evalIn(host, ({ s, f }) => { const t = window.ioc.get('@diamondcoreprocessor.com/TutorialDrone'); t.seconds = s; t.firstSeconds = f; return true }, { s: SECONDS, f: FIRST })
  const stops = [['tutorial'], ['tutorial', 'following'], ['tutorial', 'basics'], ['tutorial', 'idea'], ['tutorial', 'playing']]

  // ── THE HOST SAYS IT ────────────────────────────────────────────────────
  await word(host, '/start tutorial')
  const laid = await H.waitFor(async () => ({ root: await childrenAt(host, []), inside: await childrenAt(host, ['tutorial']) }),
    v => (v.root ?? []).includes('tutorial') && ['following', 'basics', 'idea', 'playing'].every(n => (v.inside ?? []).includes(n)), 60000, 1000)
  H.check('`start tutorial` lays the explanation out on a tutorial tile', laid.ok, JSON.stringify(laid.value))
  const hostDoor = await H.waitFor(() => door(host), v => v.open && v.role === 'host', 30000, 500)
  H.check('…and leads a Q and A where the host stands', hostDoor.ok, hostDoor.value?.text)

  // ── THE GUEST TAPS JOIN ─────────────────────────────────────────────────
  const offer = await H.waitFor(() => door(guest), v => v.open && v.role === 'offered' && v.buttons.includes('join'), 60000, 750)
  H.check('the guest’s door offers the game, with Join', offer.ok, JSON.stringify(offer.value))
  await guest.page.locator('hc-questions-door button[data-act="join"]').first().click({ timeout: 5000 }).catch(e => H.log('guest', 'join tap failed', String(e).slice(0, 120)))
  const joined = await H.waitFor(() => following(guest), v => v === hostKey, 20000, 500)
  H.check('tapping Join follows the host', joined.ok, String(joined.value).slice(0, 8))

  // ── CARRIED THROUGH THE EXPLANATION ─────────────────────────────────────
  const expected = {
    'tutorial': ['following', 'basics', 'idea', 'playing'],
    'tutorial/following': ['you-go', 'new-page', 'ask-any-page', 'leave'],
    'tutorial/basics': ['one-thing', 'go-in', 'notes', 'take'],
    'tutorial/idea': ['people', 'protocol', 'fingerprint', 'peers', 'sovereign'],
    'tutorial/playing': ['ask', 'answer', 'pick', 'best', 'then'],
  }
  for (const stop of stops) {
    const key = stop.join('/')
    const at = await H.waitFor(async () => ({ host: await here(host), guest: await here(guest) }),
      v => same(v.host, stop) && same(v.guest, stop), (FIRST + SECONDS) * 1000 + 20000, 500)
    const tiles = at.ok ? await H.waitFor(() => peerTiles(guest), v => expected[key].every(n => v.some(t => slug(t.name) === n)), 15000, 500) : { ok: false, value: [] }
    H.check(`page /${key}: the guest stands where the host stands and reads its ${expected[key].length} tiles`, at.ok && tiles.ok,
      JSON.stringify({ at: at.value, titles: (tiles.value ?? []).map(t => t.title || t.name) }))
  }

  // ── THEN THE ROOM PLAYS ─────────────────────────────────────────────────
  const inQuestions = await H.waitFor(async () => ({ host: await here(host), guest: await here(guest) }),
    v => same(v.host, [GAME]) && same(v.guest, [GAME]), SECONDS * 1000 + 30000, 500)
  H.check('when it ends, host and guest are walked into the questions together', inQuestions.ok, JSON.stringify(inQuestions.value))
  await word(guest, `/question ${Q}`)
  const heard = await H.waitFor(() => peerTiles(host), v => v.some(t => slug(t.name) === slug(Q)), 45000, 1000)
  H.check('the guest asks there, and the host’s hive hears the question', heard.ok, JSON.stringify((heard.value ?? []).map(t => t.title || t.name)))

  for (const c of [host, guest]) await c.browser.close()
  H.finish()
})().catch(e => { console.error('[tutorial] fatal:', e); process.exit(1) })
