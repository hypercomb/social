#!/usr/bin/env node
// drive-shrink-phase1 — live proof of the everything-is-a-beehavior Phase 1
// migrations (documentation/everything-is-a-beehavior.md).
//
//   node scripts/drive-shrink-phase1.cjs [--url http://localhost:4350]
//
// Every store/registry moved from hypercomb-shared into essentials must:
//   1. REGISTER under its unchanged IoC key (module-scope + ensure re-assert);
//   2. ANNOUNCE on EffectBus with last-value replay (the value-announce
//      contract), so chrome that mounts before the module loads still fills;
//   3. keep its behaviour: the loopback dev-secret seed (now inside
//      SecretStore), the tag registry's self-warm, the note-marks seed
//      landing through the Store pool from module land.
//
// HEADLESS-SAFE: probes ride window.ioc and __hypercombEffectBus only — the
// Pixi drone's no-GPU shader throws are filtered from the console check.
// Fresh browser profile → its own OPFS/localStorage; never the working hive.

const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const URL = arg('url', 'http://localhost:4350')

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** The keys Phase 1 moved out of the shell so far — each must still answer. */
const MOVED_KEYS = [
  '@hypercomb.social/IconOverrides',
  '@hypercomb.social/RoomStore',
  '@hypercomb.social/SecretStore',
  '@hypercomb.social/SecretStrengthProvider',
  '@hypercomb.social/SavedLocationsStore',
  '@hypercomb.social/NoteMarks',
  '@hypercomb.social/RecentPortalsStore',
  '@hypercomb.social/TagRegistry',
  '@hypercomb.social/NameRegistry',
  '@hypercomb.social/BouquetRegistry',
  '@hypercomb.social/GroupLauncher',
  '@hypercomb.social/AggregationLayer',
  '@hypercomb.social/IconProviderRegistry',  // now a CORE primitive
  '@hypercomb.social/CompletionUtility',     // now a CORE utility
  '@hypercomb.social/ViewMode',
  '@hypercomb.social/Theme',
  '@hypercomb.social/TrustService',
  '@hypercomb.social/ResourceCompletionService',
  '@hypercomb.social/MovementService',
  '@hypercomb.social/VoiceInputService',
  '@hypercomb.social/CellSuggestionProvider',
  '@hypercomb.social/IconEditMode',       // now a CORE mode
  '@hypercomb.social/UsageTracker',
  '@hypercomb.social/Navigation',   // now a CORE primitive
  '@hypercomb.social/Lineage',      // now a CORE primitive
  '@hypercomb.social/I18n',         // now a CORE primitive
]

/** Value-announce effects that must sit in last-value replay after boot. */
const ANNOUNCED = [
  'mesh:room-changed',
  'mesh:secret-changed',
  'mesh:saved-locations-changed',
  'portals:recent-changed',
  'tags:registry',        // the self-warm's announce
  'notes:marks-changed',  // lands after the Store pool read settles
  'groups:changed',       // the built-in groups registering
  'movement:changed',     // the navigation-commit counter
]

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = []
  page.on('console', msg => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    // Headless has no GPU: the Pixi shader/context throws are environmental.
    if (/WebGL|shader|pixi|GPU|framebuffer/i.test(text)) return
    // Pixi's shader-error logger (logProgramError) console.errors an EMPTY
    // string headless — un-filterable by text, same environmental class.
    if (!text.trim()) return
    // hypercomb-dev's index.html loads an OPTIONAL local env.js; a checkout
    // without one 404s (and Chrome adds a MIME refusal) — pre-existing noise.
    if (/env\.js|404 \(Not Found\)/i.test(text)) return
    errors.push(text)
  })

  await page.goto(URL, { waitUntil: 'domcontentloaded' })

  // Boot: wait for the IoC to fill (drones self-register as bundles load).
  let iocKeys = []
  for (let i = 0; i < 60; i++) {
    iocKeys = await page.evaluate(() => window.ioc?.list?.() ?? [])
    if (iocKeys.length > 30) break
    await sleep(1000)
  }
  check('boot: ioc populated', iocKeys.length > 30, `${iocKeys.length} keys`)

  // 1. Every moved key answers.
  for (const key of MOVED_KEYS) {
    const present = await page.evaluate(k => !!window.ioc?.get?.(k), key)
    check(`ioc: ${key}`, present)
  }

  // 2. Value-announce replay — poll: notes:marks-changed needs the async pool
  //    read; tags:registry needs the self-warm's Store round trip.
  let last = {}
  for (let i = 0; i < 30; i++) {
    last = await page.evaluate(names => {
      const lv = window.__hypercombEffectBus?.lastValue
      const out = {}
      for (const n of names) out[n] = lv?.has?.(n) ? lv.get(n) : undefined
      return out
    }, ANNOUNCED)
    if (ANNOUNCED.every(n => last[n] !== undefined)) break
    await sleep(1000)
  }
  for (const n of ANNOUNCED) {
    check(`announce: ${n}`, last[n] !== undefined, JSON.stringify(last[n])?.slice(0, 60))
  }

  // 3. The loopback dev-secret seed moved INTO SecretStore — a fresh profile
  //    on localhost must land 'downtown' with no boot-path involvement.
  const secret = await page.evaluate(() =>
    window.ioc?.get?.('@hypercomb.social/SecretStore')?.value)
  check('secret-store: loopback seed rode the move', secret === 'downtown', String(secret))

  // 4. The note-marks seed lands from module land through the Store pool.
  const marks = last['notes:marks-changed']?.marks
  check('note-marks: palette seeded via pool', Array.isArray(marks) && marks.length >= 1,
    `${marks?.length ?? 0} marks`)

  // 5. Round trip through a moved store: a reskin lands in replay and clears.
  const trip = await page.evaluate(() => {
    const ov = window.ioc?.get?.('@hypercomb.social/IconOverrides')
    if (!ov) return { ok: false, reason: 'no store' }
    ov.set('control:shrink-probe', 'star')
    const lv = window.__hypercombEffectBus?.lastValue?.get?.('icon:override-changed')
    const landed = lv?.id === 'control:shrink-probe' && lv?.glyph === 'star'
    ov.clear('control:shrink-probe')
    return { ok: landed && !ov.has('control:shrink-probe') }
  })
  check('icon-overrides: set → announce → clear', trip.ok, trip.reason)

  // 6. Strength provider evaluates (moved default implementation).
  const strength = await page.evaluate(() =>
    window.ioc?.get?.('@hypercomb.social/SecretStrengthProvider')?.evaluate?.('correct-horse-battery') ?? -1)
  check('secret-strength: default provider evaluates', strength > 0 && strength <= 1, String(strength))

  // 7. THE FIRST CONVERTED PANEL: the Sequences surface is a custom element
  //    from the sequence module now — registered in the shell-surface
  //    registry, opened by its effect, docking with a width and a scale.
  const panel = await page.evaluate(async () => {
    const el = document.querySelector('hc-sequence-viewer')
    if (!el) return { ok: false, reason: 'element not mounted by the registry' }
    window.__hypercombEffectBus?.emit?.('sequence:view-open', {})
    await new Promise(r => setTimeout(r, 300))
    const open = el.classList.contains('open')
    const width = el.offsetWidth
    const scale = el.style.getPropertyValue('--hc-panel-scale')
    window.__hypercombEffectBus?.emit?.('sequence:view-close', {})
    await new Promise(r => setTimeout(r, 100))
    const closed = !el.classList.contains('open')
    return { ok: open && width >= 280 && !!scale && closed, open, width, scale, closed }
  })
  check('converted panel: sequence-viewer opens, docks, scales, closes', panel.ok,
    panel.reason ?? `open=${panel.open} width=${panel.width} scale=${panel.scale} closed=${panel.closed}`)

  // 8. Its strings ride the module — a key the shell catalogs no longer
  //    carry must still resolve through registerTranslations.
  const i18n = await page.evaluate(() => {
    const svc = window.ioc?.get?.('@hypercomb.social/I18n')
    return svc?.t?.('sequences.title') ?? ''
  })
  check('converted panel: module-carried i18n resolves', !!i18n && i18n !== 'sequences.title', i18n)

  // 9. No non-environmental console errors.
  check('console: no errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  await browser.close()
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
