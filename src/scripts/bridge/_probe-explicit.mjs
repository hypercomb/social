// The safety half: a picture the PARTICIPANT put on a tile must survive a
// re-dress. Plants an explicit (no `substrate` mark) props record on one tile,
// then runs the same whole-hive re-dress the migration runs.
import { chromium } from 'playwright'
const DIR = process.env.PROFILE_DIR
const PORT = process.env.PORT ?? '4251'

const ctx = await chromium.launchPersistentContext(DIR, { channel: 'chrome', headless: false, viewport: { width: 1400, height: 900 } })
const page = await ctx.newPage()
for (const p of ctx.pages()) if (p !== page) await p.close().catch(() => {})
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(k => !!window.ioc?.get?.(k), '@diamondcoreprocessor.com/SubstrateService', { timeout: 180000 })
await page.waitForTimeout(5000)

const out = await page.evaluate(async () => {
  const s = window.ioc.get('@diamondcoreprocessor.com/SubstrateService')
  const store = window.ioc.get((window.ioc.list?.() ?? []).find(k => /\/Store$/.test(k)))
  await s.warmUp()
  const idx = () => JSON.parse(localStorage.getItem('hc:tile-props-index') ?? '{}')

  // Which index key belongs to 'alpha'? Re-dress just that tile and watch.
  const a = idx()
  await s.restyle(['alpha'])
  const b = idx()
  const alphaKey = Object.keys({ ...a, ...b }).find(k => a[k] !== b[k])
  if (!alphaKey) return { error: 'could not identify alpha\'s index key' }

  // Plant an EXPLICIT picture: same shape a tile-editor save writes, and the
  // one thing that matters — no `substrate` mark.
  const imageSig = Object.values(JSON.parse(await (await store.getResource(b[alphaKey])).text()))
  void imageSig
  const mine = JSON.parse(await (await store.getResource(b[alphaKey])).text())
  delete mine.substrate
  const explicitSig = await store.putResource(new Blob([JSON.stringify(mine, null, 2)], { type: 'application/json' }))
  const index = idx(); index[alphaKey] = explicitSig
  localStorage.setItem('hc:tile-props-index', JSON.stringify(index))

  const before = idx()
  const redressed = await s.restyleEverywhere()
  const after = idx()

  return {
    alphaKey: alphaKey.slice(0, 10),
    explicit: explicitSig.slice(0, 8),
    alphaBefore: before[alphaKey].slice(0, 8),
    alphaAfter: (after[alphaKey] ?? '(gone)').slice(0, 8),
    alphaSurvived: after[alphaKey] === explicitSig,
    redressed,
    othersMoved: Object.keys(before).filter(k => k !== alphaKey && before[k] !== after[k]).length,
    otherCount: Object.keys(before).length - 1,
  }
})
console.log(JSON.stringify(out, null, 2))
console.log(out.alphaSurvived && out.othersMoved === out.otherCount && !out.redressed.includes('alpha')
  ? 'PASS — the explicit picture survived; every default moved'
  : 'FAIL')
await ctx.close()
