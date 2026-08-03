// End-to-end check of the "move the old defaults onto Nature" migration.
//
// Runs against a dev server of its OWN (PORT), in a scratch browser profile:
// a different origin AND a different profile means a different OPFS bucket, so
// the participant's hive is untouched and the one-tab rule is not in play.
//
// The scenario is the one that failed on a real hive:
//   1. dress the tiles from the OLD default pool (Photos)
//   2. WIPE the provenance ledger — the tiles are now "pre-ledger", exactly
//      like a hive dressed before the ledger existed
//   3. wind the sets marker back to v3 and reload
//   4. the migration must advance to Nature AND move every tile
//
// Passing with the ledger wiped is the whole point: the only thing left that
// can recognise those pictures as ours is the `substrate: true` mark in the
// props record.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const DIR = process.env.PROFILE_DIR
const PORT = process.env.PORT ?? '4251'
const URL = `http://localhost:${PORT}/`
mkdirSync(DIR, { recursive: true })

const S = '@diamondcoreprocessor.com/SubstrateService'
const log = (...a) => console.log(...a)

const ctx = await chromium.launchPersistentContext(DIR, { channel: 'chrome', headless: false, viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {})
page.on('console', m => { const t = m.text(); if (/redress|substrate\]/i.test(t)) log('  [console]', t.slice(0, 180)) })

const boot = async () => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(k => !!window.ioc?.get?.(k), S, { timeout: 180000 })
  await page.waitForTimeout(4000)
}

// The props index the renderer resolves pictures through.
const readIndex = () => page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    if (!/prop/i.test(k)) continue
    try {
      const v = JSON.parse(localStorage.getItem(k))
      if (v && typeof v === 'object' && Object.values(v).some(x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x))) return { key: k, entries: v }
    } catch { /* not json */ }
  }
  return { key: null, entries: {} }
})

await boot()

// ── 1. old world: Photos active, tiles dressed from it ──────────────
const dressed = await page.evaluate(async (k) => {
  const s = window.ioc.get(k)
  await s.setActive('builtin:defaults')
  await s.warmUp()
  const places = typeof s.allPlaces === 'function' ? await s.allPlaces() : null
  if (!places) return { error: 'allPlaces missing — server is serving STALE essentials' }
  let applied = 0
  for (const p of places) applied += (await s.applyToAllBlanks(p.names, p.segments)).length
  // Tiles dressed on an earlier boot keep those pictures; force them onto the
  // Photos pool so the scenario really starts in the old world.
  const forced = (await s.restyleEverywhere()).length
  return {
    applied, forced,
    tiles: places.reduce((n, p) => n + p.names.length, 0),
    pool: s.poolSigs.length,
    active: s.registry.activeId,
  }
}, S)
log('[1] dressed from Photos:', JSON.stringify(dressed))
if (dressed.error) { await ctx.close(); process.exit(1) }

const before = await readIndex()
log('[1] props index:', before.key, Object.keys(before.entries).length, 'entries')

// ── 2+3. wipe the ledger, wind the marker back, reload ──────────────
await page.evaluate(() => {
  localStorage.removeItem('hc:substrate-assigned')   // pre-ledger hive
  localStorage.removeItem('hc:substrate-redress-v')
  localStorage.setItem('hc:substrate-sets-v', '3')   // as if still on v3
})
log('[2] ledger wiped, sets marker wound back to v3')

await boot()
log('[3] reloaded — waiting for the idle pass')
await page.waitForFunction(
  () => localStorage.getItem('hc:substrate-redress-v') === '4',
  null, { timeout: 120000 },
).catch(() => log('  !! redress marker never advanced'))

// ── 4. what moved ───────────────────────────────────────────────────
const after = await readIndex()
const verdict = await page.evaluate(async ({ k, before }) => {
  const s = window.ioc.get(k)
  await s.warmUp()
  const pool = new Set(s.poolSigs)
  const now = (() => { try { return JSON.parse(localStorage.getItem(before.key)) ?? {} } catch { return {} } })()
  let moved = 0, stayed = 0, gone = 0, inNaturePool = 0
  const rows = []
  for (const [cell, sig] of Object.entries(before.entries)) {
    if (typeof sig !== 'string') continue
    const next = now[cell]
    if (!next) gone++
    else if (next !== sig) moved++
    else stayed++
    if (next && pool.has(next)) inNaturePool++
    rows.push({ cell: cell.slice(0, 12), was: sig.slice(0, 8), now: (next ?? '(none)').slice(0, 8), inPool: !!next && pool.has(next) })
  }
  return {
    rows,
    afterKeys: Object.keys(now).length,
    poolSample: [...pool].slice(0, 3).map(x => x.slice(0, 8)),
    gone,
    active: s.registry.activeId,
    setsV: localStorage.getItem('hc:substrate-sets-v'),
    redressV: localStorage.getItem('hc:substrate-redress-v'),
    poolSize: pool.size,
    imageSample: (s.listImages?.() ?? []).slice(0, 3).map(i => i.name),
    moved, stayed, inNaturePool,
  }
}, { k: S, before })

log('[4] verdict:', JSON.stringify(verdict, null, 2))
log(verdict.moved > 0 && verdict.moved === verdict.inNaturePool
  ? `PASS — ${verdict.moved} tiles moved, all now wearing pictures from the active pool`
  : `FAIL — moved=${verdict.moved} stayed=${verdict.stayed} inPool=${verdict.inNaturePool}`)

await page.screenshot({ path: process.env.SHOT ?? 'redress-after.png' })
if (!process.env.KEEP) await ctx.close()
