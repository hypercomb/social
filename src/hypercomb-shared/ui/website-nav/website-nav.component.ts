// hypercomb-shared/ui/website-nav/website-nav.component.ts
//
// The lone chrome of website mode + the bridge back to it.
//
// In website mode the whole top bar (command line included) is hidden — a
// site should read like a site, not an app. That leaves the participant with
// no obvious way out and, worse, no way out at all if a link strands them on
// a page-less cell (a "nowhere spot"). This component is the answer: a single
// prominent bottom-right FAB that drops straight back to the hexagon tile
// view from ANYWHERE in a site, no matter how lost you got. Because that FAB
// is now the ONLY exit (the command line that hosted `/website` is gone), it
// is built to never silently fail:
//
//   • ViewMode is bound via whenReady, so a late registration (the web shell
//     loads it through the runtime path) can't leave the FAB dead.
//   • Escape always exits website mode — an independent path that works even
//     if the FAB didn't render or a page's CSS hid it.
//   • The FAB's critical layout props are !important so an embedded page's
//     own stylesheet can't hide or displace it.
//
// The mirror case: someone who arrived INDIRECTLY — landed straight on a site
// (ViewMode persisted as 'website' at boot) — and then taps back to the hive.
// They never chose hexagons; they shouldn't be stuck there wondering where the
// site went. So for indirect entries we keep a persistent "return to the site"
// FAB and, the first time the hive surfaces, fly a few small bees in with a
// short message + arrow pointing right at it. One-time, elegant, dismissible.
//
// Shell UI: it NEVER imports essentials. ViewMode + Navigation are resolved
// at call time through window.ioc. No new state library — EventTarget +
// signals, like the rest of the shell.

import { Component, OnDestroy, computed, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'

/** Runtime service locator — shared must never statically import essentials,
 *  so cross-service resolution goes through window.ioc at call time. */
const get = (key: string): any => (globalThis as { ioc?: { get(k: string): unknown } }).ioc?.get(key)

type ViewModeLike = EventTarget & { mode: string; setMode(next: string): void }
/** Navigation surface — raw segments to remember where the site was, `go` to
 *  drop back onto that exact page when returning. */
type NavigationLike = {
  segmentsRaw?: () => readonly string[]
  go?: (segments: readonly string[]) => void
}
type IocLike = {
  get?: (k: string) => unknown
  whenReady?: (k: string, cb: (v: unknown) => void) => void
}

const HIVE = 'hexagons'
const SITE = 'website'
const VIEW_MODE_KEY = '@hypercomb.social/ViewMode'
/** How long the one-time "return to the site" cue lingers before the bees
 *  fly off. The persistent FAB stays; only the animated hint auto-clears. */
const CUE_MS = 7000

@Component({
  selector: 'hc-website-nav',
  standalone: true,
  imports: [],
  templateUrl: './website-nav.component.html',
  styleUrls: ['./website-nav.component.scss'],
})
export class WebsiteNavComponent implements OnDestroy {
  #vm: ViewModeLike | undefined

  /** Live ViewMode — the template reacts to this. Set in #bind (which may run
   *  later than construction if ViewMode registers late). */
  readonly mode = signal<string>(HIVE)

  /** Website mode is the active surface → show the exit FAB. */
  readonly inWebsite = computed(() => this.mode() === SITE)

  /** The current site's toggle identity, mirrored from the SAME source the
   *  command-line website toggle uses (ViewBee's `view-toggles:changed`), so
   *  the exit FAB wears the site's own icon + label. Empty on a page-less cell
   *  (a dead-end), where no toggle is emitted — the template falls back to the
   *  generic website glyph there so the way out is never iconless. */
  readonly siteIcon = signal<string>('')
  readonly siteLabel = signal<string>('')
  #togglesUnsub: (() => void) | null = null

  /** Did this SESSION begin on a site? Captured from the first reliable
   *  ViewMode read (construction OR the whenReady bind, whichever lands
   *  first) — an indirect entry already reports 'website' there. */
  #startedInWebsite = false
  #startedCaptured = false

  /** The page to drop back onto when returning to the site — the lineage path
   *  captured the moment we left website mode (seeded with the boot path for
   *  an indirect entry). */
  #returnPath: string[] = []

  /** Persistent "return to the site" affordance — indirect entries, in hive. */
  readonly canReturn = computed(() => !this.inWebsite() && this.#startedInWebsite)

  /** One-time animated cue (bees + message + arrow). */
  readonly showCue = signal(false)
  #cueShown = false
  #cueTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    // Bind ViewMode through whenReady. ViewMode can register AFTER this
    // component constructs — the web shell loads it on the runtime path, which
    // is exactly why app.ts itself uses whenReady. A one-shot get() that
    // missed would leave #vm undefined forever and the exit FAB — the ONLY way
    // out of website mode now the command line is gone — would never appear.
    const ioc = (globalThis as { ioc?: IocLike }).ioc
    const existing = ioc?.get?.(VIEW_MODE_KEY) as ViewModeLike | undefined
    if (existing) this.#bind(existing)
    else ioc?.whenReady?.(VIEW_MODE_KEY, (v) => this.#bind(v as ViewModeLike))

    // Independent safety net: Escape always leaves website mode, even if the
    // FAB failed to render or a page's CSS hid it. Capture phase so a page
    // script can't swallow it first.
    window.addEventListener('keydown', this.#onKeyDown, true)

    // Mirror the command-line website toggle's identity onto the exit FAB: the
    // SAME ViewBee broadcast the command line renders. Late-subscriber replay
    // means we get the current toggle immediately, and it tracks per-cell as
    // you navigate the site.
    this.#togglesUnsub = EffectBus.on<{ toggles?: { view: string; icon: string; label: string }[] }>(
      'view-toggles:changed',
      (p) => {
        const web = Array.isArray(p?.toggles) ? p!.toggles.find(t => t?.view === SITE) : undefined
        this.siteIcon.set(web?.icon ?? '')
        this.siteLabel.set(web?.label ?? '')
      },
    )
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.#onKeyDown, true)
    this.#vm?.removeEventListener('change', this.#onModeChange)
    this.#togglesUnsub?.()
    if (this.#cueTimer) clearTimeout(this.#cueTimer)
  }

  #bind(vm: ViewModeLike): void {
    this.#vm = vm
    this.#captureStarted(vm.mode ?? HIVE)
    this.mode.set(vm.mode ?? HIVE)
    vm.addEventListener('change', this.#onModeChange)
  }

  /** First reliable mode read defines whether the session began on a site. */
  #captureStarted(m: string): void {
    if (this.#startedCaptured) return
    this.#startedCaptured = true
    this.#startedInWebsite = m === SITE
    if (this.#startedInWebsite) this.#returnPath = this.#currentSegments()
  }

  // ── mode transitions ─────────────────────────────────────

  readonly #onModeChange = (): void => {
    // Mirror fromRuntime's change-detection-friendly scheduling (microtask).
    queueMicrotask(() => {
      const now = this.#vm?.mode ?? HIVE
      this.mode.set(now)
      if (now === SITE) { this.#dismissCue(); return }
      // Just left the site. Lineage hasn't moved (only the surface flipped),
      // so the current segments still point at the page we were reading —
      // remember it. Then, for an indirect entry, surface the cue once.
      this.#returnPath = this.#currentSegments()
      if (this.#startedInWebsite && !this.#cueShown) this.#fireCue()
    })
  }

  readonly #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    const vm = this.#viewMode()
    if (!vm || vm.mode !== SITE) return
    e.preventDefault()
    vm.setMode(HIVE)
  }

  #currentSegments(): string[] {
    const nav = get('@hypercomb.social/Navigation') as NavigationLike | undefined
    return [...(nav?.segmentsRaw?.() ?? [])].map(String)
  }

  // ── actions ──────────────────────────────────────────────

  /** Resolve ViewMode freshly at call time. The bound #vm is the fast path,
   *  but if binding ever failed (load order) we still get the service here, so
   *  the exit can never be a dead button. */
  #viewMode(): ViewModeLike | undefined {
    return this.#vm ?? (get('@hypercomb.social/ViewMode') as ViewModeLike | undefined)
  }

  /** The escape hatch: back to the hexagon tile view from anywhere in a site,
   *  including a stranded blank page. setMode fires 'change' → #onModeChange
   *  remembers the return path and (for indirect entries) lights the cue. */
  backToHive(): void {
    this.#viewMode()?.setMode(HIVE)
  }

  /** Drop back onto the site exactly where we left it. Navigate first so the
   *  renderer mounts the right page the instant the surface flips. */
  returnToSite(): void {
    this.#dismissCue()
    if (this.#returnPath.length) {
      const nav = get('@hypercomb.social/Navigation') as NavigationLike | undefined
      nav?.go?.(this.#returnPath)
    }
    this.#viewMode()?.setMode(SITE)
  }

  /** Tap anywhere on the hint to dismiss it early. */
  dismissCue(): void {
    this.#dismissCue()
  }

  // ── cue lifecycle ────────────────────────────────────────

  #fireCue(): void {
    this.#cueShown = true
    this.showCue.set(true)
    this.#cueTimer = setTimeout(() => this.#dismissCue(), CUE_MS)
  }

  #dismissCue(): void {
    if (this.#cueTimer) { clearTimeout(this.#cueTimer); this.#cueTimer = null }
    this.showCue.set(false)
  }
}
