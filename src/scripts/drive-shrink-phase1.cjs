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
    // A failed fetch reaches the console as a bare "Failed to load resource"
    // with no URL, so it cannot be judged from the text. The response
    // listener below tracks failures BY URL and the check at the end is what
    // rules on them — ignoring them here would be blind, so this defers
    // rather than excuses.
    if (/Failed to load resource|env\.js/i.test(text)) return
    // NG0100 from an ANGULAR component during the locale-switch check below.
    // The `t` pipe is impure, so flipping the locale from outside Angular's
    // zone (which is what page.evaluate does) changes a binding between the
    // check pass and dev-mode's verification pass. It is an artifact of the
    // Angular shell — never raised by a converted element, which owns its own
    // rendering — and it is dev-build-only. It retires with Angular itself.
    if (/NG0100|ExpressionChangedAfterItHasBeenChecked/i.test(text)) return
    errors.push(text)
  })

  // Failed requests, BY URL — the console cannot tell you which resource
  // failed, so judge them here. A SAME-ORIGIN failure means the app asked for
  // something that is not there (a module that did not build, a stylesheet a
  // conversion dropped) and is always a real defect. Cross-origin failures are
  // the content broker reaching for bytes a fresh profile has never fetched,
  // and `env.js` is the optional per-developer dev file — both environmental.
  const failedRequests = []
  page.on('response', (response) => {
    if (response.status() < 400) return
    const url = response.url()
    if (url.startsWith(URL) && !url.includes('/env.js')) failedRequests.push(`${response.status()} ${url}`)
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

  // …and wait for the SURFACES, which is a later moment than a populated
  // IoC. Modules register progressively, and on a COLD dev server (the first
  // load after a restart, when everything is still compiling) the gap is
  // seconds wide — long enough that half these checks reported "element not
  // mounted" for panels that were merely late. A gate that fails on a cold
  // start is a gate people learn to re-run, which is how a real failure gets
  // waved through. Wait for the last surface to arrive instead of racing it.
  const SURFACES = [
    'hc-sequence-viewer', 'hc-website-nav', 'hc-sensitivity-bar', 'hc-landing-badge',
    'hc-preview-banner', 'hc-toast', 'hc-confirm-dialog', 'hc-trust-prompt',
    'hc-layer-cycle-strip',
    // The viewer batch.
    'hc-icon-picker', 'hc-format-painter', 'hc-youtube-viewer', 'hc-presence-banner',
  ]
  let mounted = []
  for (let i = 0; i < 60; i++) {
    mounted = await page.evaluate(
      names => names.filter(n => !!document.querySelector(n)), SURFACES)
    if (mounted.length === SURFACES.length) break
    await sleep(1000)
  }
  check('boot: every converted surface mounted', mounted.length === SURFACES.length,
    `${mounted.length}/${SURFACES.length}` +
    (mounted.length === SURFACES.length ? '' : ` — missing ${SURFACES.filter(s => !mounted.includes(s)).join(', ')}`))

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

  // 9. THE SECOND BATCH — four more panels delivered as modules. Each is
  //    driven end to end through its OWN effect, because "the element is
  //    registered" proves nothing: a surface that mounts but never listens
  //    is exactly the regression a conversion can introduce.

  // 9a. sensitivity-bar (navigation/touch): hidden until the gesture speaks,
  //     fill height is the log-scale arithmetic, fades on release.
  const sens = await page.evaluate(async () => {
    const el = document.querySelector('hc-sensitivity-bar')
    if (!el) return { ok: false, reason: 'element not mounted by the registry' }
    const bootHidden = !el.querySelector('.sensitivity-bar')
      || getComputedStyle(el).display === 'none'
      || el.offsetHeight === 0
    // value 1.0 is the midpoint of the 0.25..4 log range → 50%
    window.__hypercombEffectBus?.emit?.('touch:sensitivity-bar', { value: 1, locked: false, visible: true })
    await new Promise(r => setTimeout(r, 150))
    const fill = el.querySelector('.fill')
    const pct = fill ? Math.round(parseFloat(fill.style.height)) : -1
    const shown = !!fill && el.offsetHeight > 0
    window.__hypercombEffectBus?.emit?.('touch:sensitivity-bar', { value: 1, locked: false, visible: false })
    await new Promise(r => setTimeout(r, 150))
    const fading = !!el.querySelector('.fading, .sensitivity-bar.fading')
      || getComputedStyle(el.querySelector('.sensitivity-bar') ?? el).opacity === '0'
    return { ok: bootHidden && shown && pct === 50 && fading, bootHidden, shown, pct, fading }
  })
  check('converted panel: sensitivity-bar hidden→shows at 50%→fades', sens.ok,
    sens.reason ?? `boot=${sens.bootHidden} shown=${sens.shown} pct=${sens.pct} fading=${sens.fading}`)

  // 9b. landing-badge (presentation/tiles): the quiet-landing release. The
  //     TAP is the only thing that frees the held repaint, so the click must
  //     emit landing:apply — a badge that shows but does not release is worse
  //     than no badge.
  const landing = await page.evaluate(async () => {
    const el = document.querySelector('hc-landing-badge')
    if (!el) return { ok: false, reason: 'element not mounted by the registry' }
    const bootHidden = el.offsetHeight === 0
    let applied = false
    const off = window.__hypercombEffectBus?.on?.('landing:apply', () => { applied = true })
    window.__hypercombEffectBus?.emit?.('landing:pending', { count: 3, where: '/dolphin' })
    await new Promise(r => setTimeout(r, 150))
    const text = (el.textContent ?? '').trim()
    const shown = el.offsetHeight > 0
    const named = text.includes('3') && text.includes('dolphin')
    el.querySelector('button')?.click()
    await new Promise(r => setTimeout(r, 100))
    window.__hypercombEffectBus?.emit?.('landing:pending', { count: 0 })
    await new Promise(r => setTimeout(r, 150))
    const hidden = el.offsetHeight === 0
    off?.()
    return { ok: bootHidden && shown && named && applied && hidden, bootHidden, shown, named, applied, hidden, text }
  })
  check('converted panel: landing-badge shows the count, releases on tap, hides at 0', landing.ok,
    landing.reason ?? `boot=${landing.bootHidden} shown=${landing.shown} named=${landing.named} applied=${landing.applied} hidden=${landing.hidden} text="${landing.text}"`)

  // 9c. preview-banner (sharing): names the preview state and carries the
  //     only two exits. Adopt must emit the real accept effect.
  const preview = await page.evaluate(async () => {
    const el = document.querySelector('hc-preview-banner')
    if (!el) return { ok: false, reason: 'element not mounted by the registry' }
    const bootHidden = el.offsetHeight === 0
    let accepted = false
    const off = window.__hypercombEffectBus?.on?.('hive:adopt-accept', () => { accepted = true })
    window.__hypercombEffectBus?.emit?.('preview:mode', {
      active: true, label: 'northern exposure', pubkey: 'abcdef0123456789', tiles: 12,
    })
    await new Promise(r => setTimeout(r, 150))
    const text = (el.textContent ?? '').trim()
    const shown = el.offsetHeight > 0
    // the publisher shorthand is the pubkey's first 8 hex chars
    const named = text.includes('northern exposure') && text.includes('abcdef01') && text.includes('12')
    el.querySelector('.adopt')?.click()
    await new Promise(r => setTimeout(r, 100))
    window.__hypercombEffectBus?.emit?.('preview:mode', { active: false })
    await new Promise(r => setTimeout(r, 150))
    const hidden = el.offsetHeight === 0
    off?.()
    return { ok: bootHidden && shown && named && accepted && hidden, bootHidden, shown, named, accepted, hidden, text }
  })
  check('converted panel: preview-banner names the preview, adopts, dismisses', preview.ok,
    preview.reason ?? `boot=${preview.bootHidden} shown=${preview.shown} named=${preview.named} accepted=${preview.accepted} hidden=${preview.hidden} text="${preview.text}"`)

  // 9d. website-nav (commands): HEADLESS — no chrome at all. Its whole job is
  //     a capture-phase Escape that always leaves website mode, even when a
  //     page's CSS hid the visible exit. Drive the real key.
  const nav = await page.evaluate(async () => {
    const el = document.querySelector('hc-website-nav')
    if (!el) return { ok: false, reason: 'element not mounted by the registry' }
    const invisible = el.offsetHeight === 0 && el.offsetWidth === 0
    const vm = window.ioc?.get?.('@hypercomb.social/ViewMode')
    if (!vm) return { ok: false, reason: 'ViewMode not registered' }
    const before = vm.mode
    vm.setMode('website')
    await new Promise(r => setTimeout(r, 100))
    const inSite = vm.mode === 'website'
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    const left = vm.mode === 'hexagons'
    if (vm.mode !== before) vm.setMode(before)
    return { ok: invisible && inSite && left, invisible, inSite, left }
  })
  check('converted panel: website-nav is headless and Escape always leaves website mode', nav.ok,
    nav.reason ?? `invisible=${nav.invisible} inSite=${nav.inSite} left=${nav.left}`)

  // 9e. Their strings ride their modules too — keys the shell catalogs no
  //     longer carry, including the PLURAL forms a count param needs.
  const batchI18n = await page.evaluate(() => {
    const svc = window.ioc?.get?.('@hypercomb.social/I18n')
    return {
      landing: svc?.t?.('landing.pending', { count: 3 }) ?? '',
      preview: svc?.t?.('preview.banner.title') ?? '',
      // must STILL resolve from the shell catalog — same prefix family,
      // different owner (hive-visit.drone's toast). The prefix-bleed guard.
      dismissed: svc?.t?.('preview.dismissed', { name: 'x' }) ?? '',
    }
  })
  check('converted panels: module-carried i18n resolves, plurals included',
    !!batchI18n.landing && batchI18n.landing !== 'landing.pending' && batchI18n.landing.includes('3')
    && !!batchI18n.preview && batchI18n.preview !== 'preview.banner.title',
    `landing="${batchI18n.landing}" preview="${batchI18n.preview}"`)
  check('converted panels: the drone’s neighbouring key survived the split',
    !!batchI18n.dismissed && batchI18n.dismissed !== 'preview.dismissed', batchI18n.dismissed)

  // 9f. THE IMPURE-PIPE REGRESSION. Angular's `t` pipe is declared
  //     `pure: false`, so every change-detection tick re-resolved every
  //     string and `/language ja` re-labelled OPEN surfaces on the spot. An
  //     element renders when it decides to — so a converted panel must treat
  //     `locale:changed` as a reason to render, or an open panel freezes in
  //     the previous language. Drive a real switch against an open badge.
  const locale = await page.evaluate(async () => {
    const svc = window.ioc?.get?.('@hypercomb.social/I18n')
    const el = document.querySelector('hc-landing-badge')
    if (!svc || !el) return { ok: false, reason: 'i18n or badge missing' }
    const original = svc.locale
    window.__hypercombEffectBus?.emit?.('landing:pending', { count: 2, where: '/dolphin' })
    await new Promise(r => setTimeout(r, 200))
    const before = (el.textContent ?? '').trim()
    svc.setLocale('ja')
    await new Promise(r => setTimeout(r, 250))
    const after = (el.textContent ?? '').trim()
    svc.setLocale(original)
    await new Promise(r => setTimeout(r, 200))
    const restored = (el.textContent ?? '').trim()
    window.__hypercombEffectBus?.emit?.('landing:pending', { count: 0 })
    await new Promise(r => setTimeout(r, 150))
    return { ok: !!before && !!after && before !== after && restored === before, before, after, restored }
  })
  check('converted panel: an OPEN panel re-labels on a locale switch', locale.ok,
    locale.reason ?? `before="${locale.before}" after="${locale.after}" restored="${locale.restored}"`)

  // 9g. THE UTILITY BAND — four more panels as modules. Two of these answer
  //     a CALLER that is awaiting them, so the check drives the whole round
  //     trip: a dialog that shows but never answers hangs its caller forever,
  //     and that failure is invisible to a "does it render" check.

  // 9g-i. toast: the transient stack, driven by its own drone's effect.
  const toast = await page.evaluate(async () => {
    const el = document.querySelector('hc-toast')
    if (!el) return { ok: false, reason: 'element not mounted by the registry' }
    const bootEmpty = el.querySelectorAll('.toast-item').length === 0
    window.__hypercombEffectBus?.emit?.('toast:show',
      { type: 'tip', title: 'Shrink', message: 'the gate speaks' })
    await new Promise(r => setTimeout(r, 250))
    const items = el.querySelectorAll('.toast-item')
    const text = (el.textContent ?? '').trim()
    const shown = items.length === 1 && text.includes('the gate speaks')
    el.querySelector('.toast-dismiss')?.click()
    await new Promise(r => setTimeout(r, 400))
    const dismissed = el.querySelectorAll('.toast-item').length === 0
    return { ok: bootEmpty && shown && dismissed, bootEmpty, shown, dismissed, text }
  })
  check('converted panel: toast shows on its effect and dismisses', toast.ok,
    toast.reason ?? `boot=${toast.bootEmpty} shown=${toast.shown} dismissed=${toast.dismissed}`)

  // 9g-ii. confirm-dialog: the WHOLE round trip. requestConfirm() awaits a
  //        'confirm:response' carrying the SAME id — an answer that never
  //        comes, or comes with a different id, hangs every caller (remove,
  //        prune, link-drop) on a promise that never settles.
  const confirmed = await page.evaluate(async () => {
    const el = document.querySelector('hc-confirm-dialog')
    if (!el) return { ok: false, reason: 'element not mounted by the registry' }
    const bootHidden = !el.querySelector('.confirm-panel')
    const bus = window.__hypercombEffectBus
    const id = 'gate-' + Date.now()
    let answer = null
    const off = bus.on('confirm:response', (res) => { if (res?.id === id) answer = res.confirmed })
    bus.emit('confirm:request', {
      id, title: 'confirm.delete-title', message: 'confirm.delete-message',
      messageParams: { name: 'the gate' }, danger: true,
    })
    await new Promise(r => setTimeout(r, 250))
    const shown = !!el.querySelector('.confirm-panel')
    const named = (el.textContent ?? '').includes('the gate')
    // the danger button is the confirm action; cancel carries .cancel
    const buttons = [...el.querySelectorAll('.confirm-btn')]
    buttons.find(b => !b.classList.contains('cancel'))?.click()
    await new Promise(r => setTimeout(r, 250))
    const closed = !el.querySelector('.confirm-panel')
    off?.()
    return { ok: bootHidden && shown && named && answer === true && closed,
             bootHidden, shown, named, answer, closed }
  })
  check('converted panel: confirm-dialog answers its caller (the round trip)', confirmed.ok,
    confirmed.reason ?? `boot=${confirmed.bootHidden} shown=${confirmed.shown} named=${confirmed.named} answer=${confirmed.answer} closed=${confirmed.closed}`)

  // 9g-iii. trust-prompt: THIS ONE GATES CODE EXECUTION. The request carries
  //         an onResult callback the trust service awaits before letting a
  //         foreign bee run. Every exit must answer exactly once.
  const trust = await page.evaluate(async () => {
    const el = document.querySelector('hc-trust-prompt')
    if (!el) return { ok: false, reason: 'element not mounted by the registry' }
    // The host is `display: contents` and the backdrop inside it is
    // position:fixed — so the HOST's offsetHeight is 0 even wide open. Ask
    // what the participant can actually see instead: the painted child.
    const painted = () => [...el.children].some(c => c.getBoundingClientRect().height > 0)
    const bootHidden = !painted()
    let decision = null
    let answers = 0
    window.__hypercombEffectBus.emit('trust:check', {
      domains: ['gate-probe.example'],
      onResult: (d) => { answers++; decision = d },
    })
    await new Promise(r => setTimeout(r, 250))
    const shown = painted()
    const named = (el.textContent ?? '').includes('gate-probe.example')
    // "allow once" — allow, but never added to the community
    const once = [...el.querySelectorAll('button')]
      .find(b => /once|time/i.test(b.textContent ?? ''))
    once?.click()
    await new Promise(r => setTimeout(r, 250))
    const hidden = !painted()
    return {
      ok: bootHidden && shown && named && answers === 1
        && decision?.allow === true && decision?.addToCommunity === false && hidden,
      bootHidden, shown, named, answers, decision, hidden,
    }
  })
  check('converted panel: trust-prompt answers the gate exactly once', trust.ok,
    trust.reason ?? `boot=${trust.bootHidden} shown=${trust.shown} named=${trust.named} answers=${trust.answers} decision=${JSON.stringify(trust.decision)} hidden=${trust.hidden}`)

  // 9g-iv. layer-cycle-strip: with no peers in the swarm there is nobody to
  //        cycle, so the honest assertion is that it mounts and stays EMPTY —
  //        the same @if-means-detach contract as the rest of the batch. (Its
  //        widget-zoom wiring lands on the inner strip when peers exist, so
  //        it cannot be seen from here; the primitive itself is covered by a
  //        unit spec in core, where it can be driven directly.)
  const strip = await page.evaluate(() => {
    const el = document.querySelector('hc-layer-cycle-strip')
    if (!el) return { ok: false, reason: 'element not mounted by the registry' }
    const empty = el.children.length === 0
    const unpainted = el.getBoundingClientRect().height === 0
    return { ok: empty && unpainted, empty, unpainted }
  })
  check('converted panel: layer-cycle-strip mounts and idles empty with no peers', strip.ok,
    strip.reason ?? `empty=${strip.empty} unpainted=${strip.unpainted}`)

  // 9g-v. icon-picker: DRIVEN, not just mounted. Borrow mode (`store: false`)
  //        writes no override, so the gate can open the real chooser against
  //        the participant's own hive without touching their data. The
  //        roundtrip proves three things a mount check cannot: the request
  //        contract still opens it, the catalog RESOLVES (an unregistered
  //        catalog renders the raw key — the confirm-dialog blocker), and
  //        Escape settles the request exactly once and detaches the panel.
  const picker = await page.evaluate(async () => {
    const bus = window.__hypercombEffectBus
    if (!bus) return { ok: false, reason: 'EffectBus not reachable from the page' }
    const el = document.querySelector('hc-icon-picker')
    if (!el) return { ok: false, reason: 'element not mounted by the registry' }

    const settled = []
    const off = bus.on('icon:pick-result', r => { settled.push(r) })
    bus.emit('icon:pick-request', { id: 'gate-probe', token: 'gate', store: false })
    await new Promise(r => setTimeout(r, 400))

    const title = el.querySelector('.ip-title')?.textContent?.trim() ?? ''
    const search = el.querySelector('.ip-search')?.getAttribute('placeholder') ?? ''
    const opened = el.children.length > 0
    const hexes = el.querySelectorAll('.ip-hex').length
    // A key that never resolved comes back as the key itself.
    const localized = title.length > 0 && !title.startsWith('icon-picker.')
      && search.length > 0 && !search.startsWith('icon-picker.')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise(r => setTimeout(r, 300))
    off?.()
    const closed = el.children.length === 0

    return {
      ok: opened && hexes > 0 && localized && closed && settled.length === 1
        && settled[0]?.name === null && settled[0]?.token === 'gate',
      opened, hexes, localized, title, search, closed, settled: settled.length,
      name: settled[0]?.name === null ? 'null' : String(settled[0]?.name),
    }
  })
  check('converted panel: icon-picker opens on the request contract, paints icons, localizes',
    picker.ok === true || (picker.opened && picker.hexes > 0 && picker.localized),
    picker.reason ?? `opened=${picker.opened} hexes=${picker.hexes} ` +
      `localized=${picker.localized} title="${picker.title}"`)
  check('converted panel: icon-picker settles its request once on Escape and detaches',
    picker.ok === true,
    picker.reason ?? `closed=${picker.closed} settled=${picker.settled} name=${picker.name}`)

  // 9g-vi. format-painter: driven through `format:state`, the one event that
  //        opens it. Entries are empty, which is a REAL render path (the
  //        panel has an empty-state string) and needs no editor session — so
  //        this asserts the extracted catalog resolves without touching a
  //        tile. Closing it again proves the @if-means-detach contract.
  const painter = await page.evaluate(async () => {
    const bus = window.__hypercombEffectBus
    if (!bus) return { ok: false, reason: 'EffectBus not reachable from the page' }
    const el = document.querySelector('hc-format-painter')
    if (!el) return { ok: false, reason: 'element not mounted by the registry' }

    bus.emit('format:state', { open: true, sourceCell: 'gate-probe', entries: [] })
    await new Promise(r => setTimeout(r, 350))
    const opened = el.children.length > 0
    const text = el.textContent ?? ''
    const localized = text.length > 0 && !text.includes('format-painter.')

    bus.emit('format:state', { open: false, sourceCell: null, entries: [] })
    await new Promise(r => setTimeout(r, 300))
    const closed = el.children.length === 0

    return { ok: opened && localized && closed, opened, localized, closed,
      text: text.slice(0, 60) }
  })
  check('converted panel: format-painter opens on format:state, localizes, detaches on close',
    painter.ok,
    painter.reason ?? `opened=${painter.opened} localized=${painter.localized} ` +
      `closed=${painter.closed} text="${painter.text}"`)

  // 9g-vii. youtube-viewer and presence-banner both need state the gate has
  //         no honest way to manufacture — a video link opened on a tile, and
  //         a swarm with actual peers. Asserting they idle EMPTY is the real
  //         contract at rest (@if-means-detach), and their catalogs are
  //         covered by drift specs. Driving them would mean faking a peer
  //         list, which tests the fake.
  const idle = await page.evaluate(() => ['hc-youtube-viewer', 'hc-presence-banner']
    .map(name => {
      const el = document.querySelector(name)
      return { name, mounted: !!el, empty: el ? el.children.length === 0 : false }
    }))
  for (const s of idle) {
    check(`converted panel: ${s.name} mounts and idles empty`, s.mounted && s.empty,
      `mounted=${s.mounted} empty=${s.empty}`)
  }

  // 10. No non-environmental console errors, and nothing the APP asked for
  //     came back missing.
  check('console: no errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  check('network: no same-origin resource failed', failedRequests.length === 0,
    [...new Set(failedRequests)].slice(0, 3).join(' | '))

  await browser.close()
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
