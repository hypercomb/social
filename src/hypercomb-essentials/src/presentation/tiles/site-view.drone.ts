// presentation/tiles/site-view.drone.ts
//
// Full-viewport site takeover. Each cell carries its own page in its
// `context` slot — when website mode is active, the current cell's
// HTML resource is fetched, rewritten, and mounted inline. Navigation
// moves between cells; each cell's page replaces the previous one.
//
// The legacy `websiteSig` bundle path (concatenated sigs + manifest
// `pages[path]` lookup) was removed: child paths required explicit
// manifest entries to render, so navigations followed a link into a
// blank page whenever the bundle hadn't enumerated that path. The
// per-cell model uses lineage-as-routing — a link to `./team`
// navigates the lineage one level down, and that cell's `context`
// page mounts. No bundle, no manifest, no path-table.

import {
  Drone, EffectBus, SITE_VIEW_IOC_KEY, RESOURCE_URL_PREFIX, I18N_IOC_KEY, THEME_IOC_KEY,
  type I18nProvider,
} from '@hypercomb/core'
import { rewritePageRefs } from '../../sharing/decoration-closure.js'
import { WEBSITE_SLOT } from '../../commands/website-slot.js'
import { composeDivision, hydrateSeatedParts } from './division-render.js'
import { mayRunPage, pagePublisherDomain } from './page-run-gate.js'
import { SiteTextEditor, authoredOrder, replaceTextInPage, type TextSlot } from './site-text-edit.js'
import { commitPageSig } from '../../files/page-commit.js'
import { isForeignContent, isLocallyAuthored } from '../../sharing/feature-availability.js'
import { markAuthored } from '../../sharing/authored-sigs.js'
import { dropContribution, pickDeps, readContributions, readPick, signPick, type PageContribution } from '../../sharing/page-contributions.js'
import { publisherKeyHex } from '../../sharing/key-list.client.js'
import { isPublishNode } from '../../sharing/zone-door.js'
import { SiteVersions, mergeContributions } from './site-versions.js'
import { hostsOfBranch, listCommunityHosts, listZoneBindings } from '../../sharing/community-hosts.js'
import { hostOfferDeps } from '../../sharing/host-offer.js'
import { zoneDoor } from '../../sharing/zone-door.js'
import { isPublishedVisitorShell } from '../../sharing/behavior-enablement.js'
import { isFeatureHiddenWithin } from '../../sharing/feature-hidden.js'
import { openExternalLink } from './document-view-links.js'
import { scopeCellPageCss } from './cell-page-css-scope.js'
import { hoistPageStylesheets, stylesheetsSettled } from './cell-page-stylesheets.js'
import { HEXAGONS_SURFACE, sameSiteSegments, siteFlipTarget, siteFloorFor, type SiteSpawn } from './site-return.js'
import { VIEW_SPAWN_EFFECT, spawnForView } from './view-spawn.js'
import { SiteTrail } from './site-trail.js'
import { closeSiteContextMenu, isOnSiteContextMenu, openSiteContextMenu, type SiteMenuItem } from './site-context-menu.js'
import { browserKeepsMenu, isLongPressMenu } from '../../navigation/browser-menu.js'
import type { BackGesture } from '../../navigation/back-gesture.service.js'
import { myHiveOrigin, visitorDoorHref } from '../../sharing/visitor-door.view.js'
import { listTrialVersions, pageHome, releaseTrial, stageTrial, trialBase, trialOf, trialOrigin, trialVersionLabel } from '../../files/try-page.js'
import { PIXI3D_LENDER_KEY, Pixi3DLender } from './pixi3d-lender.js'

type MountState = {
  host: HTMLDivElement
  /** sig of the cell page currently mounted. */
  pageSig: string
  /** The contribution shown in its place for this reader (site-versions.ts), or null for the page itself. */
  shownSig: string | null
  /** lineage segments of the cell whose page is mounted. */
  sitePath: readonly string[]
  /** unmount handler — drops style/link/script nodes and listeners. */
  unmount: () => void
}

/** The inline background longhands the hive's own backdrop occupies —
 *  CanvasBackgroundService paints `<body>` with a colour, a gradient image and
 *  its size/repeat/position, pinned with `attachment: fixed`. Snapshot/restore
 *  works longhand-by-longhand rather than through the `background` shorthand:
 *  the shorthand getter re-serialises a multi-value backdrop to "", so
 *  round-tripping it would silently drop size/repeat/position/attachment and
 *  leave the gradient re-tiled at its default. */
const BG_PROPS = [
  'backgroundColor', 'backgroundImage', 'backgroundRepeat',
  'backgroundSize', 'backgroundPosition', 'backgroundAttachment',
] as const

const snapshotBackground = (s: CSSStyleDeclaration): string[] => BG_PROPS.map(p => s[p])

/** Clear whatever the page stamped (the shorthand resets every longhand,
 *  including ones the hive never sets), then put the snapshot back. */
const restoreBackground = (s: CSSStyleDeclaration, snap: readonly string[]): void => {
  s.background = ''
  BG_PROPS.forEach((p, i) => { s[p] = snap[i] })
}

/** Inline style for the raw-DOM exit overlay — the STANDARD site chrome every
 *  embedded page wears, identical from page to page (pages are independent
 *  documents with no shared template, so the one constant is this button).
 *
 *  It is the ONLY corner control in website mode: the shell's own bottom-right
 *  clusters (command line, document actions, controls bar) all step aside on
 *  `view:active`, and the duplicate shell-side chip that used to stack on top
 *  of this one is gone. Design rules that keep it out of the way:
 *   - small (2.25rem) and tight into the corner, honouring the safe-area inset
 *     so it never lands under a phone's home indicator;
 *   - cold steel, not a coloured blob — it reads as chrome, not as page content;
 *   - dimmed at rest (opacity .38) and full on hover/focus, so it recedes while
 *     reading and is still unmistakably there when looked for;
 *   - near-max z-index so a site's own fixed header/footer can never bury it.
 *  Inline-only, so a site's CSS can't reach or restyle it. */
const EXIT_OVERLAY_CSS = [
  'position:fixed', 'z-index:2147483600',
  'right:calc(0.75rem + env(safe-area-inset-right, 0px))',
  'bottom:calc(0.75rem + env(safe-area-inset-bottom, 0px))',
  'width:2.25rem', 'height:2.25rem', 'display:flex', 'align-items:center', 'justify-content:center',
  'border-radius:50%',
  'background:rgba(12,17,24,.82)', 'border:1px solid rgba(126,182,214,.42)',
  '-webkit-backdrop-filter:blur(6px)', 'backdrop-filter:blur(6px)',
  'box-shadow:0 2px 10px rgba(0,0,0,.45)', 'color:#cfe2ee', 'cursor:pointer',
  "font-family:'Material Symbols Outlined'", 'font-size:1.15rem', 'line-height:1', 'padding:0',
  'pointer-events:auto', 'opacity:.38', 'transition:opacity .16s ease,background .16s ease',
].join(';')

/** THE CHROME CORNER — the standard every embedded page leaves room for. The
 *  exit button is the one piece of hive chrome in website mode and it always
 *  sits in the page's bottom-right corner; this is the square it holds there
 *  (its 0.75rem offset + 2.25rem body + 0.5rem of breath). The host publishes
 *  it as `--hc-site-chrome-bottom` / `--hc-site-chrome-right`, so a page keeps
 *  its own FIXED bottom-right furniture clear of the button
 *  (`bottom: calc(1rem + var(--hc-site-chrome-bottom, 0px))`), and reserves it
 *  after the page's last child, so the end of every page's scroll — a footer's
 *  right-hand link, typically — lifts out from under it whether or not the page
 *  knows the standard. Outside the hive the vars are unset and resolve to 0.
 *  Doctrine: `documentation/embedded-sites.md` → *The chrome corner*. */
const CHROME_CORNER_BOTTOM = 'calc(3.5rem + env(safe-area-inset-bottom, 0px))'
const CHROME_CORNER_RIGHT = 'calc(3.5rem + env(safe-area-inset-right, 0px))'

/** THE EXIT IS THE AUTHOR'S CALL ON A PUBLISHED SITE. Inside a hive the exit
 *  hexagon is the way back to the participant's own tiles. On a published
 *  door there is nothing behind the page to go back to: a business card that
 *  shows a "close website" button reads as broken. So the visitor shell
 *  offers the exit (button, Escape, the chrome-corner reservation) only when
 *  the page says so itself, in its own signed bytes:
 *    <meta name="hypercomb:exit" content="show">
 *  Absent that, a published page stands alone. */
const pageAsksForExit = (page: Document): boolean =>
  (page.querySelector('meta[name="hypercomb:exit"]')?.getAttribute('content') ?? '').trim().toLowerCase() === 'show'

/** Raw-DOM review-gate card. Out-of-Angular, opaque full-viewport backdrop:
 *  shown over a FOREIGN, unverified page INSTEAD of mounting it, so nothing of
 *  the page renders, runs, or fetches until the participant reviews and enables
 *  it. Cold steel chrome, no external CSS.
 *
 *  Z-INDEX (100001) is deliberately BELOW the shell's right-docked features /
 *  review panel (z 100002) — the "Review & enable" button hands off to that
 *  Angular panel (`feature:review:open`), which must be visible and clickable
 *  ON TOP of this backdrop; a near-max z-index would occlude it and the button
 *  would appear to do nothing. The security block is enforced by #reconcile NOT
 *  calling #mountCellPage until the sig is verified — never by this overlay's
 *  stacking — so sitting below the panel weakens nothing (the page is torn down
 *  while the gate is up, so there is no page content to sit above). The exit
 *  overlay keeps its near-max z-index so the guaranteed way out stays on top. */
const REVIEW_GATE_CSS = [
  'position:fixed', 'inset:0', 'z-index:100001',
  'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center', 'gap:1rem',
  'background:#0c1118', 'color:#cfe2ee', 'padding:2rem', 'text-align:center',
  "font-family:system-ui,-apple-system,'Segoe UI',sans-serif",
].join(';')

export class SiteViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Full-viewport site takeover. Mounts each cell\'s `context` HTML resource as the active page; lineage navigation drives page changes.'

  #mount: MountState | null = null
  /** Re-entrancy generation — bumped at the top of every #reconcile; a reconcile
   *  bails after any await once a newer one has started (see #reconcile), so the
   *  latest reconcile always wins. */
  #gen = 0
  #viewActive = false
  #registered = false
  #lineageBound = false
  #viewModeBound = false
  #arrivalBound = false
  #globalContextMenuBound = false
  /** Unregisters this view's way out from the back gesture. */
  #backOff: (() => void) | null = null
  /**
   * Lineage of the cell where the current website session started —
   * captured the moment ViewMode flipped from hexagons → website (or
   * on boot if VM was already 'website'). Acts as the navigation
   * floor: the menu's Up one level (and anchor `..`) inside the site
   * can walk up freely until segments shrink down to this length, and
   * never crosses into the parent hexagon hierarchy. Null while not in
   * a website session.
   */
  #siteEntrySegments: readonly string[] | null = null
  /** The published creation's root on a visitor door (`preview:mode`), the
   *  floor of any site session that opens inside it — a cold deep link
   *  arrives on a page, not at the root. */
  #publishedRoot: readonly string[] | null = null
  /** The published creation as `preview:mode` names it — who published it,
   *  where, and its route — so the menu can offer the visitor door. */
  #publishedCreation: { pubkey?: string; hosts?: readonly string[]; segments?: readonly string[] } | null = null
  #publishedRootBound = false

  /**
   * THE VIEW AND THE PAGE THAT SPAWNED THIS SITE — the one destination
   * leaving it has (the rule lives in `site-return.ts`). Captured the moment
   * ViewMode flips into 'website': the surface that was up
   * (`ViewMode.previous`) and where the explorer stood. When the flip turns
   * out to have been an ARRIVAL — the reader walked into a cell whose
   * `view:default` mark opened the site — the place is corrected to the page
   * they came FROM, because the site's own cell is not somewhere they chose
   * to be. Null outside a session, and for an INDIRECT one (booted straight
   * into website mode) that never had a spawn to remember.
   */
  #spawn: SiteSpawn | null = null
  /** WHERE THE ICON THAT STEPPED INTO THIS SITE WAS CLICKED FROM (jwize
   *  2026-11-08: "always where you entered from"). The icon dispatcher walks
   *  the explorer to the site ROOT before the surface flips, so by the time
   *  `#captureSiteEntry` reads the lineage the reader already stands on the
   *  root — a spawn read there sent everyone who entered from a node deeper
   *  in the tree back to the root. The dispatcher announces the real place
   *  on `view:spawn` BEFORE it walks; this holds it until the flip. */
  #steppedInFrom: SiteSpawn | null = null
  /** The spawn came from a step-in record, not from reading the lineage at
   *  the flip: an arrival verdict must not rewrite it. */
  #spawnPinned = false
  /** Explorer path before the most recent move, and the current one. The
   *  pair is what lets an arrival-opened site name the page that spawned it;
   *  only a real change shifts them, so the several 'change' events one
   *  navigation fires cannot eat the previous page. */
  #prevSegments: readonly string[] = []
  #lastSegments: readonly string[] = []
  /** Re-entrancy guard: leaving sets ViewMode a second time (hexagons → the
   *  spawning view) from inside the mode-change handler. */
  #restoringSpawn = false
  /** THE PAGES WALKED THROUGH THIS SESSION (site-trail.ts; jwize 2026-11-03:
   *  "if you are deep inside a website the back navigates back until the entry
   *  point"). The site's own moves remember the page left; the back gesture
   *  walks them in reverse and, on the page the site was entered on, steps out
   *  to the layer hosting it. Empty on the entry page. */
  readonly #trail = new SiteTrail()
  /** Where the reader was on each page of the trail when they left it (the
   *  host's scroll), restored when the back gesture returns to it — back
   *  only (jwize 2026-11-04: "keep the position on the page when you navigate
   *  back (only)"); a page reached forward starts at its top. */
  #trailScroll: number[] = []
  /** Set while the back gesture steps along the trail, so that move is not
   *  pushed again. */
  #trailStep = false
  /** The scroll to restore on the page the back gesture is returning to, or
   *  null. While set, the mounted host carries `data-hc-returning`, so the
   *  page's own script can resume where it was (its step, its playback). */
  #returningScroll: number | null = null
  /** Inline text editing (site-text-edit.ts): the mode outlives a mount, since
   *  every save remounts the page; the editor is the mounted page's own. */
  #textEditing = false
  #textEditor: SiteTextEditor | null = null
  /** The versions of the mounted page (site-versions.ts): which contribution
   *  this reader chose to see in a page's place, by the page's sig — local,
   *  never published — and each page's read of its pools, once per session. */
  #versions: SiteVersions | null = null
  /** null = this reader chose the published page itself (over any pick). */
  readonly #shownVersions = new Map<string, PageContribution | null>()
  readonly #versionReads = new Map<string, Promise<PageContribution[]>>()
  /** The publisher's pick for each page — what everyone is shown — read once a
   *  session per page (page-contributions.ts readPick); null = none. */
  readonly #picks = new Map<string, PageContribution | null>()
  readonly #pickReads = new Map<string, Promise<PageContribution | null>>()
  /** Set for the one exit the back gesture makes at the site's entry when the
   *  reader opened a page STANDING ON ITS OWN TILE'S LAYER: back steps OUT to
   *  the layer hosting that tile (jwize 2026-11-04: "when you click back on a
   *  webpage you just entered … you go to the parent of the page you
   *  entered"). Null for every other entry — the exit goes to the spawn. */
  #backOutTo: string[] | null = null
  /** The cell `#reconcile` last found CONFIRMED page-less (its three page
   *  slots empty) while the site was up, as a path key — null when the last
   *  reconcile mounted a page or never ran. Read synchronously by `#back`:
   *  a node the surface merely came up on is not a page the reader entered. */
  #pagelessAt: string | null = null
  /** The tile whose page the reader opened, kept when the session widens to
   *  the whole website (#widen): back out of the website still steps out to
   *  the layer hosting the page they first opened. */
  #enteredAt: string[] | null = null
  /** Widen the session to the whole website as soon as its page is mounted
   *  (an arrival under a website pinned above). */
  #widenOnMount = false
  /** The reader has moved inside this site session. From then on an arrival
   *  verdict for the entry page is back walking onto it, not the arrival that
   *  opened the site, and must not move the way out (#89). */
  #movedInSite = false

  /**
   * Raw-DOM exit overlay — the GUARANTEED way out of website mode. It is
   * created outside Angular by the renderer itself (the one piece of code that
   * is provably running whenever a site is on screen), appended straight to
   * <body> at a near-max z-index, and shown for the entire duration of website
   * mode — even on a page-less dead-end. No component, no signal binding, no
   * load-order failure mode: if a site can show, this button is there. Clicking
   * it backs the reader OUT to the SPAWN — the page they were on, in the view
   * they were looking at, when the site opened (`#spawn`). It never opens the
   * websites directory on the way out: `/websites` is the one way to show
   * that window, so leaving a site returns you to where you came in rather
   * than into a menu.
   */
  #exitOverlay: HTMLButtonElement | null = null
  /** Pointer is over the exit / Ctrl-or-⌘ is held while it is — the button
   *  then wears the hexagon, naming the peel its click will do. */
  #exitOver = false
  #exitPeek = false
  /** Set for the one synchronous ViewMode flip of a Ctrl/⌘-click: leave the
   *  site for THIS page's hexagons instead of returning to the spawn. */
  #peelHere = false
  #exitTogglesBound = false
  /** Raw-DOM review gate — shown over a FOREIGN, unverified page in place of
   *  mounting it. While present, the page is NOT in the document: no scripts
   *  run, no resources stream. Cleared once the feature is verified (or on
   *  exit / a switch to a local page). */
  #reviewOverlay: HTMLDivElement | null = null
  /** A model-written page, shown as a door to its sandbox instead of mounted. */
  #trialOverlay: HTMLDivElement | null = null
  #featureVerifiedBound = false
  /** The current site's toggle identity, mirrored from ViewBee's
   *  `view-toggles:changed` so the exit wears the site's own glyph + label;
   *  falls back to a generic "back to tiles" glyph on a cell with no page. */
  #siteIcon = ''
  #siteLabel = ''

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    store: '@hypercomb.social/Store',
  }
  protected override listens: string[] = []
  protected override emits = ['view:active']

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register(SITE_VIEW_IOC_KEY, this)
      this.#registered = true
    }
    if (!this.#lineageBound) {
      const lineage = this.resolve<any>('lineage')
      if (lineage?.addEventListener) {
        this.#lastSegments = [...(lineage.explorerSegments?.() ?? [])]
        lineage.addEventListener('change', this.#onLineageChange)
        this.#lineageBound = true
      }
    }
    if (!this.#arrivalBound) {
      // A site the reader ARRIVED into: view.bee's verdict says this cell's
      // `view:default` mark opened the surface as they walked in, so the
      // place that spawned it is the page they came FROM, not this one.
      // The subscription's own last-value replay is not a live arrival —
      // ignore it, or a boot replay would rewrite a session's spawn.
      let replay = true
      this.onEffect(VIEW_SPAWN_EFFECT, (payload) => {
        if (replay) return
        const stepped = spawnForView(payload, 'website')
        if (stepped) this.#steppedInFrom = { mode: stepped.mode, segments: stepped.segments }
      })
      this.onEffect<{ segments?: readonly string[]; view?: string; held?: boolean; inherited?: boolean }>('view:arrival', (payload) => {
        if (replay) return
        if (payload?.view !== 'website') return
        // The site's own step between its pages is not an arrival into it, and
        // once the reader has moved inside the site, an arrival on the entry
        // is the walk back onto it, not the arrival that opened it (#89).
        if (payload.held || this.#movedInSite) return
        // A stepped-into site already knows where it was entered from.
        if (this.#spawnPinned) return
        const spawn = this.#spawn
        const entry = this.#siteEntrySegments
        if (!spawn || !entry) return
        if (!sameSiteSegments([...(payload.segments ?? [])], entry)) return
        this.#spawn = { mode: spawn.mode, segments: [...this.#prevSegments] }
        // THE WEBSITE IS PINNED above this place (its default is inherited):
        // the reader arrives in the whole website, not in one part.
        if (payload.inherited) {
          const up = this.#mount?.host
          if (up?.isConnected) void this.#widen(up)
          else this.#widenOnMount = true
        }
      })
      replay = false
      this.#arrivalBound = true
    }
    if (!this.#viewModeBound) {
      const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<EventTarget>('@hypercomb.social/ViewMode')
      if (vm?.addEventListener) {
        vm.addEventListener('change', this.#onViewModeChange)
        this.#viewModeBound = true
      }
    }
    if (!this.#globalContextMenuBound) {
      // Right-click anywhere on a PUBLISHED site (or on a cell that has no
      // per-cell page yet) → the website's menu. Gated on ViewMode='website'
      // so the hexagon canvas keeps its own right-click (come back out).
      // Document BUBBLE: everything closer to the press answers first — a
      // page's own right-click, a surface open over the site — and the back
      // gesture (window bubble) still answers after, standing down on the
      // claim.
      document.addEventListener('contextmenu', this.#onGlobalContextMenu)
      this.#globalContextMenuBound = true
    }
    if (!this.#backOff) {
      // On the home domain the right button comes back out of the site the
      // way the exit button does — the back gesture's ladder, so an ARRIVAL
      // FACE navigates back and a site the reader opened returns to its
      // spawn. Not on a published door: there the menu answers instead.
      // Live only while website mode is up — an entry whose `active()` holds
      // answers every right-click on the ladder's third rung.
      const websiteUp = (): boolean => (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
        ?.get<{ mode: string }>('@hypercomb.social/ViewMode')?.mode === 'website'
      this.#backOff = window.ioc?.get<BackGesture>('@diamondcoreprocessor.com/BackGesture')
        ?.register({ owner: 'site-view', back: () => this.#back(), exact: true, active: () => websiteUp() && !isPublishedVisitorShell() }) ?? null
    }
    if (!this.#publishedRootBound) {
      // Last-value replay covers the boot order: the visit engine mounts the
      // creation (and says where) before this view's first capture.
      this.onEffect<{ active?: boolean; segments?: readonly string[]; pubkey?: string; hosts?: readonly string[] }>('preview:mode', (preview) => {
        const root = preview?.active ? [...(preview.segments ?? [])].map(s => String(s ?? '').trim()).filter(Boolean) : []
        this.#publishedRoot = root.length ? root : null
        this.#publishedCreation = preview?.active ? preview : null
        // Whose pick a page shows, and where its versions are, depend on whose
        // creation this is: read both again.
        this.#pickReads.clear()
        this.#picks.clear()
        this.#versionReads.clear()
        if (this.#siteEntrySegments && this.#publishedRoot) {
          this.#siteEntrySegments = siteFloorFor(this.#siteEntrySegments, this.#publishedRoot)
        }
      })
      this.#publishedRootBound = true
    }
    if (!this.#featureVerifiedBound) {
      // A review→accept (or bypass) in the features panel flips a foreign
      // website from quarantined to verified; re-reconcile so it mounts now.
      this.onEffect('feature:verified', () => { void this.#reconcile() })
      // Hide / restore in the features panel turns this page off / back on.
      this.onEffect('feature:hidden', () => { void this.#reconcile() })
      this.onEffect('feature:restored', () => { void this.#reconcile() })
      this.#featureVerifiedBound = true
    }
    if (!this.#exitTogglesBound) {
      // Mirror the site's own icon/label onto the exit overlay from the same
      // ViewBee broadcast the command-line toggle uses (late-replay seeds it).
      this.onEffect<{ toggles?: Array<{ view: string; icon: string; label: string }> }>('view-toggles:changed', (p) => {
        const list = p?.toggles
        const w = Array.isArray(list) ? list.find(t => t?.view === 'website') : undefined
        this.#siteIcon = (w?.icon ?? '').trim()
        this.#siteLabel = (w?.label ?? '').trim()
        this.#refreshExitOverlay()
      })
      this.#exitTogglesBound = true
    }
    // Boot-time entry capture. If ViewMode persisted as 'website'
    // across a reload, no 'change' event will fire — record the
    // current lineage as this session's site root once on boot.
    if (this.#siteEntrySegments === null) {
      const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{ mode: string }>('@hypercomb.social/ViewMode')
      if (vm?.mode === 'website') this.#captureSiteEntry()
    }
    void this.#reconcile()
  }

  protected override dispose(): void {
    const lineage = this.resolve<any>('lineage')
    if (this.#lineageBound && lineage?.removeEventListener) {
      lineage.removeEventListener('change', this.#onLineageChange)
    }
    const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<EventTarget>('@hypercomb.social/ViewMode')
    if (this.#viewModeBound && vm?.removeEventListener) {
      vm.removeEventListener('change', this.#onViewModeChange)
    }
    if (this.#globalContextMenuBound) {
      document.removeEventListener('contextmenu', this.#onGlobalContextMenu)
    }
    this.#backOff?.()
    this.#backOff = null
    closeSiteContextMenu()
    this.#removeExitOverlay()
    this.#teardown()
  }

  readonly #onLineageChange = (): void => {
    const segments = [...(this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')?.explorerSegments?.() ?? [])]
    if (!sameSiteSegments(segments, this.#lastSegments)) {
      // The menu was about the page that was up; a new page is a new
      // question. A change that leaves the page where it was keeps it.
      closeSiteContextMenu()
      // A MOVE INSIDE THE SITE is a visit, however it was made (a link, the
      // menu, a typed `go`): remember the page left, and where the reader
      // was on it, so back can walk to it. A step back along the trail is
      // not a new visit.
      const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{ mode: string }>('@hypercomb.social/ViewMode')
      if (vm?.mode === 'website' && this.#siteEntrySegments && !this.#trailStep) {
        this.#trail.left(this.#lastSegments, segments)
        this.#trailScroll.push(this.#mount?.host.scrollTop ?? 0)
        if (this.#trailScroll.length > 200) this.#trailScroll.shift()
        this.#movedInSite = true
      }
      this.#prevSegments = this.#lastSegments
      this.#lastSegments = segments
    }
    void this.#reconcile()
  }
  readonly #onViewModeChange = (): void => {
    // Track session entry: capture on hexagons → website, drop on exit.
    // Boundary check in #menuItems / onAnchorClick keys off this.
    if (this.#restoringSpawn) return
    closeSiteContextMenu()
    const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{ mode: string }>('@hypercomb.social/ViewMode')
    if (vm?.mode === 'website') {
      if (this.#siteEntrySegments === null) this.#captureSiteEntry()
    } else {
      const spawn = this.#spawn
      const entry = this.#siteEntrySegments
      this.#siteEntrySegments = null
      this.#spawn = null
      this.#spawnPinned = false
      this.#pagelessAt = null
      this.#trail.clear()
      this.#movedInSite = false
      this.#trailScroll = []
      this.#returningScroll = null
      this.#enteredAt = null
      this.#widenOnMount = false
      this.#textEditing = false
      this.#shownVersions.clear()
      // Leaving the site returns to WHERE IT WAS SPAWNED FROM — the page the
      // reader was on, in the view they were looking at — never the page they
      // happened to browse to inside it, and never the raw hexagons just
      // because that is the default surface. Only for exits to hexagons,
      // which is the destination every exit path names: a view toggle onto
      // another surface (slides/tutor) is a change of face on this cell, not
      // an exit, and the launcher's dismiss-then-enter navigates itself right
      // after this listener. Gated on a site having actually been on screen
      // this session, so an unrelated mode flip never moves anyone. A PEEL
      // (Ctrl/⌘-click on the exit) stays right here, on this page's hexagons.
      // Who dropped it decides where it lands: an ARRIVAL releasing the
      // surface (the reader walked out) ends right here; anything else is
      // leaving the site, back the way in.
      const walkedOut = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
        ?.get<{ releasingArrival?: boolean }>('@diamondcoreprocessor.com/ViewBee')?.releasingArrival === true
      const backOut = this.#backOutTo
      this.#backOutTo = null
      if (vm?.mode === 'hexagons' && !this.#peelHere && (entry || this.#mount)) {
        this.#returnToSpawn(backOut ? { mode: HEXAGONS_SURFACE, segments: backOut } : spawn, backOut ? false : walkedOut)
      }
    }
    void this.#reconcile()
  }

  #captureSiteEntry(): void {
    const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
    const here = [...(lineage?.explorerSegments?.() ?? [])]
    this.#siteEntrySegments = siteFloorFor(here, this.#publishedRoot)
    const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ previous?: string }>('@hypercomb.social/ViewMode')
    // The spawning PLACE starts as "right here"; a `view:arrival` verdict for
    // this same cell corrects it to the page the reader came from. A STEP-IN
    // (a website icon clicked somewhere in the tree) already said where that
    // was, before the dispatcher walked the explorer to the root: that record
    // is the spawn, and nothing corrects it.
    const stepped = this.#steppedInFrom
    this.#steppedInFrom = null
    this.#spawn = stepped ?? { mode: (vm?.previous ?? '').trim(), segments: here }
    this.#spawnPinned = stepped !== null
    this.#trail.clear()
    this.#movedInSite = false
    this.#trailScroll = []
    this.#returningScroll = null
    this.#enteredAt = this.#siteEntrySegments ? [...this.#siteEntrySegments] : null
  }

  /** THE WEBSITE BELONGS TO THE ROOT (jwize 2026-11-04). A tile's page opened
   *  on its own is just that part; its website icon (the page asks with a
   *  bubbling 'hc-site-widen') widens the session to the whole website — the
   *  nearest top ancestor that has a page — on this same page. From here
   *  every link stays in the website, and back steps back along the pages
   *  read, then out. */
  async #widen(host: HTMLElement): Promise<void> {
    const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
    const here = [...(lineage?.explorerSegments?.() ?? [])]
    let floor = here
    for (let n = 1; n < here.length; n++) {
      const at = here.slice(0, n)
      if (await this.#hasPage(at)) { floor = at; break }
    }
    if (!host.isConnected || !this.#siteEntrySegments) return
    this.#siteEntrySegments = floor
    host.setAttribute('data-hc-site-entry', '/' + floor.join('/'))
  }

  /** The back gesture inside a site (home domain): one page back along the
   *  pages read this session, the website staying up the whole way; at the
   *  entry page, the website turns off and the reader steps OUT to the layer
   *  that hosts the entry tile — its hexagons, whatever that layer's own
   *  default. (The exit button still returns to where the site was opened.) */
  #back(): void {
    const previous = this.#trail.back()
    if (previous) {
      this.#returningScroll = this.#trailScroll.pop() ?? 0
      this.#trailStep = true
      void this.#navigate(previous).finally(() => { this.#trailStep = false })
      return
    }
    // At the entry: out the way in — the SPAWN, like every other exit (jwize
    // 2026-11-08: "always where you entered from"). ONE exception, jwize's
    // own (2026-11-04): a page opened while standing on its own tile's layer
    // — spawn and entry are the same cell, and that cell carries the page —
    // steps OUT to the layer hosting the tile, "the parent of the page you
    // entered". A node the site surface merely came up on (toggled on at
    // /deep/tile, which has no page of its own — `#pagelessAt`) is not a page
    // the reader entered: back used to send them to /deep, the website's
    // root, and now returns them to /deep/tile.
    const entry = this.#enteredAt ?? this.#siteEntrySegments
    const spawn = this.#spawn
    const ownPage = !!spawn && !!entry && sameSiteSegments(spawn.segments, entry)
      && this.#pagelessAt !== entry.join('/')
    this.#backOutTo = ownPage && entry ? entry.slice(0, -1) : null
    this.#exitToHive()
  }

  /** Come back out of the site: the view that spawned it, at the page it was
   *  spawned from. The surface is restored FIRST — while the mode still reads
   *  'website' any arrival at the destination would be judged as walking out
   *  of a site's scope and released to the hexagons under us — and the place
   *  follows with `explorerReplace`, so the whole reading session still costs
   *  the single history entry that entered it. */
  #returnToSpawn(spawn: SiteSpawn | null, walkedOut: boolean): void {
    const lineage = this.resolve<any>('lineage')
    const current: string[] = [...(lineage?.explorerSegments?.() ?? [])]
    // An exit goes back the way in; a walk-out ends where the reader now
    // stands (site-return.ts siteFlipTarget).
    const target = siteFlipTarget(spawn, current, walkedOut)
    if (target.mode !== HEXAGONS_SURFACE) {
      const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
        ?.get<{ setMode(m: string): void }>('@hypercomb.social/ViewMode')
      this.#restoringSpawn = true
      try { vm?.setMode(target.mode) } finally { this.#restoringSpawn = false }
    }
    if (sameSiteSegments(target.segments, current)) return
    // Back to the HEXAGONS: the place we return to must not re-open a view
    // of its own on arrival (its `view:default`, or one cascading from
    // above) — leaving a site lands on tiles. Armed only when a move follows,
    // so the one-shot is consumed by exactly this arrival.
    if (target.mode === HEXAGONS_SURFACE) {
      ;(window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
        ?.get<{ arriveAsHexagons?: () => void }>('@diamondcoreprocessor.com/ViewBee')?.arriveAsHexagons?.()
    }
    const segments = [...target.segments]
    if (typeof lineage?.explorerReplace === 'function') { lineage.explorerReplace(segments); return }
    ;(window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
      ?.get<{ goRaw?: (segments: readonly string[]) => void }>('@hypercomb.social/Navigation')
      ?.goRaw?.(segments)
  }

  /** Document-level contextmenu handler, website mode only. WHO IS READING
   *  decides what the right button means (jwize 2026-10-24):
   *   • on the HOME DOMAIN — the reader's own hive, hypercomb.io or
   *     localhost alike — it goes BACK, through the back gesture like on
   *     every other surface, and no menu opens. This handler stands down;
   *     the view's registered way out answers.
   *   • on a PUBLISHED door a SITE READS LIKE A WEBSITE: the right button
   *     opens a menu and changes nothing on the page (site-context-menu.ts).
   *     It used to walk up a page, and at the site's floor drop the reader
   *     into the hexagons — a trap door. The way to the hexagons and up a
   *     page are rows in the menu.
   *  Bubble phase, so a page that answers its own right-click keeps it;
   *  it still runs before the back gesture (window bubble), and its
   *  preventDefault is what keeps that gesture from ALSO walking the
   *  lineage. Two presses stay the browser's:
   *   • a held finger — a phone's long-press selects, opens the link menu, or
   *     is the page's own hold gesture. Except on an IN-SITE link: its href
   *     is a route the site resolves, not an address, so the browser's link
   *     menu would copy or open the wrong page — that one is suppressed;
   *   • an editable field or selected text — paste, copy, spellcheck. The
   *     real target is read through composedPath, so a field inside a seated
   *     part's shadow root counts. */
  readonly #onGlobalContextMenu = (e: MouseEvent): void => {
    const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{ mode: string }>('@hypercomb.social/ViewMode')
    if (!vm || vm.mode !== 'website') return
    // The page (or a surface over it) answered its own right-click — as under
    // a browser's own menu, it owns that press.
    if (e.defaultPrevented) return
    if (isLongPressMenu(e)) {
      if (linkAt(e)?.outside === null) e.preventDefault()
      return
    }
    // The home domain: the back gesture answers, never the menu.
    if (!isPublishedVisitorShell()) return
    const first = e.composedPath()[0]
    const target = first instanceof Element ? first : e.target instanceof Element ? e.target : null
    if (browserKeepsMenu(target)) return
    e.preventDefault()
    // A right-click on the menu itself changes nothing.
    if (isOnSiteContextMenu(e)) return
    // The Menu key (or Shift+F10) is not the right button; with nothing
    // focused it carries no real position (Chromium sends 1,1, Firefox 0,0),
    // and with something focused it carries that element's — worth keeping.
    const keyboard = e.button !== 2 && e.clientX <= 1 && e.clientY <= 1
    const at = keyboard ? { x: window.innerWidth / 2, y: window.innerHeight / 3 } : { x: e.clientX, y: e.clientY }
    openSiteContextMenu(at, this.#menuItems(e), this.#t('site-menu.label', 'Page menu'))
  }

  /** The website menu's rows for this press. The "site root" is where this
   *  session began (`#siteEntrySegments`, the published root on a door), not
   *  the hive root:
   *   • Up one level — inside the site, the parent page, never above its
   *     floor; from a route outside the site (a link that left it), the
   *     site's entry, so nobody is stranded on a blank route. Absent at the
   *     floor. Not "Back": reading a site adds no history, so this is the
   *     page above, not the page before.
   *   • Hexagon view — THIS page's hexagons (the exit's peel), a door into
   *     the hive. Not the plain exit: that returns to the view the site was
   *     opened from, which may be another view. No key is named for it — the
   *     H key IS the plain exit, so naming it here would promise one place
   *     and land in another.
   *   • Open in my hive — the visitor door (sharing/visitor-door.view.ts):
   *     the reader's OWN hive opens in a tab of its own, offering this
   *     creation from the page they stand on. Only where `preview:mode`
   *     names a published creation; the site is never left.
   *   • Copy page link, and Copy link address over an outside link. An
   *     in-site link is a route resolved against the site, so its href is no
   *     address — it gets no row. */
  #menuItems(e: MouseEvent): SiteMenuItem[] {
    const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
    const segments = [...(lineage?.explorerSegments?.() ?? [])]
    const entry = this.#siteEntrySegments ?? []
    const insideSite = segments.length >= entry.length
      && entry.every((seg, i) => segments[i] === seg)
    const up = !insideSite ? entry : segments.length > entry.length ? segments.slice(0, -1) : null
    const copied = this.#t('site-menu.copied', 'Copied')
    const failed = this.#t('site-menu.copy-failed', 'Couldn\'t copy')
    const items: SiteMenuItem[] = []
    if (up) {
      // Inside the site, up climbs past page-less cells to the nearest page
      // above (a silent no-op on an empty parent was a dead row).
      const act = insideSite ? (): void => { void this.#navigateUp(segments, entry) } : (): void => { void this.#navigate(up) }
      items.push({ icon: 'arrow_upward', label: this.#t('site-menu.up', 'Up one level'), act })
    }
    items.push({ icon: 'hexagon', label: this.#t('site-menu.hexagons', 'Hexagon view'), door: true, act: () => this.#exitToHive(true) })
    const home = visitorDoorHref(this.#publishedCreation, myHiveOrigin(), segments)
    if (home) items.push({ icon: 'open_in_new', label: this.#t('site-menu.open-home', 'Open in my hive'), act: () => { window.open(home, '_blank', 'noopener') } })
    items.push({ icon: 'link', label: this.#t('site-menu.copy-page', 'Copy page link'), done: copied, failed, rule: true, act: () => copyText(window.location.href) })
    const link = linkAt(e)?.outside
    if (link) items.push({ icon: 'content_copy', label: this.#t('site-menu.copy-link', 'Copy link address'), done: copied, failed, act: () => copyText(link) })
    return items
  }

  /** A catalog string, or the English when the key does not resolve — `t`
   *  echoes an unknown key back, which must never reach the screen. */
  #t(key: string, fallback: string): string {
    const text = window.ioc.get<I18nProvider>(I18N_IOC_KEY)?.t(key)
    return text && text !== key ? text : fallback
  }

  async #reconcile(): Promise<void> {
    // Re-entrancy generation: every reconcile bumps and captures #gen, then
    // bails after any await if a newer reconcile has since started. #reconcile
    // is fired fire-and-forget from many sources (lineage change, viewmode
    // change, boot heartbeat, and the feature:verified/hidden/restored effect
    // handlers — which replay their last value synchronously at boot), so
    // overlapping runs would otherwise race on #mount: whichever resource
    // resolves LAST wins the final mount, stranding the wrong cell's page (and
    // an in-flight mount could run foreign scripts AFTER a later reconcile
    // raised the review gate). Latest reconcile wins.
    const gen = ++this.#gen
    const lineage = this.resolve<any>('lineage')
    const store = this.resolve<any>('store')
    if (!lineage || !store?.hypercombRoot || !store?.getResource) return

    // The website surface is gated on ViewMode. Hexagons mode → tear
    // down regardless of what's in the cell's slots; the user is
    // navigating tiles, not reading pages. `/website` (or any toggle
    // that flips ViewMode to 'website') brings the page back. Per-cell
    // mounting is opt-in by the user, not auto-on whenever a context
    // page exists.
    const vm = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{ mode: string }>('@hypercomb.social/ViewMode')
    if (vm && vm.mode !== 'website') {
      this.#removeExitOverlay()
      this.#removeReviewGate()
      const wasMounted = this.#mount !== null
      this.#teardown()
      this.#restoreHiveChrome(wasMounted)
      return
    }
    // In website mode the raw-DOM exit overlay is ALWAYS present — even on a
    // page-less cell — so there is always a guaranteed way back to the hive.
    // A published site offers it only when its page asks (pageAsksForExit) —
    // decided at mount, where the page is read.
    if (vm?.mode === 'website' && !isPublishedVisitorShell()) this.#ensureExitOverlay()

    // Strip any stale tile-selection hash so the address bar reads
    // cleanly while in website mode (where selection has no consumer).
    if (window.location.hash) {
      try {
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      } catch { /* private mode / older browser — non-fatal */ }
    }

    const segments: string[] = [...(lineage.explorerSegments?.() ?? [])]

    // The cell's page lives in one of three places, queried in order:
    //   1. The `website` slot — the explicit, first-class page slot: a
    //      flat array of HTML resource sigs (newest = current), no
    //      decoration envelope. The migration target.
    //   2. The `decorations` slot — sigs into `__resources__` of shape
    //      `{ kind: 'visual:website:page', payload: { htmlSig } }`. The
    //      prior visual-bee home; read-through so already-built sites
    //      keep rendering.
    //   3. The legacy `context` slot — raw HTML resource sigs. Oldest
    //      data lives here; falls back when neither above is present.
    // Each cell carries its own; lineage navigation drives page changes.
    // No bundle, no manifest, no path table — the lineage IS the route.
    let cellPageSig = await this.#findWebsitePage(segments)
    if (gen !== this.#gen) return
    if (!cellPageSig) {
      cellPageSig = await this.#findDecorationPage(segments, store)
      if (gen !== this.#gen) return
    }
    if (!cellPageSig) {
      cellPageSig = await this.#findContextPage(segments, store)
      if (gen !== this.#gen) return
    }
    this.#pagelessAt = cellPageSig ? null : segments.join('/')
    if (cellPageSig) {
      // Verification gate. A FOREIGN page — adopted into the hive, or published
      // by a domain that isn't yours — must NOT activate (mount, run its
      // scripts, stream its resources) until it is VERIFIED: reviewed-and-
      // accepted, bypassed, or from a trusted/community domain. Your own
      // authoring is never gated. Showing the review gate INSTEAD of mounting
      // is what keeps an un-adopted feature's heavy payload off the wire.
      // Hidden gate (takes precedence — it's the retainable "off"). If the
      // participant has HIDDEN the website feature at this cell OR ANYWHERE
      // ABOVE it, the page stays inert: no mount, no scripts, no fetch. A
      // website is a scope — the root's hide record is the whole site's
      // master off, and a mid-branch record silences just that branch (the
      // Beehaviors panel writes the record at the node you toggle). Restoring
      // it from the panel re-reconciles and brings it back. The feature's
      // identity is the website bee's decoration kind — the same kind the
      // panel writes the hide for.
      const websiteKind = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
        ?.get<{ get: (view: string) => { decorationKind?: string } | undefined }>('@diamondcoreprocessor.com/VisualBeeRegistry')
        ?.get('website')?.decorationKind
      const hidden = websiteKind ? await isFeatureHiddenWithin(segments, websiteKind) : false
      if (gen !== this.#gen) return
      if (hidden) {
        this.#removeReviewGate()
        this.#teardown()
        return
      }

      const trial = trialOf(cellPageSig)
      if (trial) {
        this.#removeReviewGate()
        this.#teardown()
        this.#showTrial(cellPageSig, trial, store)
        return
      }
      this.#removeTrial()

      // The one question every page surface asks (page-run-gate.ts).
      if (!mayRunPage(segments, cellPageSig)) {
        this.#teardown()
        this.#showReviewGate(segments, cellPageSig)
        return
      }
      this.#removeReviewGate()
      await this.#mountCellPage(segments, cellPageSig, store, gen)
      return
    }

    // No page on this cell → tear down. Walking up to find an
    // ancestor's bundle is the legacy behavior; with per-cell pages
    // every cell is responsible for its own surface.
    this.#teardown()
  }

  /** The cell's mountable page sig — the SAME three-slot lookup #reconcile
   *  mounts with (website slot → decoration → legacy context), exposed so
   *  other surfaces (ShowFeaturesDrone's blocked-by-community stamping, the
   *  features panel's gate state) evaluate the gate against the exact sig the
   *  renderer would gate. Null = no page on this cell. */
  async resolvePageSig(segments: readonly string[]): Promise<string | null> {
    const store = this.resolve<any>('store')
    if (!store?.getResource) return null
    let sig = await this.#findWebsitePage(segments)
    if (!sig) sig = await this.#findDecorationPage(segments, store)
    if (!sig) sig = await this.#findContextPage(segments, store)
    return sig
  }

  /** First-class page lookup: the cell's `website` slot holds the page's
   *  HTML resource signature DIRECTLY (no decoration envelope). The
   *  newest entry is the current page. Checked BEFORE the decoration and
   *  context scans so a migrated cell renders from its explicit slot,
   *  while un-migrated cells fall through unchanged.
   *
   *  The slot is page-only by contract, so the sig is trusted and handed
   *  straight to #mountCellPage (which fetches + mounts it). Returns null
   *  when the slot is absent or empty — the caller then tries the legacy
   *  decoration and context paths, so nothing built before this slot
   *  existed goes dark. */
  async #findWebsitePage(segments: readonly string[]): Promise<string | null> {
    const ioc = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
    const history = ioc?.get<{
      sign: (lineage: { explorerSegments?: () => readonly string[] }) => Promise<string>
      currentLayerAt: (locationSig: string) => Promise<Record<string, unknown> | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null

    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig)
      if (!layer) return null
      const slot = layer[WEBSITE_SLOT]
      const sigs: string[] = Array.isArray(slot)
        ? slot.map((s: unknown) => String(s)).filter(s => /^[0-9a-f]{64}$/.test(s))
        : []
      return sigs.length ? sigs[sigs.length - 1] : null
    } catch {
      return null
    }
  }

  /** Decoration-based page lookup (the visual-bee migration target).
   *  Reads the cell's `decorations` slot, loads each sig from
   *  `__resources__`, filters by the website bee's declared
   *  `decorationKind` (looked up via VisualBeeRegistry), and returns the
   *  first match's `payload.htmlSig` — the HTML resource the renderer
   *  ultimately mounts.
   *
   *  Decoration JSONs live in `__resources__` (the shared content store)
   *  so peer-supplied decorations come through the same fetch pipeline
   *  as any other resource — adopter sees peer's `decorations` slot
   *  sigs in the merkle tree, and resolving them through getResource
   *  works whether the content is local or pulled from a relay.
   *
   *  Returns null if VisualBeeRegistry is unavailable, the website bee
   *  isn't registered yet, the cell has no `decorations` slot, or no
   *  entries match the kind. The caller then falls back to the legacy
   *  `context` slot for cells whose pages haven't been migrated. */
  async #findDecorationPage(
    segments: readonly string[],
    store: {
      getResource?: (sig: string) => Promise<Blob | null>
    },
  ): Promise<string | null> {
    if (!store.getResource) return null
    const ioc = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
    if (!ioc) return null

    const registry = ioc.get<{
      get: (view: string) => { decorationKind: string } | undefined
    }>('@diamondcoreprocessor.com/VisualBeeRegistry')
    const bee = registry?.get('website')
    if (!bee?.decorationKind) return null

    const history = ioc.get<{
      sign: (lineage: { explorerSegments?: () => readonly string[] }) => Promise<string>
      currentLayerAt: (locationSig: string) => Promise<{ decorations?: unknown } | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null

    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig)
      if (!layer) return null
      const decorations = (layer as { decorations?: unknown }).decorations
      const sigs: string[] = Array.isArray(decorations)
        ? decorations.map((s: unknown) => String(s)).filter(s => /^[0-9a-f]{64}$/.test(s))
        : []
      for (const decorationSig of sigs) {
        const blob = await store.getResource(decorationSig)
        if (!blob) continue
        try {
          const record = JSON.parse(await blob.text()) as {
            kind?: string
            payload?: { htmlSig?: string }
          }
          if (record?.kind !== bee.decorationKind) continue
          const htmlSig = record?.payload?.htmlSig
          if (typeof htmlSig === 'string' && /^[0-9a-f]{64}$/.test(htmlSig)) {
            return htmlSig
          }
        } catch { /* malformed record — skip */ }
      }
    } catch { /* fall through — caller will try legacy context */ }
    return null
  }

  /** Legacy per-cell page lookup. Reads the cell's layer at `segments`,
   *  scans its `context` slot for the first HTML-shaped resource,
   *  returns that sig. Probes the resource head to detect HTML rather
   *  than trusting position — a cell's bag is heterogeneous (prior
   *  impls, chrome refs, examples) and the renderer should pick the
   *  page kind by content, not by index.
   *
   *  Used as fallback when `#findDecorationPage` returns null — i.e. for
   *  cells whose pages were written before the visual-bee migration. */
  async #findContextPage(
    segments: readonly string[],
    store: { getResource: (sig: string) => Promise<Blob | null> },
  ): Promise<string | null> {
    const ioc = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
    const history = ioc?.get<{
      sign: (lineage: { explorerSegments?: () => readonly string[] }) => Promise<string>
      currentLayerAt: (locationSig: string) => Promise<{ context?: unknown } | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null

    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig)
      if (!layer) return null
      const context = (layer as { context?: unknown }).context
      const sigs: string[] = Array.isArray(context)
        ? context.map((s: unknown) => String(s)).filter(s => /^[0-9a-f]{64}$/.test(s))
        : []
      for (const sig of sigs) {
        const blob = await store.getResource(sig)
        if (!blob) continue
        // 64 bytes is enough to spot a doctype, root tag, or BOM-prefixed xml.
        const head = await blob.slice(0, 64).text()
        if (/^\s*(?:﻿)?(<!doctype|<html|<svg|<\?xml)/i.test(head)) return sig
      }
    } catch { /* fall through — caller will try legacy bundle path */ }
    return null
  }

  /** Mount the per-cell HTML inline in the live document. No iframe,
   *  no shadow DOM. The author's HTML is parsed, its `<style>` blocks
   *  are appended to <head> (tagged with a marker so we can lift them
   *  cleanly on unmount), its `<script>` blocks are recreated as live
   *  script elements so they actually run, and its `<body>` content
   *  is dropped into a host div pinned over the viewport.
   *
   *  CSS like `html { background: var(--bg) }` applies to the live
   *  page's html element — which is exactly the right scope: in
   *  website mode every other surface is `display:none` via the
   *  `hc-view-website` body class, so the page IS the cell's content.
   *  No selector rewrites needed.
   *
   *  Navigation: anchor clicks bubble to the host's click listener,
   *  which intercepts internal hrefs and updates lineage. The
   *  resource is already warm — the layer-slot preloader walks
   *  `context` slot sigs into the resource cache when the layer is
   *  visited, so render is a synchronous DOM operation. */
  async #mountCellPage(
    segments: readonly string[],
    pageSig: string,
    store: { getResource: (sig: string) => Promise<Blob | null> },
    gen: number,
  ): Promise<void> {
    // Same per-cell page already mounted — just update the sitePath
    // marker so navigate() math stays correct on follow-up clicks.
    if (this.#mount && this.#mount.pageSig === pageSig && this.#mount.shownSig === (this.#versionShown(pageSig)?.sig ?? null)) {
      this.#mount.sitePath = [...segments]
      return
    }

    const blob = await store.getResource(pageSig)
    // A newer #reconcile started while the resource streamed — that reconcile
    // owns the final state (it may have navigated away, raised the review gate,
    // or hidden the feature). Bail before teardown/mount/runScripts so this
    // stale mount can't clobber it or execute scripts behind an already-shown
    // gate. The reconcile that raised the gate bumped #gen, so this check is
    // what enforces "nothing runs until reviewed" across the async boundary.
    if (gen !== this.#gen) return
    if (!blob) { this.#teardown(); return }
    // SEAT THIS CELL'S PARTS INTO ITS PAGE. A cell broken apart with an HTML
    // flow declares holes; its members' own pages fill them, and the two read
    // as one document (the other face of walking IN to a child, which replaces
    // this page instead). Composition never fails: anything it cannot do hands
    // back the authored page untouched, so a part that will not load costs one
    // empty hole rather than the page.
    const baseHtml = await blob.text()
    // A version this reader chose to see in the page's place: words only, so it
    // runs exactly what the page runs (site-versions.ts).
    const shownVersion = this.#versionShown(pageSig)
    const authored = shownVersion?.html ?? baseHtml
    const rawHtml = await composeDivision(segments, authored)
    if (gen !== this.#gen) return

    const parsed = new DOMParser().parseFromString(rewriteCellPageRefs(rawHtml), 'text/html')
    // Each element's place in the AUTHORED page, taken before anything moves
    // a node, so an inline text edit can be traced back to it. Only an
    // uncomposed page: a composed one is not the bytes this tile holds.
    const textOrder = rawHtml === authored ? authoredOrder(parsed) : null
    const offersExit = !isPublishedVisitorShell() || pageAsksForExit(parsed)

    // The page's linked sheets load BEFORE any of it goes in, the way a document
    // holds its first paint for the sheets in its <head> — otherwise the content
    // paints bare and restyles a beat later (cell-page-stylesheets.ts). The page
    // on screen stays up while they load (a site's pages share one sheet, so
    // it is already warm), and everything below is one synchronous swap.
    const linkNodes = hoistPageStylesheets(parsed, pageSig)
    await stylesheetsSettled(linkNodes)
    if (gen !== this.#gen) {
      for (const node of linkNodes) node.remove()
      return
    }

    this.#teardown()

    // Snapshot the live <html>/<body> inline background BEFORE the page's
    // scripts run. A site theme-stamps by writing a background straight onto
    // <html>/<body> — an inline mutation that removing its <style> nodes can't
    // undo — so without this the stamped background bleeds into the hive when
    // you leave website mode. Restored on unmount → exiting a site returns to
    // the hive's own theme background (dark by default). Only background props
    // are touched; other inline styles / CSS vars on those elements are left
    // alone (e.g. --hc-header-bottom the chrome sets on <html>).
    const htmlStyle = document.documentElement.style
    const bodyStyle = document.body.style
    const prevHtmlBg = snapshotBackground(htmlStyle)
    const prevBodyBg = snapshotBackground(bodyStyle)

    // Snapshot the hive's own theme attribute too. A site carries its own
    // light/dark choice and stamps it straight onto <html data-theme> — the
    // SAME attribute the hive's --md-* tokens key off — via a pre-paint script
    // (`document.documentElement.setAttribute('data-theme', …)`) plus an in-page
    // toggle. Removing the page's <style> nodes can't undo an attribute write,
    // so without this the site's theme (e.g. light) leaks into the hive chrome
    // when you switch back to hexagon mode. Captured before the page scripts run
    // and restored on unmount. null = the hive default (system / unset), so it
    // restores by REMOVING the attribute rather than writing an empty string.
    const prevTheme = document.documentElement.getAttribute('data-theme')

    // Move <body> children into a host div pinned over the viewport.
    const host = document.createElement('div')
    host.id = 'hc-site-view-host'
    // The page's content sig on the host itself, so a page with no inline
    // <style> is still named (the domain links key what it names by it).
    host.setAttribute('data-hc-cell-page', pageSig)
    // A page the back gesture returned to says so before its scripts run,
    // so it can resume where the reader left it (back only).
    const returningTo = this.#returningScroll
    this.#returningScroll = null
    if (returningTo !== null) host.setAttribute('data-hc-returning', '')
    // Where this site was entered, for the page's own script: a site entered
    // at a top tile is the whole site (a page shows its ways in); a page
    // entered on its own is just that part (jwize 2026-11-04: "the website
    // belongs to the root. When I view the part I view just the part").
    host.setAttribute('data-hc-site-entry', '/' + (this.#siteEntrySegments ?? segments).join('/'))
    host.style.cssText =
      // Inset by any docked panel's reservation (`--hc-inset-<side>`, mirrored
      // from `viewport:inset`) so the Views window can stay open beside the page.
      'position:fixed;top:0;bottom:0;' +
      'left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);' +
      'z-index:59988;overflow:auto;' +
      (offersExit ? `--hc-site-chrome-bottom:${CHROME_CORNER_BOTTOM};--hc-site-chrome-right:${CHROME_CORNER_RIGHT};` : '')
    // The site host IS the page's scroll surface. Without this opt-out the
    // always-on hex wheel-zoom handler (MousewheelZoomInput) preventDefaults
    // every wheel/trackpad event over the full-viewport canvas — which is only
    // visually suppressed in website mode, still full-rect in layout — so the
    // page can't scroll and tall pages clip. `data-consumes-wheel` makes that
    // handler bail when the event is inside us (same hatch the history-viewer
    // overlay uses), restoring native scroll.
    host.setAttribute('data-consumes-wheel', '')
    document.body.appendChild(host)

    // Finish the seating. `DOMParser` leaves a declarative shadow root inert,
    // and inert means invisible — the part's markup is there and renders
    // nothing. No-op when nothing was seated.
    hydrateSeatedParts(parsed.body)

    // The page's own CSS goes INSIDE the page's host, rewritten so every rule
    // is confined to it (`body{…}` → `#hc-site-view-host{…}`). A cell page is
    // an artifact: it carries its own CSS, so it renders alone or beside
    // another one without either bleeding into the hive chrome or fighting the
    // other page. Styles first, so the page paints in one pass rather than
    // flashing unstyled while the body content is moved across.
    const styleNodes: HTMLStyleElement[] = []
    for (const s of Array.from(parsed.querySelectorAll('style'))) {
      const live = document.createElement('style')
      live.setAttribute('data-hc-cell-page', pageSig)
      live.textContent = scopeCellPageCss(s.textContent ?? '', `#${host.id}`)
      host.appendChild(live)
      styleNodes.push(live)
    }

    // A page states its theme by writing on its root — `documentElement
    // .classList.add('dark')`, `<html data-theme>` — and its own scoped CSS now
    // reads that off the host instead. Mirror root class/theme writes onto the
    // host so those toggles keep working, and seed from whatever the page's
    // pre-paint script already stamped.
    // The classes the page was AUTHORED with (on its own <html>/<body>) are the
    // artifact's own — they stay on the host under every mirror pass.
    const authoredClass = [
      parsed.documentElement?.className ?? '',
      parsed.body?.className ?? '',
    ].join(' ').trim()
    const mirrorRoot = (): void => {
      const theme = document.documentElement.getAttribute('data-theme')
      if (theme === null) host.removeAttribute('data-theme')
      else host.setAttribute('data-theme', theme)
      host.className = [authoredClass, document.documentElement.className, document.body.className]
        .join(' ').trim()
    }
    mirrorRoot()
    const rootObserver = new MutationObserver(mirrorRoot)
    const watch = { attributes: true, attributeFilter: ['class', 'data-theme'] }
    rootObserver.observe(document.documentElement, watch)
    rootObserver.observe(document.body, watch)

    const body = parsed.body
    if (body) {
      while (body.firstChild) host.appendChild(body.firstChild)
    }

    // THE CHROME CORNER, reserved at the end of the scroll: the page's last
    // line always lifts clear of the exit button. Spans a grid body, never
    // shrinks in a flex one; in a column layout it simply lifts the footer.
    const reserve = document.createElement('div')
    reserve.setAttribute('data-hc-site-chrome-reserve', '')
    reserve.setAttribute('aria-hidden', 'true')
    reserve.style.cssText = 'display:block;flex:none;grid-column:1/-1;height:var(--hc-site-chrome-bottom);margin:0;padding:0;border:0;pointer-events:none'
    if (offersExit) host.appendChild(reserve)
    if (offersExit) this.#ensureExitOverlay()
    else this.#removeExitOverlay()
    // The host's scrollbar comes and goes with the page's height (images
    // landing, a section opening); the button follows it off the thumb.
    const placeExit = new ResizeObserver(() => this.#placeExitOverlay(host))
    placeExit.observe(host)

    // Re-create <script> elements so they actually execute. innerHTML
    // / appendChild of inert <script> nodes won't run; cloning into a
    // fresh element triggers parser-style execution. Run pre-paint /
    // head scripts in their authored order before body scripts so any
    // theme-stamping fires before render.
    const scriptNodes: HTMLScriptElement[] = []
    const runScripts = (sources: readonly HTMLScriptElement[]): void => {
      for (const s of sources) {
        const live = document.createElement('script')
        for (const a of Array.from(s.attributes)) live.setAttribute(a.name, a.value)
        live.textContent = s.textContent ?? ''
        host.appendChild(live)
        scriptNodes.push(live)
      }
    }
    runScripts(Array.from(parsed.head.querySelectorAll('script')))
    runScripts(Array.from(host.querySelectorAll('script')).filter(s => !scriptNodes.includes(s)))
    if (returningTo) {
      // Back to where the reader was: once laid out (and again after the
      // page's late content lands), never past the end.
      const restore = (): void => { if (host.isConnected) host.scrollTop = returningTo }
      requestAnimationFrame(restore)
      setTimeout(restore, 250)
    }

    // Anchor click → the site's own navigation. Bubbling listener on the host
    // catches every click on an inflated <a>. Resolution for internal hrefs is
    // hierarchy-aware (see #resolveAndNavigate): an href is read against the
    // site's OWN position in the tree, not blindly from the hive root.
    //
    // Nothing here is allowed to reach the document. Letting these through
    // used to mean, on the native client (verified in WebView2): an external
    // href navigates the WHOLE webview off `tauri.localhost` with no address
    // bar to come back from, `target="_blank"` and `window.open` silently do
    // nothing at all, and a bare `#anchor` writes `location.hash` — which this
    // shell reads back as a tile SELECTION and then carries forever.
    const onAnchorClick = (e: Event): void => {
      const target = e.target as Element | null
      const a = target?.closest?.('a')
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      if (!href) return
      if (href.startsWith(RESOURCE_URL_PREFIX)) return
      if (/^(data:|blob:|javascript:)/i.test(href)) return

      e.preventDefault()
      if (href.startsWith('#')) {
        host.querySelector(`#${CSS.escape(href.slice(1))}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      if (/^(https?:|mailto:|tel:|\/\/)/i.test(href)) {
        openExternalLink(href.startsWith('//') ? `https:${href}` : href)
        return
      }
      void this.#resolveAndNavigate(href, segments)
    }
    host.addEventListener('click', onAnchorClick, true)
    const onWiden = (): void => { void this.#widen(host) }
    host.addEventListener('hc-site-widen', onWiden)
    if (this.#widenOnMount) { this.#widenOnMount = false; void this.#widen(host) }

    this.#mount = {
      host,
      pageSig,
      shownSig: shownVersion?.sig ?? null,
      sitePath: [...segments],
      unmount: () => {
        this.#textEditor?.dispose()
        this.#textEditor = null
        this.#versions?.dispose()
        this.#versions = null
        host.removeEventListener('click', onAnchorClick, true)
        host.removeEventListener('hc-site-widen', onWiden)
        rootObserver.disconnect()
        placeExit.disconnect()
        for (const node of styleNodes) node.remove()
        for (const node of linkNodes) node.remove()
        for (const node of scriptNodes) node.remove()
        // Revert any background a page script stamped onto <html>/<body> so the
        // hive's own theme background (or dark default) shows again on exit.
        restoreBackground(htmlStyle, prevHtmlBg)
        restoreBackground(bodyStyle, prevBodyBg)
        // Restore the hive's own theme — a site stamps its light/dark choice
        // onto <html data-theme>, which otherwise persists into hexagon mode and
        // shows the site's light styles where the hive should be dark.
        if (prevTheme === null) document.documentElement.removeAttribute('data-theme')
        else document.documentElement.setAttribute('data-theme', prevTheme)
      },
    }
    const editSig = shownVersion?.sig ?? pageSig
    if (textOrder && offersExit) void this.#offerTextEditing(host, textOrder, segments, pageSig, editSig, authored)
    if (rawHtml === authored) {
      void this.#offerVersions(host, segments, pageSig, baseHtml, editSig)
      void this.#resolvePick(host, segments, pageSig, baseHtml)
    }
  }

  // ── inline text editing ────────────────────────────────────────────────

  /** The pencil beside the exit button, wherever this place holds a key and
   *  never on the read-only published shell (nothing it writes persists). On a
   *  page that is yours, Enter saves into the tile. On a page from elsewhere,
   *  Enter OFFERS the words to its publisher's host as a contribution and the
   *  page stays as published (documentation/page-contributions.md). */
  async #offerTextEditing(
    host: HTMLElement,
    order: WeakMap<Element, number>,
    segments: readonly string[],
    pageSig: string,
    /** The version being edited: the page itself, or a contribution shown in its
     *  place — an offer made on a contribution is a contribution to it. */
    editSig: string,
    authored: string,
  ): Promise<void> {
    if (isPublishedVisitorShell()) return
    const publisher = pagePublisherDomain(pageSig)
    const foreign = isForeignContent(segments, publisher) && !isLocallyAuthored(pageSig)
    const zone = foreign ? zoneDoor(publisher) : ''
    const signer = window.ioc.get<{ getPublicKeyHex?: () => Promise<string | null> }>('@diamondcoreprocessor.com/NostrSigner')
    const pubkey = await signer?.getPublicKeyHex?.().catch(() => null)
    if (!pubkey) return
    if (this.#mount?.host !== host || !host.isConnected) return
    this.#textEditor?.dispose()
    this.#textEditor = new SiteTextEditor({
      host,
      order,
      editing: () => this.#textEditing,
      setEditing: (on) => { this.#textEditing = on; this.#textEditor?.refresh() },
      refusal: (slot) => {
        if (!replaceTextInPage(authored, slot, slot.value)) return this.#t('site-edit.scripted', 'The page\'s own script writes this text, so it cannot be edited here.')
        if (foreign && !zone) return this.#t('site-edit.no-host', 'This page came from elsewhere and no host for it is known, so there is nowhere to offer an edit.')
        return null
      },
      save: (slot, next) => foreign
        ? this.#offerText(zone, editSig, authored, slot, next).then(failed => {
          // The page's versions now include this one: read its pools again.
          if (!failed && editSig === pageSig) {
            this.#versionReads.delete(pageSig)
            void this.#offerVersions(host, segments, pageSig, authored, editSig, true)
          }
          return failed
        })
        : this.#saveText(host, segments, authored, slot, next),
      t: (key, fallback) => this.#t(key, fallback),
      hint: foreign
        ? this.#t('site-edit.offer-hint', 'Enter offers your words to {host} · Shift+Enter new line · Esc cancels').replace('{host}', zone || '—')
        : this.#t('site-edit.hint', 'Enter saves · Shift+Enter new line · Esc cancels'),
    })
    this.#placeExitOverlay(host)
  }

  /** The versions button, when anyone has offered a version of this page: the
   *  page's own host (its publisher's zone, or this door on a published site)
   *  and every host this hive follows or holds are asked once per session. */
  /** `fresh`: a contribution was just offered, so a host that said "no pool
   *  here" a moment ago is asked again (pool-listing.ts remembers misses). */
  async #offerVersions(host: HTMLElement, segments: readonly string[], pageSig: string, baseHtml: string, shownSig: string, fresh = false): Promise<void> {
    let read = this.#versionReads.get(pageSig)
    if (!read) {
      read = this.#versionHosts(pageSig)
        .then(hosts => Promise.all(hosts.map(h => readContributions(h, pageSig, baseHtml, undefined, { fresh }).catch(() => [] as PageContribution[]))))
        .then(mergeContributions)
        .catch(() => [] as PageContribution[])
      this.#versionReads.set(pageSig, read)
    }
    const contributions = await read
    if (!contributions.length || this.#mount?.host !== host || !host.isConnected) return
    const signer = window.ioc.get<{ getPublicKeyHex?: () => Promise<string | null> }>('@diamondcoreprocessor.com/NostrSigner')
    const me = String((await signer?.getPublicKeyHex?.().catch(() => null)) ?? '').toLowerCase()
    const holdsKey = await this.#holdsKeyFor(segments, pageSig)
    if (this.#mount?.host !== host || !host.isConnected) return
    // Above the exit button when there is one, and above the pencil wherever a
    // key can edit (never on the published shell).
    const rem = (this.#exitOverlay ? 3.5 : 0.75) + (isPublishedVisitorShell() ? 0 : 2.75)
    this.#versions?.dispose()
    this.#versions = new SiteVersions({
      base: pageSig,
      baseHtml,
      contributions,
      me,
      shown: shownSig,
      show: (contribution) => {
        // The reader's own choice — the published page included — wins over a pick.
        this.#shownVersions.set(pageSig, contribution)
        if (this.#mount?.host === host) this.#returningScroll = host.scrollTop
        void this.#reconcile()
      },
      picked: () => this.#picks.get(pageSig)?.sig ?? null,
      ...(holdsKey ? { pick: (c: PageContribution | null) => this.#pickForEveryone(host, segments, pageSig, c) } : {}),
      t: (key, fallback) => this.#t(key, fallback),
      bottom: `calc(${rem}rem + env(safe-area-inset-bottom, 0px))`,
    })
    this.#placeExitOverlay(host)
  }

  /** The version shown in a page's place: this reader's own choice, else the
   *  publisher's words-only pick, else none (the page itself). */
  #versionShown(pageSig: string): PageContribution | null {
    if (this.#shownVersions.has(pageSig)) return this.#shownVersions.get(pageSig) ?? null
    const pick = this.#picks.get(pageSig) ?? null
    return pick?.textOnly ? pick : null
  }

  /** May this hive pick for everyone? Only for a page that is its own, in a hive
   *  (the published shell holds no key) — and, when it is viewing a published
   *  creation, only when that creation is the one this hive publishes for. */
  #ownsPage(segments: readonly string[], pageSig: string): boolean {
    if (isPublishedVisitorShell()) return false
    return !(isForeignContent(segments, pagePublisherDomain(pageSig)) && !isLocallyAuthored(pageSig))
  }

  async #holdsKeyFor(segments: readonly string[], pageSig: string): Promise<boolean> {
    if (!this.#ownsPage(segments, pageSig)) return false
    const creator = String(this.#publishedCreation?.pubkey ?? '').toLowerCase()
    if (!creator) return true
    const own = String((await publisherKeyHex().catch(() => '')) ?? '').toLowerCase()
    return own === creator
  }

  /** Whose pick a page shows, and where it is read: a published creation names
   *  its publisher and hosts; in a hive, a page of its own is read from its own
   *  index on the hosts it publishes to. A page from elsewhere in a hive: none
   *  known (its publisher's key is not recorded where it was adopted). */
  async #pickSource(segments: readonly string[], pageSig: string): Promise<{ anchor: string; hosts: string[] } | null> {
    const creation = this.#publishedCreation
    const anchor = String(creation?.pubkey ?? '').toLowerCase()
    if (/^[0-9a-f]{64}$/.test(anchor)) {
      const hosts = new Set<string>([...(isPublishedVisitorShell() ? [location.host] : []), ...(creation?.hosts ?? [])].map(zoneDoor))
      hosts.delete('')
      return hosts.size ? { anchor, hosts: [...hosts] } : null
    }
    if (!this.#ownsPage(segments, pageSig)) return null
    const own = String((await publisherKeyHex().catch(() => '')) ?? '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(own)) return null
    const hosts = await this.#pickHosts(segments, pageSig)
    return hosts.length ? { anchor: own, hosts } : null
  }

  /** Where a page of this hive's own is published: the hosts its branch is
   *  marked for, this hive's own domain, the zones it holds, and the zone the
   *  page is attributed to. */
  async #pickHosts(segments: readonly string[], pageSig: string): Promise<string[]> {
    const hosts = new Set<string>()
    for (const h of await hostsOfBranch(segments).catch(() => [] as string[])) hosts.add(zoneDoor(h))
    let self = ''
    try { self = localStorage.getItem('hc:nostrmesh:self-domain') ?? '' } catch { /* no storage */ }
    hosts.add(zoneDoor(self))
    for (const z of await listZoneBindings().catch(() => [])) hosts.add(zoneDoor(z.zone))
    hosts.add(zoneDoor(pagePublisherDomain(pageSig)))
    hosts.delete('')
    return [...hosts].filter(isPublishNode)
  }

  /** Read the publisher's pick for the mounted page; when it changes what this
   *  reader sees, show it. Never before the page itself is up — view first. */
  async #resolvePick(host: HTMLElement, segments: readonly string[], pageSig: string, baseHtml: string): Promise<void> {
    let read = this.#pickReads.get(pageSig)
    if (!read) {
      read = this.#pickSource(segments, pageSig)
        .then(source => (source ? readPick(source.hosts, source.anchor, pageSig, baseHtml) : null))
        .catch(() => null)
      this.#pickReads.set(pageSig, read)
    }
    const pick = await read
    const before = this.#picks.get(pageSig)?.sig ?? null
    this.#picks.set(pageSig, pick)
    if ((pick?.sig ?? null) === before || this.#shownVersions.has(pageSig)) return
    if (this.#mount?.host !== host || !host.isConnected) return
    this.#returningScroll = host.scrollTop
    void this.#reconcile()
  }

  /** The key holder makes a version what everyone sees (null: the published
   *  page again), signed into their own index on every host the page is
   *  published to. Null = done; a string says why not. */
  async #pickForEveryone(host: HTMLElement, segments: readonly string[], pageSig: string, contribution: PageContribution | null): Promise<string | null> {
    const hosts = await this.#pickHosts(segments, pageSig)
    if (!hosts.length) return this.#t('site-versions.no-hosts', 'This page is not published anywhere yet, so there is no one else to show it to.')
    const deps = pickDeps()
    if (!deps) return this.#t('site-edit.failed', 'Could not save — try again.')
    const done = await signPick(hosts, pageSig, contribution, deps)
    if (!done.ok) return done.error
    this.#picks.set(pageSig, contribution)
    this.#pickReads.set(pageSig, Promise.resolve(contribution))
    this.#shownVersions.delete(pageSig)
    EffectBus.emit('toast:show', {
      type: 'success',
      message: (contribution
        ? this.#t('site-versions.picked-toast', 'Everyone now sees this version on {hosts}.')
        : this.#t('site-versions.unpicked-toast', 'Everyone sees the published page again on {hosts}.')).replace('{hosts}', done.hosts.join(', ')),
    })
    if (this.#mount?.host === host) this.#returningScroll = host.scrollTop
    void this.#reconcile()
    return null
  }

  /** Where a page's versions are asked: this door on a published site; in a
   *  hive, the page publisher's zone and every host followed or held. */
  async #versionHosts(pageSig: string): Promise<string[]> {
    if (isPublishedVisitorShell()) return [location.host]
    const hosts = new Set<string>()
    // A published creation being viewed names the hosts it came from.
    for (const h of this.#publishedCreation?.hosts ?? []) hosts.add(zoneDoor(h))
    const publisher = zoneDoor(pagePublisherDomain(pageSig))
    if (publisher) hosts.add(publisher)
    for (const h of await listCommunityHosts().catch(() => [] as string[])) hosts.add(zoneDoor(h))
    for (const z of await listZoneBindings().catch(() => [])) hosts.add(zoneDoor(z.zone))
    hosts.delete('')
    return [...hosts]
  }

  /** Offer the page with one text's words replaced to its publisher's host, as
   *  a contribution under this hive's key. The page on screen and in the tile
   *  stays as published. Null = offered; a string says why not. */
  async #offerText(zone: string, pageSig: string, authored: string, slot: TextSlot, next: string): Promise<string | null> {
    const html = replaceTextInPage(authored, slot, next)
    if (!html) return this.#t('site-edit.scripted', 'The page\'s own script writes this text, so it cannot be edited here.')
    const deps = hostOfferDeps()
    if (!deps) return this.#t('site-edit.failed', 'Could not save — try again.')
    const done = await dropContribution(zone, { base: pageSig, baseHtml: authored, html }, deps)
    if (!done.ok) return done.error
    EffectBus.emit('toast:show', {
      type: 'success',
      message: this.#t('site-edit.offered', 'Offered to {host}. The page stays as published until its key holder picks a version.').replace('{host}', zone),
    })
    return null
  }

  /** Write the page with one text's words replaced, as a new resource the tile
   *  now points at, then remount it where the reader was. Null = saved; a
   *  string says why not. */
  async #saveText(host: HTMLElement, segments: readonly string[], authored: string, slot: TextSlot, next: string): Promise<string | null> {
    const html = replaceTextInPage(authored, slot, next)
    if (!html) return this.#t('site-edit.scripted', 'The page\'s own script writes this text, so it cannot be edited here.')
    const store = this.resolve<{ putResource?: (blob: Blob) => Promise<string> }>('store')
    if (!store?.putResource) return this.#t('site-edit.failed', 'Could not save — try again.')
    const sig = await store.putResource(new Blob([html], { type: 'text/html' }))
    // Your own words: the activation gate never holds this page for review.
    markAuthored(sig)
    const committed = await commitPageSig(segments, sig)
    if (!committed.ok) return committed.error
    if (this.#mount?.host === host) this.#returningScroll = host.scrollTop
    void this.#reconcile()
    return null
  }

  // ── raw-DOM exit overlay ───────────────────────────────────────────────

  /** Ensure the exit button exists in <body> and reflects the current site's
   *  glyph/label. Idempotent — safe to call on every reconcile. */
  #ensureExitOverlay(): void {
    if (!this.#exitOverlay) {
      const btn = document.createElement('button')
      btn.id = 'hc-site-exit'
      // A door into the hive: coming within range of it preloads what the
      // approach wakes (hypercomb-runtime script-preloader.ts #watchRange).
      btn.dataset['hcApproach'] = ''
      btn.type = 'button'
      btn.style.cssText = EXIT_OVERLAY_CSS
      // Click = close the site (back to its spawn). Ctrl/⌘-click = stay on
      // this page and show ITS hexagons — the one way to reach the grid of a
      // cell whose default view is the site, where the rail's ctrl-click on
      // the site's icon then clears that default.
      btn.addEventListener('click', (e) => { this.#exitToHive(e.ctrlKey || e.metaKey) })
      // Rest/active affordance without a stylesheet — cheap inline listeners.
      // Dim at rest so it stops competing with the page; solid on approach.
      const wake = (): void => {
        btn.style.opacity = '1'
        btn.style.background = 'rgba(20,29,40,.94)'
      }
      const rest = (): void => {
        btn.style.opacity = '.38'
        btn.style.background = 'rgba(12,17,24,.82)'
      }
      btn.addEventListener('pointerenter', (e) => { this.#exitOver = true; wake(); this.#peekExit(e) })
      btn.addEventListener('pointermove', this.#peekExit)
      btn.addEventListener('focus', wake)
      btn.addEventListener('pointerleave', (e) => { this.#exitOver = false; rest(); this.#peekExit(e) })
      btn.addEventListener('blur', rest)
      window.addEventListener('keydown', this.#peekExit, true)
      window.addEventListener('keyup', this.#peekExit, true)
      window.addEventListener('blur', this.#peekExit)
      document.body.appendChild(btn)
      // Touch has no hover: show it solid for a beat when the site opens, then
      // let it settle into the dimmed rest state.
      wake()
      window.setTimeout(() => { if (this.#exitOverlay === btn) rest() }, 2500)
      this.#exitOverlay = btn
    }
    this.#refreshExitOverlay()
  }

  /** While Ctrl/⌘ is held over the button it wears the hexagon — the button
   *  says what the click is about to do before it is pressed. A window blur
   *  (the key released somewhere else) drops the peek. */
  readonly #peekExit = (e: Event): void => {
    const held = e.type !== 'blur' && ((e as MouseEvent | KeyboardEvent).ctrlKey || (e as MouseEvent | KeyboardEvent).metaKey)
    const peek = this.#exitOver && held
    if (peek === this.#exitPeek) return
    this.#exitPeek = peek
    this.#refreshExitOverlay()
  }

  #refreshExitOverlay(): void {
    const btn = this.#exitOverlay
    if (!btn) return
    const i18n = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
    const hexagons = i18n?.t('site-exit.hexagons') ?? 'Show this page\'s hexagons'
    btn.textContent = this.#exitPeek ? 'hexagon' : (this.#siteIcon || 'grid_view')
    btn.title = this.#exitPeek
      ? hexagons
      : `${i18n?.t('site-exit.label') ?? 'Exit website'}\n${i18n?.t('site-exit.hint') ?? 'Ctrl-click: show this page\'s hexagons'}`
    btn.setAttribute('aria-label', this.#exitPeek ? hexagons : (i18n?.t('site-exit.label') ?? 'Exit website'))
    this.#placeExitOverlay(this.#mount?.host)
  }

  /** Seat the button in the SITE's corner, not the viewport's: clear of a
   *  docked panel's reservation and of the host's own scrollbar, so it never
   *  sits on the page's scroll thumb. */
  #placeExitOverlay(host: HTMLElement | undefined): void {
    const btn = this.#exitOverlay
    if (!btn) return
    const gutter = host?.isConnected ? Math.max(0, host.offsetWidth - host.clientWidth) : 0
    btn.style.right = `calc(var(--hc-inset-right, 0px) + ${gutter}px + 0.75rem + env(safe-area-inset-right, 0px))`
    this.#textEditor?.place(btn.style.right)
    this.#versions?.place(btn.style.right)
  }

  /** Exit the website straight back to WHERE IT WAS SPAWNED FROM — no
   *  intermediate websites-directory step. Flipping ViewMode is the whole
   *  exit: the mode-change handler restores both halves of the spawn, the
   *  view that was up and the page it was up on, wherever the reader browsed
   *  inside the site. A PEEL (Ctrl/⌘-click) skips the spawn: the reader stays
   *  on the page they are reading and sees its hexagons. view.bee's arrival
   *  latch already holds this address, so the site's default mark does not
   *  reopen it under them. */
  #exitToHive(peel = false): void {
    const ioc = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
    this.#peelHere = peel
    try {
      ioc?.get<{ setMode(m: string): void }>('@hypercomb.social/ViewMode')?.setMode('hexagons')
    } finally { this.#peelHere = false }
  }

  #removeExitOverlay(): void {
    if (this.#exitOverlay) {
      this.#exitOverlay.remove()
      this.#exitOverlay = null
      window.removeEventListener('keydown', this.#peekExit, true)
      window.removeEventListener('keyup', this.#peekExit, true)
      window.removeEventListener('blur', this.#peekExit)
      this.#exitOver = false
      this.#exitPeek = false
    }
  }

  // ── feature-verification gate ──────────────────────────────────────────

  /** The publisher domain attributed to a page sig (learned from the mesh /
   *  adopt hand-off via the broker's address graph). Empty when unknown —
   *  which, for adopted content, the gate treats as "not trusted" (fail-closed:
   *  unknown-origin foreign code stays inert until reviewed). */
  /** Show the review gate over a foreign, unverified page INSTEAD of mounting
   *  it. The page never enters the document, so its scripts don't run and its
   *  resources don't stream. The "Review & enable" action hands the page sig to
   *  the features panel (`feature:review:open`), where the participant reviews
   *  the code and accepts — which writes the verified sig and re-reconciles. */
  #showReviewGate(segments: readonly string[], sig: string): void {
    this.#ensureExitOverlay()   // keep the guaranteed way back to the hive
    let card = this.#reviewOverlay
    if (!card) {
      card = document.createElement('div')
      card.id = 'hc-feature-review'
      card.style.cssText = REVIEW_GATE_CSS
      const i18n = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
      const title = document.createElement('div')
      title.style.cssText = 'font-size:1.25rem;font-weight:600;color:#eaf3f9'
      title.textContent = i18n?.t('review-gate.title') ?? 'Feature not enabled'
      const body = document.createElement('div')
      body.style.cssText = 'max-width:34rem;line-height:1.5;opacity:.85'
      body.textContent = i18n?.t('review-gate.body') ?? 'This page comes from another participant and has not been reviewed. Review its code, then enable it — nothing runs until you do.'
      const review = document.createElement('button')
      review.type = 'button'
      review.className = 'hc-review-btn'
      review.textContent = i18n?.t('review-gate.action') ?? 'Review & enable'
      review.style.cssText = 'margin-top:.5rem;padding:.6rem 1.2rem;border:1px solid rgba(126,182,214,.6);border-radius:var(--hc-radius-control, 2px);background:rgba(126,182,214,.16);color:#eaf3f9;cursor:pointer;font-size:.95rem'
      card.append(title, body, review)
      document.body.appendChild(card)
      this.#reviewOverlay = card
    }
    const btn = card.querySelector('.hc-review-btn') as HTMLButtonElement | null
    if (btn) btn.onclick = () => this.emitEffect('feature:review:open', {
      cell: segments[segments.length - 1] ?? '',
      segments: [...segments],
      sig,
      kind: 'website',
      label: this.#siteLabel || 'Website',
    })
  }

  /** The page stays a resource. This card opens it on its own origin. */
  #showTrial(
    sig: string,
    label: string,
    store: { getResource: (sig: string) => Promise<Blob | null> },
  ): void {
    this.#ensureExitOverlay()
    const base = trialBase(label)
    const origin = trialOrigin(base)
    let card = this.#trialOverlay
    if (!card) {
      card = document.createElement('div')
      card.id = 'hc-page-trial'
      card.style.cssText = REVIEW_GATE_CSS
      const title = document.createElement('div')
      title.style.cssText = 'font-size:1.25rem;font-weight:600;color:#eaf3f9'
      title.textContent = 'This page is a trial'
      const body = document.createElement('div')
      body.style.cssText = 'max-width:34rem;line-height:1.5;opacity:.85'
      body.dataset['trialBody'] = '1'
      const open = document.createElement('button')
      open.type = 'button'
      open.className = 'hc-trial-open'
      open.textContent = 'Line them up'
      open.style.cssText = 'margin-top:.5rem;padding:.6rem 1.2rem;border:1px solid rgba(126,182,214,.6);border-radius:var(--hc-radius-control, 2px);background:rgba(126,182,214,.16);color:#eaf3f9;cursor:pointer;font-size:.95rem'
      const versions = document.createElement('div')
      versions.className = 'hc-trial-versions'
      versions.style.cssText = 'display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.4rem'
      const bring = document.createElement('button')
      bring.type = 'button'
      bring.className = 'hc-trial-home'
      bring.style.cssText = open.style.cssText
      card.append(title, body, open, versions, bring)
      document.body.appendChild(card)
      this.#trialOverlay = card
    }
    const body = card.querySelector('[data-trial-body]')
    const home = pageHome()
    const place = home.where === 'localhost' ? 'localhost' : home.name
    if (body) body.textContent = `Versions of this page line up at ${origin}. Each version is its own origin from the same pool, so each one has its own memory. Bringing the page into ${place} is your decision.`
    const paintVersions = async (): Promise<void> => {
      const row = card?.querySelector('.hc-trial-versions')
      if (!row) return
      const pool = await listTrialVersions(base)
      row.replaceChildren()
      for (const version of pool.versions) {
        const name = trialVersionLabel(base, version)
        if (!name) continue
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'hc-trial-version'
        button.textContent = `v${version}`
        button.style.cssText = 'padding:.35rem .7rem;border:1px solid rgba(126,182,214,.6);border-radius:var(--hc-radius-control, 2px);background:transparent;color:#eaf3f9;cursor:pointer;font-size:.85rem'
        button.onclick = () => { window.open(`${trialOrigin(name)}/`, '_blank', 'noopener,noreferrer') }
        row.append(button)
      }
    }
    void paintVersions()
    const open = card.querySelector('.hc-trial-open') as HTMLButtonElement | null
    if (open) open.onclick = () => {
      void (async () => {
        const blob = await store.getResource(sig).catch(() => null)
        const staged = blob ? await stageTrial(label, await blob.text()) : { ok: false, version: null, label: base }
        if (!staged.ok && body) body.textContent = `This hive did not take the page, so ${origin} has nothing to show. Reload the hive and open the sandbox again.`
        if (!staged.ok) return
        await paintVersions()
        window.open(`${origin}/`, '_blank', 'noopener,noreferrer')
      })()
    }
    const bring = card.querySelector('.hc-trial-home') as HTMLButtonElement | null
    if (bring) {
      bring.textContent = `Bring it into ${place}`
      bring.onclick = (event) => {
        if (!event.isTrusted) return
        if (!window.confirm(`Bring this page into ${place}? It will run there.`)) return
        if (!releaseTrial(sig)) return
        void this.#reconcile()
      }
    }
  }

  #removeTrial(): void {
    if (this.#trialOverlay) {
      this.#trialOverlay.remove()
      this.#trialOverlay = null
    }
  }

  #removeReviewGate(): void {
    if (this.#reviewOverlay) {
      this.#reviewOverlay.remove()
      this.#reviewOverlay = null
    }
  }

  /** Hand the hive's chrome back to its OWNERS after a website session, instead
   *  of trusting the mount's snapshot alone.
   *
   *  A page stamps two things the hive also owns: `<html data-theme>` (its own
   *  light/dark choice, written raw by its pre-paint script and its in-page
   *  toggle) and an inline background on `<html>`/`<body>`. unmount() reverts
   *  what it snapshotted, but a snapshot is only as good as the moment it was
   *  taken — it can't cover a stamp that lands after unmount (a page script
   *  firing late, a toggle handler still bound to a detached node), a session
   *  where no mount was ever up, or a longhand the site set that the hive
   *  didn't. And the miss is loud rather than subtle: the base token set is the
   *  LIGHT one (dark is the `[data-theme="dark"]` override), and the canvas
   *  backdrop's auto palette reads that same attribute — so a leftover `light`
   *  turns the whole hive cream and repaints the backdrop in `daylight`.
   *
   *  So both owners re-assert from their own truth: the theme service re-applies
   *  the participant's stored theme, and the canvas backdrop repaints. Called on
   *  every reconcile in hexagons mode, so any drift heals on the next
   *  navigation, not just on the exit that caused it. The repaint is the only
   *  non-trivial part, so it runs only when the theme actually drifted or a page
   *  was just torn down. */
  #restoreHiveChrome(repaint: boolean): void {
    const ioc = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
    // Structural shape, not ThemeProvider: reassert() is optional on the
    // contract, so a module built against an older shell still resolves the
    // service and simply finds nothing to call.
    const drifted = ioc?.get<{ reassert?: () => boolean }>(THEME_IOC_KEY)?.reassert?.() ?? false
    if (!drifted && !repaint) return
    ioc?.get<{ apply?: () => void }>('@diamondcoreprocessor.com/CanvasBackground')?.apply?.()
  }

  #teardown(): void {
    this.#removeTrial()
    if (this.#mount) {
      try { this.#mount.unmount() } catch { /* noop */ }
      this.#mount.host.remove()
      this.#mount = null
    }
    if (this.#viewActive) this.#setViewActive(false)
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    // Owner-counted, not a raw boolean: a modal/photo closing on top of this
    // view must not unhide the chrome while this view is still open
    // (see navigation/mode-registry.service.ts).
    const modes = window.ioc.get('@diamondcoreprocessor.com/ModeRegistry') as
      { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void } | undefined
    if (active) modes?.enter('view:active', 'site-view')
    else modes?.exit('view:active', 'site-view')
  }

  /**
   * True only when the cell at `segments` is DEFINITELY page-less: its layer
   * resolves but carries no mountable page in any of the three slots (the
   * first-class `website` slot, a `visual:website:page` decoration, or a
   * legacy `context` page). Returns false when we can't tell —
   * no store/history, or the layer doesn't resolve (cold cache / not yet
   * committed) — so a momentary cold read never blocks a valid link; only a
   * confirmed dead-end is. Powers the #navigate guard below.
   */
  async #isDefinitelyPageless(segments: readonly string[]): Promise<boolean> {
    const store = this.resolve<any>('store')
    const history = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{
      sign: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
      currentLayerAt: (sig: string) => Promise<unknown | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!store?.getResource || !history) return false
    const locSig = await history.sign({ explorerSegments: () => segments }).catch(() => null)
    if (!locSig) return false
    const layer = await history.currentLayerAt(locSig).catch(() => null)
    if (!layer) return false   // unresolved (cold/missing) — don't block
    // The SAME three-slot lookup #reconcile mounts with — the first-class
    // `website` slot included. Omitting it judged a slot-only page a dead end,
    // so the guard below silently swallowed every in-site link to a migrated
    // cell.
    let pageSig = await this.#findWebsitePage(segments)
    if (!pageSig) pageSig = await this.#findDecorationPage(segments, store)
    if (!pageSig) pageSig = await this.#findContextPage(segments, store)
    return !pageSig            // layer present but no page → confirmed dead-end
  }

  /**
   * Does the cell at `segments` have a mountable page in any slot? The
   * positive counterpart to {@link #isDefinitelyPageless}, used to pick the
   * right reading of an ambiguous link. Cold / unresolved layers report false
   * (we can't confirm a page), so a momentarily-cold candidate is simply not
   * preferred over a warm one — never a false positive.
   */
  async #hasPage(segments: readonly string[]): Promise<boolean> {
    return !!(await this.resolvePageSig(segments))
  }

  /**
   * Resolve an internal href against the site's OWN place in the hive, then
   * navigate. This is the fix for links that ignore their position in the
   * hierarchy: the gen skill is *supposed* to emit full absolute paths
   * (`/dolphin/about`), but pages routinely carry site-relative links
   * (`/about`, `/`) or bare child names — and a path read blindly from the
   * hive root lands on a cell that doesn't exist and renders a blank "new
   * place." We build a few hierarchy-aware candidates and take the FIRST that
   * actually has a page; the literal reading stays the head candidate so
   * well-formed full-path links never regress, and the fallback at the end
   * keeps a click from being silently swallowed.
   *
   *   `..`        → up one level, never above the site-entry floor.
   *   `/a/b`      → [a,b] from the hive root (documented wire form), else
   *                 [...siteRoot, a, b] (site-relative: `/about` → the site's
   *                 own about page; `/` → the site home, not the hive root).
   *   `a/b` `./x` → [...here, a, b] (child), else [...parent, a, b] (sibling),
   *                 else [...siteRoot, a, b] (site-relative).
   */
  async #resolveAndNavigate(href: string, segments: readonly string[]): Promise<void> {
    const entry = this.#siteEntrySegments ?? []

    if (href === '..' || href === '../') {
      // The same climb as the menu's Up one level — `..` at or below the site
      // root is a no-op (we don't eject back to hexagons, only block nav past
      // root), and an empty parent is passed over for the page above it.
      await this.#navigateUp(segments, entry)
      return
    }

    let candidates: string[][]
    if (href.startsWith('/')) {
      const parts = href.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
      candidates = [
        parts,                  // absolute from the hive root (documented form)
        [...entry, ...parts],   // site-relative: under the site's own root
      ]
    } else {
      const parts = href.replace(/^\.\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean)
      candidates = [
        [...segments, ...parts],               // child (documented relative form)
        [...segments.slice(0, -1), ...parts],  // sibling
        [...entry, ...parts],                  // site-relative
      ]
    }

    // De-dupe (entry === [] collapses site-relative onto absolute, etc.), then
    // take the first candidate that DEFINITELY has a page.
    const seen = new Set<string>()
    const uniq = candidates.filter(c => {
      const k = c.join('\u0000')
      if (seen.has(k)) return false
      seen.add(k); return true
    })
    for (const c of uniq) {
      if (await this.#hasPage(c)) { await this.#navigate(c); return }
    }
    // Nothing resolves to a page — navigate the literal reading. #navigate's
    // own dead-end guard still keeps us off a confirmed page-less cell.
    if (uniq[0]) await this.#navigate(uniq[0])
  }

  /** Up from `from` to the nearest page above it, never above `floor`. A cell
   *  that resolves with no page is passed over; a cold or unresolved read is
   *  tried, the same benefit of the doubt #navigate gives. At the floor this
   *  does nothing. */
  async #navigateUp(from: readonly string[], floor: readonly string[]): Promise<void> {
    for (let n = from.length - 1; n >= floor.length; n--) {
      const at = from.slice(0, n)
      if (await this.#isDefinitelyPageless(at)) continue
      await this.#navigate(at)
      return
    }
  }

  async #navigate(path: readonly string[]): Promise<void> {
    const lineage = this.resolve<any>('lineage')
    if (!lineage) return

    // Never strand the user on a page-less node. In website mode a cell with no
    // page renders NOTHING — a click that lands there tears the site down to a
    // blank "empty website mode" screen. If the destination is definitely
    // page-less (its layer resolves but has no page), ignore the navigation and
    // stay on the current page. Uses the same page resolution #reconcile mounts
    // with, so the guard and the eventual mount never disagree; a cold/
    // unresolved read is never treated as page-less, so valid links still work.
    if (await this.#isDefinitelyPageless(path)) return

    // Tile selections live in `window.location.hash`. They're a hex-
    // mode feature — selecting tiles to act on. In website mode the
    // hash has no consumer and just sticks around as a stale "#" in
    // the address bar through every navigation (Navigation.go reads
    // `window.location.hash` and re-appends it on every push). Strip
    // it here before the lineage steps so the cleaned URL is what
    // gets pushed.
    if (window.location.hash) {
      try {
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
      } catch { /* private mode / older browser — non-fatal */ }
    }

    const next = [...path]

    // A move between pages of THIS site keeps the website up through the
    // arrival — an ancestor page is not a retreat out of the site, and the
    // hexagons must never flash between two pages (view.bee holdSurfaceOnce).
    // A move above the site's entry leaves it, as walking out does. The page
    // joins the trail the back gesture steps along.
    const here: string[] = [...(lineage.explorerSegments?.() ?? [])]
    const entry = this.#siteEntrySegments
    const vmNow = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<{ mode: string }>('@hypercomb.social/ViewMode')
    if (vmNow?.mode === 'website' && entry && !sameSiteSegments(next, here)
      && next.length >= entry.length && entry.every((seg, i) => next[i] === seg)) {
      ;(window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
        ?.get<{ holdSurfaceOnce?: () => void }>('@diamondcoreprocessor.com/ViewBee')?.holdSurfaceOnce?.()
      this.#movedInSite = true
    }

    // Reading a site is not tile navigation. Move the explorer in ONE step
    // that REPLACES the history entry, so browsing a site never grows the
    // browser back-stack — the whole session collapses back to where it stood
    // when the site was opened (see Lineage.explorerReplace). The per-segment
    // enter/up walk stays as the fallback for a shell without it.
    if (typeof lineage.explorerReplace === 'function') {
      lineage.explorerReplace(next)
      return
    }

    const current: string[] = [...(lineage.explorerSegments?.() ?? [])]
    let common = 0
    while (common < current.length && common < next.length && current[common] === next[common]) common++
    for (let i = 0; i < current.length - common; i++) lineage.explorerUp?.()
    for (let i = common; i < next.length; i++) lineage.explorerEnter?.(next[i])
  }

}

// ──────────────────────────────────────────────────────────────────────────
// Per-cell page ref rewrite. Resource and bare-sig src/href references
// are rewritten to `/@resource/<sig>`. No manifest-keyed `asset:<name>`
// lookup — per-cell pages reference resources directly by sig.
// ──────────────────────────────────────────────────────────────────────────

/** Copy to the clipboard. Rejects when the browser will not, so the menu never
 *  says Copied for nothing. */
function copyText(text: string): Promise<void> {
  const clipboard = navigator.clipboard
  if (!clipboard?.writeText) return Promise.reject(new Error('no clipboard'))
  return clipboard.writeText(text)
}

/** The link under the press, if any, read the way the page's click handler
 *  reads it. `outside` is a real address — absolute http(s), mail, phone,
 *  protocol-relative, or a resource the host serves — and null for an in-site
 *  route (resolved against the site, so its href is no address). An empty,
 *  data: or javascript: href is the browser's and is no link here at all.
 *  composedPath reaches into a seated part's shadow root. */
function linkAt(e: MouseEvent): { outside: string | null } | null {
  for (const node of e.composedPath()) {
    if (!(node instanceof HTMLAnchorElement) || !node.hasAttribute('href')) continue
    const href = node.getAttribute('href') ?? ''
    if (!href || /^(data:|javascript:)/i.test(href)) return null
    if (href.startsWith('//') || href.startsWith(RESOURCE_URL_PREFIX) || /^blob:/i.test(href)) return { outside: node.href }
    return { outside: /^(https?:|mailto:|tel:)/i.test(href) ? href : null }
  }
  return null
}

function rewriteCellPageRefs(text: string): string {
  // The rewrite shares its ref patterns with the closure walk's
  // `extractPageRefSigs` (both in decoration-closure.ts), so the set of
  // resources the renderer resolves can never diverge from the set the
  // host-push / adopt closure carries — divergence would mean missing images
  // on an imported machine.
  return rewritePageRefs(text, RESOURCE_URL_PREFIX)
}

const _siteView = new SiteViewDrone()
window.ioc.register('@diamondcoreprocessor.com/SiteViewDrone', _siteView)

// A page's own scripts may ask the hive for its Pixi and `@pixi/3d` rather
// than carry their own (the cigar lounge does: scripts/lounge3d/bundle-lounge.ts).
// This frame runs those scripts and is always awake, so it is the one that
// lends — and the room's tile frame (lounge-view.drone.ts) borrows the same.
window.ioc.register(PIXI3D_LENDER_KEY, new Pixi3DLender())
