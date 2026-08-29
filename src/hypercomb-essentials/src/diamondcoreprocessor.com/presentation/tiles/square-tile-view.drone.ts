// The SQUARE TILE VIEW — a bright page built from the layer.
//
// The marked cell's CHILDREN are the elements of the page: each child tile
// is a square plate — warm ivory paper, espresso ink, gold hairlines — laid
// out as a clean centred gallery grid. Every element visible at once,
// obviously clickable, nothing floating and nothing to learn: hovering
// lifts a plate, stepping through one is a plain NAVIGATION — the arrival
// system opens whatever face the destination resolves to (its own
// `view:default` mark, else the branch's). This drone renders exactly ONE
// layer; children are doorways. Depth is garnish here — soft shadows, a
// staggered entrance — never a scene the visitor has to navigate.
//
// No dependencies, no canvases, no fetching beyond the hive's own
// sig-addressed tile art. Born as the Revolución welcome threshold;
// promoted first-class 2026-08-23 (see square-tile-view.queen.ts for the
// legacy-name aliases). Earlier concepts are recorded in the behaviour's
// hive notes: the dark colonnade hid the layer, the dark 3D wall read as
// heavy — the interface is light now, in both senses.

import { Drone, EffectBus } from '@hypercomb/core'
import { titleForLabel, kindsForLabel } from '../../commands/decoration-kind-index.js'
import { isFeatureHiddenWithin } from '../../sharing/feature-hidden.js'
import { isBehaviorDormant } from '../../sharing/behavior-enablement.js'
import { listDecorations } from '../../commands/decoration-manifest.js'
import { readTilePropertiesAt, tilePictureCandidates } from '../../editor/tile-properties.js'
import { resolveLocalResourceReference } from './local-resource-reference.js'
import { childNamesOf, type PlacementHistory, type PlacementLayer } from '../../history/layer-placement.js'
import { trackScrollGutter } from './scroll-gutter.js'
import { readTileBrief, type TileBrief } from './tile-brief.js'
import {
  buildTileBriefPanel, TILE_BRIEF_CSS,
  type BriefPanelOptions, type BriefSibling,
} from './tile-brief-panel.js'
import {
  SQUARE_TILE_KIND, SQUARE_TILE_VIEW, LEGACY_WELCOME_KIND,
  type SquareTilePayload,
} from '../../commands/square-tile-view.queen.js'
import type { BackGesture } from '../../navigation/back-gesture.service.js'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
type NavigationShape = { goRaw(segments: readonly string[]): void }
type NotesWriteShape = {
  notesFor(label: string): readonly unknown[]
  addAtSegments(
    parentSegments: readonly string[], cellLabel: string, text: string,
  ): Promise<void>
}
type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
}
type StoreShape = {
  getResource(sig: string): Promise<Blob | null>
  getResourceLocal?(sig: string): Promise<Blob | null>
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
}
const SIG_RE = /^[0-9a-f]{64}$/

interface PanelData { label: string; title: string; imageUrl: string | null }

/** Everything the PAGE-scale brief needs, gathered while the sheet is being
 *  built. Present only when the layer has no children — a leaf is not an
 *  empty page; it is its own brief, at full size, with the row it sits on
 *  along the foot so it is never a dead end. */
interface PageData {
  brief: TileBrief
  imageUrl: string | null
  siblings: BriefSibling[]
}

/** How long a finger must rest on a plate to turn its corner. Touch has no
 *  hover, so the hold is what the dog-ear is on a pointer device. */
const HOLD_MS = 420
const HOLD_SLOP_PX = 10

const revokeAll = (urls: readonly string[]): void => {
  for (const url of urls) URL.revokeObjectURL(url)
}

export class SquareTileViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Square tile view renderer — the marked cell opens as a bright page whose square plates are its children.'

  #host: HTMLElement | null = null
  #targetSegments: string[] | null = null
  #bound = false
  #active = false
  #gen = 0
  /** Unregisters the right-click way out (back-gesture.service.ts). */
  #backOff: (() => void) | null = null
  /** Stops the scrollbar-width tracker that keeps the × clear of the sheet's
   *  own scrollbar (scroll-gutter.ts). */
  #gutterOff: (() => void) | null = null
  /** Object URLs handed to the plates — process-wide until revoked. */
  #objectUrls: string[] = []
  /** Whose corner is turned down. A plate's label, `''` for the page's own
   *  brief (the crest's fold), null for none. Survives a rebuild so a
   *  decoration or a note landing under an open card does not shut it. */
  #briefLabel: string | null = null
  /** The open spread's element, so closing it does not touch the plates. */
  #briefPanel: HTMLElement | null = null
  /** Generation of the in-flight brief read — a second fold turned while the
   *  first is still reading must not paint over the second. */
  #briefGen = 0

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#change)
      window.addEventListener('keydown', this.#key, true)
      // A REAL RENDERER FOLLOWS THE LINEAGE. The plate click is the same
      // click a hexagon gets — navigate, nothing more — so when the
      // destination's own face is this same view, no mode change and no
      // suggestion ever fires: the lineage moving IS the render trigger.
      // (#targetSegments was the pre-navigation override; once the lineage
      // has moved, the lineage is the truth.)
      window.ioc?.get<EventTarget>('@hypercomb.social/Lineage')
        ?.addEventListener?.('change', this.#lineageChange)
      this.onEffect('decorations:changed', this.#change)
      this.onEffect('feature:hidden', this.#change)
      this.onEffect('feature:restored', this.#change)
      // A note written on this page is one of the things the page SHOWS, so
      // the sheet is one of the surfaces that has to hear about it.
      this.onEffect('notes:changed', this.#change)
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', payload => {
        if (payload?.view !== SQUARE_TILE_VIEW) return
        this.#targetSegments = (payload.segments ?? []).map(String).filter(Boolean)
        this.#vm()?.setMode(SQUARE_TILE_VIEW)
        void this.#reconcile()
      })
      // Right-click is the way out, the same as Escape — the entry is keyed
      // by this view's `view:active` owner, so it only answers while the
      // page is actually up.
      this.#backOff = window.ioc?.get<BackGesture>('@diamondcoreprocessor.com/BackGesture')
        ?.register({
          owner: 'square-tile-view',
          // Same ladder as Escape: the way out of an open card is the card,
          // and only then the way out of the sheet.
          back: () => {
            if (this.#briefPanel && this.#briefLabel) this.#closeBrief()
            else this.#vm()?.setMode('hexagons')
          },
        }) ?? null
      this.#bound = true
    }
    await this.#reconcile()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#change)
    window.ioc?.get<EventTarget>('@hypercomb.social/Lineage')
      ?.removeEventListener?.('change', this.#lineageChange)
    window.removeEventListener('keydown', this.#key, true)
    this.#backOff?.()
    this.#backOff = null
    this.#teardown()
  }

  readonly #change = (): void => { void this.#reconcile() }
  readonly #lineageChange = (): void => {
    this.#targetSegments = null
    // A new place is a new card. Whatever was turned down belonged to the
    // layer we just left.
    this.#briefLabel = null
    void this.#reconcile()
  }
  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.#vm()?.mode !== SQUARE_TILE_VIEW) return
    event.preventDefault()
    event.stopImmediatePropagation()
    // ESCAPE UNDOES THE LAST THING DONE. An open card is a step in, so it is
    // the step Escape takes back — the sheet only closes once nothing is
    // turned down. (The page's own brief IS the sheet; there is nothing to
    // fold back there, so Escape leaves.)
    if (this.#briefPanel && this.#briefLabel) { this.#closeBrief(); return }
    this.#vm()?.setMode('hexagons')
  }

  #vm(): ViewModeShape | undefined {
    return window.ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  async #reconcile(): Promise<void> {
    const gen = ++this.#gen
    if (this.#vm()?.mode === SQUARE_TILE_VIEW) { await this.#mount(gen); return }
    this.#targetSegments = null
    this.#teardown()
  }

  async #mount(gen: number): Promise<void> {
    const lineage = window.ioc?.get<LineageShape>('@hypercomb.social/Lineage')
    const segments = this.#targetSegments ?? [...(lineage?.explorerSegments?.() ?? [])]
    // isBehaviorDormant, not raw isKindGloballyOff: the published visitor
    // shell is a cold install whose roster starts DARK, and there publishing
    // the mark IS the enablement — the dormancy check carries that exception,
    // the raw roster read does not (a raw read blanks the whole site).
    // Hidden reach matches the view's BRANCH scope: a hide at the marked
    // root silences the view all the way down, same as view.bee's gate.
    if (isBehaviorDormant(SQUARE_TILE_KIND, segments) || await isFeatureHiddenWithin(segments, SQUARE_TILE_KIND)) {
      this.#targetSegments = null
      this.#teardown()
      this.#vm()?.setMode('hexagons')
      return
    }

    // Payload (title/tagline) — current kind first, retired kind as the
    // read fallback for marks written before the rename.
    let records = await listDecorations<SquareTilePayload>({ kind: SQUARE_TILE_KIND, segments })
    if (!records.length) {
      records = await listDecorations<SquareTilePayload>({ kind: LEGACY_WELCOME_KIND, segments })
    }
    if (gen !== this.#gen || this.#vm()?.mode !== SQUARE_TILE_VIEW) return
    const payload = records.at(-1)?.record.payload
    const label = segments.at(-1) ?? ''
    const title = payload?.title
      || (label ? titleForLabel(label, navigator.language) || label : 'Welcome')

    // The plates' bytes are handed over as object URLs, so this pass's URLs
    // are collected apart from the live set and only adopted AFTER the old
    // host is torn down — teardown revokes what it owns, and revoking a URL
    // the new plates are about to use would blank the page it just built.
    const fresh: string[] = []
    const panels = await this.#panels(segments, fresh)
    // NO EMPTY PAGES. A layer with nothing behind it is where the sheet has
    // the most room and the least excuse: the tile's own brief takes the
    // whole page, and the row it sits on runs along the foot.
    const pageData = panels.length || !segments.length
      ? null
      : await this.#pageData(segments, fresh)
    if (gen !== this.#gen || this.#vm()?.mode !== SQUARE_TILE_VIEW) { revokeAll(fresh); return }

    this.#teardown()
    this.#objectUrls = fresh
    this.#host = this.#build(title, payload?.tagline ?? '', segments, panels, pageData)
    document.body.appendChild(this.#host)
    // The sheet scrolls, so on Windows it wears a real scrollbar — measure it
    // and let the × step aside by that much (see scroll-gutter.ts).
    this.#gutterOff = trackScrollGutter(this.#host)
    this.#setActive(true)
    // Whatever was open before this pass is opened again — the card is the
    // participant's reading position, and a rebuild is not a decision to
    // close it. A plate that has since gone stays closed (#openBrief checks).
    if (this.#briefLabel !== null && !pageData) void this.#openBrief(this.#briefLabel)
  }

  /** The layer's children, in layer order — the elements of the page. */
  async #panels(segments: readonly string[], sink: string[]): Promise<PanelData[]> {
    const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return []
    let labels: string[] = []
    try {
      const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => [...segments] }))
      if (layer) labels = await childNamesOf(history as unknown as PlacementHistory, layer as unknown as PlacementLayer)
    } catch { /* no layer here */ }
    return Promise.all(labels.map(async child => ({
      label: child,
      title: titleForLabel(child, navigator.language) || child,
      imageUrl: await this.#tileImageUrl([...segments, child], sink),
    })))
  }

  async #tileImageUrl(segments: readonly string[], sink: string[]): Promise<string | null> {
    const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const store = window.ioc?.get<StoreShape>('@hypercomb.social/Store')
    if (!history || !store || segments.length === 0) return null
    try {
      const props = await readTilePropertiesAt(segments.slice(0, -1), segments[segments.length - 1])
      // The PICTURE, not the hex capture: a plate is a rectangle, and the
      // capture carries the hexagon's crop — and, on anything saved
      // through the tile editor before the frame stopped being baked, the
      // gold hex stroke straight across the middle of the image.
      //
      // The original has to be one we actually HOLD. A tile can name an
      // original it does not have (adoption carries the props blob, not
      // the heavy bytes), and a plate showing a broken image is worse
      // than a plate showing a framed one — so take the first candidate
      // whose bytes are here, and hand the browser those bytes rather
      // than making it fetch them a second time through /@resource/.
      // Local reads only: sixteen plates must not each wait on the host.
      for (const sig of tilePictureCandidates(props)) {
        const bytes = store.getResourceLocal
          ? await resolveLocalResourceReference(store as StoreShape & { getResourceLocal(sig: string): Promise<Blob | null> }, sig)
          : await store.getResource(sig)
        if (!bytes || bytes.size === 0) continue
        const url = URL.createObjectURL(bytes)
        sink.push(url)
        return url
      }
      return null
    } catch { return null }
  }

  // ── The page ─────────────────────────────────────────────────────────

  #build(
    title: string,
    tagline: string,
    segments: readonly string[],
    panels: PanelData[],
    pageData: PageData | null,
  ): HTMLElement {
    const host = document.createElement('section')
    host.className = 'hc-square-tile-view'
    host.innerHTML = `<style>${SCENE_CSS}${TILE_BRIEF_CSS}</style>`
    // The page scrolls like a page; the hex wheel-zoom handler must not
    // preventDefault our wheel events (same hatch the site view uses).
    host.setAttribute('data-consumes-wheel', '')

    const sheet = document.createElement('div')
    sheet.className = 'wv-sheet'
    host.appendChild(sheet)

    const crest = document.createElement('header')
    crest.className = 'wv-crest'
    const heading = document.createElement('h1')
    heading.className = 'wv-title'
    heading.textContent = title
    crest.appendChild(heading)
    const rule = document.createElement('div')
    rule.className = 'wv-rule'
    crest.appendChild(rule)
    if (tagline) {
      const sub = document.createElement('p')
      sub.className = 'wv-tagline'
      sub.textContent = tagline
      crest.appendChild(sub)
    }
    // THE PAGE'S OWN CORNER. Every place carries writing, behaviours and
    // pheromones of its own — including the one you are standing in — so the
    // crest turns down the same way a plate does. On a leaf the brief IS the
    // page already; there is nothing left to turn.
    if (!pageData) crest.appendChild(this.#fold('', this.#t('square-tile.fold.page', 'what this place carries')))
    sheet.appendChild(crest)

    const grid = document.createElement('main')
    grid.className = 'wv-grid'
    panels.forEach((panel, index) => {
      const plate = document.createElement('button')
      plate.type = 'button'
      plate.className = 'wv-plate'
      plate.style.setProperty('--i', String(index))
      plate.title = panel.title
      const mat = document.createElement('span')
      mat.className = 'wv-mat'
      if (panel.imageUrl) {
        const img = document.createElement('img')
        img.className = 'wv-art'
        img.src = panel.imageUrl
        img.alt = ''
        img.draggable = false
        mat.appendChild(img)
      } else {
        const blank = document.createElement('span')
        blank.className = 'wv-art wv-art-blank'
        mat.appendChild(blank)
      }
      plate.appendChild(mat)
      const caption = document.createElement('span')
      caption.className = 'wv-caption'
      caption.textContent = panel.title
      plate.appendChild(caption)
      plate.onclick = () => this.#enter([...segments, panel.label])
      // The plate is a doorway; the CORNER is the card. A hexagon has no
      // back, so the band crowds its icons around the rim — a plate has one,
      // and turning it costs no navigation, which is the whole point: the
      // single click still goes where it always went.
      const fold = this.#fold(panel.label, this.#t('square-tile.fold.tile', 'turn the corner'))
      if (this.#carries(panel.label)) fold.setAttribute('data-carries', '')
      plate.appendChild(fold)
      this.#bindHold(plate, panel.label)
      grid.appendChild(plate)
    })
    sheet.appendChild(grid)

    // THE LEAF IS NOT AN EMPTY PAGE. Where there is nothing behind the tile,
    // what the tile IS takes the sheet: its lists, its notes, the behaviours
    // it carries, its pheromones, and the row it sits on.
    if (pageData) {
      const page = buildTileBriefPanel(pageData.brief, this.#briefOptions(pageData.brief, {
        scale: 'page',
        imageUrl: pageData.imageUrl,
        siblings: pageData.siblings,
      }))
      sheet.appendChild(page)
    }

    // The foot line is for a page of plates. Where the brief has the sheet, it
    // has already said what this place is, in its own first line.
    if (!pageData) {
      const hint = document.createElement('p')
      hint.className = 'wv-hint'
      hint.textContent = panels.length
        ? this.#t('square-tile.hint.step', 'step through a plate · turn a corner to read one')
        : this.#t('square-tile.hint.leaf', 'the end of this branch')
      sheet.appendChild(hint)
    }

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'wv-close'
    close.setAttribute('aria-label', 'Return to hexagons')
    close.textContent = '×'
    close.onclick = () => this.#vm()?.setMode('hexagons')
    host.appendChild(close)

    return host
  }

  /** Step through a doorway: real navigation, nothing else. THE TILE'S
   *  CLICK IS THE TILE'S CLICK — the same one a hexagon gets — and the
   *  ARRIVAL system opens whatever face the destination resolves to: its
   *  own `view:default` mark, else the nearest ancestor's (the branch
   *  cascade). No suggestion rides along: the view must not assume the
   *  child is a website page (or anything else) — how you got there never
   *  changes what a place opens as. */
  #enter(segments: readonly string[]): void {
    window.ioc?.get<NavigationShape>('@hypercomb.social/Navigation')?.goRaw(segments)
  }

  // ── The dog-ear ──────────────────────────────────────────────────────
  //
  // ONE GESTURE, NEVER THE CLICK. The plain click still navigates, exactly as
  // it did — reaching what a tile carries must never cost you your place. The
  // corner is the second gesture: a pointer turns it down, a finger holds the
  // plate, a keyboard presses `i` on the focused plate.

  /** NOT a `<button>`: a plate IS a button, and a button inside a button is
   *  invalid — Chrome tolerates the nesting, other engines reparent it and
   *  the corner stops being clickable. A span carrying the button role is
   *  valid anywhere and reads the same to a screen reader. */
  #fold(label: string, title: string): HTMLElement {
    const fold = document.createElement('span')
    fold.className = 'wv-fold'
    fold.title = title
    fold.setAttribute('role', 'button')
    fold.setAttribute('tabindex', '0')
    fold.setAttribute('aria-label', title)
    fold.setAttribute('data-fold', label)
    const turn = (event: Event): void => {
      // The corner sits ON the plate, and the plate navigates.
      event.stopPropagation()
      event.preventDefault()
      void this.#toggleBrief(label)
    }
    fold.addEventListener('click', turn)
    fold.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      turn(event)
    })
    return fold
  }

  /** Does this tile have anything on its back? A sync, warm-cache probe — the
   *  corner is drawn standing on tiles that carry writing or a behaviour, and
   *  only appears on hover elsewhere. The same "this tile has notes" signal
   *  the hexagon band tints an icon with. */
  #carries(label: string): boolean {
    const notes = window.ioc?.get<NotesWriteShape>('@diamondcoreprocessor.com/NotesService')
    if ((notes?.notesFor?.(label)?.length ?? 0) > 0) return true
    return kindsForLabel(label).some(kind => kind.startsWith('visual:'))
  }

  /** A finger has no hover, so a rest on the plate turns its corner. Movement
   *  or a lift before the hold cancels it and leaves the click alone. */
  #bindHold(plate: HTMLElement, label: string): void {
    let timer: ReturnType<typeof setTimeout> | null = null
    let origin: { x: number; y: number } | null = null
    let held = false
    const cancel = (): void => {
      if (timer) clearTimeout(timer)
      timer = null
      origin = null
    }
    plate.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') return
      held = false
      origin = { x: event.clientX, y: event.clientY }
      timer = setTimeout(() => {
        held = true
        timer = null
        void this.#toggleBrief(label)
      }, HOLD_MS)
    })
    plate.addEventListener('pointermove', event => {
      if (!origin) return
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > HOLD_SLOP_PX) cancel()
    })
    plate.addEventListener('pointerup', cancel)
    plate.addEventListener('pointercancel', cancel)
    // The click a committed hold leaves behind would step through the very
    // plate we just opened. Capture phase, ahead of the plate's own handler.
    plate.addEventListener('click', event => {
      if (!held) return
      held = false
      event.preventDefault()
      event.stopPropagation()
    }, true)
    plate.addEventListener('keydown', event => {
      if (event.key !== 'i' && event.key !== 'I') return
      event.preventDefault()
      event.stopPropagation()
      void this.#toggleBrief(label)
    })
  }

  async #toggleBrief(label: string): Promise<void> {
    if (this.#briefLabel === label && this.#briefPanel) { this.#closeBrief(); return }
    await this.#openBrief(label)
  }

  /** Turn a corner down. `label` is a plate's; `''` is the page's own. */
  async #openBrief(label: string): Promise<void> {
    const host = this.#host
    const grid = host?.querySelector('.wv-grid')
    if (!host || !grid) return
    const segments = [...(this.#currentSegments())]
    const target = label ? [...segments, label] : segments
    if (label && !grid.querySelector(`[data-fold="${CSS.escape(label)}"]`)) {
      this.#briefLabel = null
      return
    }
    const gen = ++this.#briefGen
    // Affordances only where the band can answer: it resolves a tile by its
    // place on the CURRENT layer, which a plate has and the page itself does
    // not (you cannot be a child of yourself).
    const brief = await readTileBrief(target, { withAffordances: !!label })
    if (gen !== this.#briefGen || this.#host !== host) return

    this.#removeBriefPanel()
    this.#briefLabel = label
    const panel = buildTileBriefPanel(brief, this.#briefOptions(brief, { scale: 'spread' }))
    this.#briefPanel = panel

    if (label) {
      // OPEN THE ROW, NOT THE CELL. The card takes the full width, so it
      // lands after the LAST plate sharing this one's line — the row it came
      // from parts, the rows below step down, and nothing jumps sideways.
      const plate = grid.querySelector<HTMLElement>(`[data-fold="${CSS.escape(label)}"]`)?.closest('.wv-plate') as HTMLElement | null
      const plates = [...grid.querySelectorAll<HTMLElement>('.wv-plate')]
      const line = plate ? plates.filter(other => other.offsetTop === plate.offsetTop) : []
      const after = line.at(-1) ?? plate
      after?.insertAdjacentElement('afterend', panel)
      plate?.setAttribute('data-open', '')
    } else {
      grid.insertAdjacentElement('beforebegin', panel)
      host.querySelector('.wv-crest')?.setAttribute('data-open', '')
    }
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  #closeBrief(): void {
    this.#briefGen++
    this.#briefLabel = null
    this.#removeBriefPanel()
  }

  #removeBriefPanel(): void {
    this.#briefPanel?.remove()
    this.#briefPanel = null
    this.#host?.querySelectorAll('[data-open]').forEach(node => node.removeAttribute('data-open'))
  }

  /** The doors a brief offers, wired to this view. The two scales differ in
   *  exactly one thing: a plate's tile is addressable BY LABEL from where we
   *  stand, and the page's own tile is not — it is where we stand. */
  #briefOptions(
    brief: TileBrief,
    extra: Pick<BriefPanelOptions, 'scale' | 'imageUrl' | 'siblings'>,
  ): BriefPanelOptions {
    const page = extra.scale === 'page'
    const label = brief.label
    const parent = brief.segments.slice(0, -1)
    return {
      ...extra,
      onClose: page ? undefined : () => this.#closeBrief(),
      onEnter: brief.childCount > 0 ? () => this.#enter(brief.segments) : undefined,
      onSibling: name => this.#enter([...parent, name]),
      // The annotations window addresses a tile by label at the current
      // location — true of a plate, never of the page itself.
      onWrite: page ? undefined : () => EffectBus.emit('notes:open', { cellLabel: label }),
      onWriteInline: text => {
        const notes = window.ioc?.get<NotesWriteShape>('@diamondcoreprocessor.com/NotesService')
        void notes?.addAtSegments?.(parent, label, text)
      },
      // The panel takes an explicit path, so this is right at either scale.
      onBehaviors: () => EffectBus.emit('tile:action', {
        action: 'features', label, segments: [...brief.segments],
      }),
      onBehavior: behavior => {
        // A dormant takeover renders nothing — the mode would flip and bounce
        // straight back. Send it where the sleep is explained and woken.
        if (behavior.dormant) {
          EffectBus.emit('tile:action', { action: 'features', label, segments: [...brief.segments] })
          return
        }
        // Standing in the tile, the view is simply this layer's other face.
        // Looking at a plate, it is the tile's own `view-enter` — the same
        // door the hexagon band opens, so in-place and navigating views are
        // told apart in exactly one place (visual-bee-icons.ts).
        if (page) this.#vm()?.setMode(behavior.view)
        else EffectBus.emit('tile:action', { action: `view-enter:${behavior.view}`, label })
      },
    }
  }

  /** Everything the page-scale brief needs: the tile itself, its picture, and
   *  the row it sits on. */
  async #pageData(segments: readonly string[], sink: string[]): Promise<PageData | null> {
    const brief = await readTileBrief(segments)
    const label = segments.at(-1) ?? ''
    const parent = segments.slice(0, -1)
    const imageUrl = await this.#tileImageUrl(segments, sink)
    const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    let names: string[] = []
    if (history) {
      try {
        const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => [...parent] }))
        if (layer) {
          names = await childNamesOf(history as unknown as PlacementHistory, layer as unknown as PlacementLayer)
        }
      } catch { /* the row is a courtesy — a page without it is still a page */ }
    }
    const siblings: BriefSibling[] = await Promise.all(names.map(async name => ({
      label: name,
      title: titleForLabel(name, navigator.language) || name,
      imageUrl: name === label ? imageUrl : await this.#tileImageUrl([...parent, name], sink),
      current: name === label,
    })))
    return { brief, imageUrl, siblings: siblings.length > 1 ? siblings : [] }
  }

  #currentSegments(): readonly string[] {
    const lineage = window.ioc?.get<LineageShape>('@hypercomb.social/Lineage')
    return this.#targetSegments ?? [...(lineage?.explorerSegments?.() ?? [])]
  }

  /** Localized text with the echo guard — `t()` hands the key back when it
   *  cannot resolve one. */
  #t(key: string, fallback: string): string {
    const i18n = window.ioc?.get<{ t(k: string): string }>('@hypercomb.social/I18n')
    const text = i18n?.t?.(key)
    return text && text !== key ? text : fallback
  }

  #teardown(): void {
    this.#gutterOff?.()
    this.#gutterOff = null
    // The PANEL goes with the host; WHICH corner was turned down does not —
    // #mount turns it back down after the rebuild, so a note landing on the
    // tile you are reading does not shut the card you are reading it in.
    this.#briefPanel = null
    this.#host?.remove()
    this.#host = null
    revokeAll(this.#objectUrls)
    this.#objectUrls = []
    this.#setActive(false)
  }

  #setActive(active: boolean): void {
    if (this.#active === active) return
    this.#active = active
    const modes = window.ioc?.get<{ enter(m: string, o: string): void; exit(m: string, o: string): void }>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', 'square-tile-view')
    else modes?.exit('view:active', 'square-tile-view')
  }
}

// Bright gallery: warm ivory paper, espresso ink, gold hairlines. The
// plates are the only pictures on the sheet; everything else is type and
// air. Depth is garnish — soft shadows and a staggered entrance — never a
// scene to navigate.
const SCENE_CSS = `
.hc-square-tile-view{position:fixed;top:0;bottom:0;left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);z-index:150;overflow:auto;background:
 radial-gradient(120% 70% at 50% 0%,rgba(255,255,255,.75),transparent 60%),
 linear-gradient(180deg,#f8f3e8 0%,#f3ecdd 60%,#ede4d1 100%);
 color:#31241a}
.wv-sheet{box-sizing:border-box;max-width:1180px;margin:0 auto;padding:clamp(2.2rem,6vh,4.5rem) clamp(1.2rem,4vw,3rem) 4rem;min-height:100%;display:flex;flex-direction:column}
.wv-crest{text-align:center;margin-bottom:clamp(1.8rem,4.5vh,3.2rem);animation:wv-rise .7s cubic-bezier(.2,.7,.2,1) backwards}
.wv-title{margin:0;font:italic 700 clamp(2.6rem,6vw,4.2rem)/1.08 Georgia,'Times New Roman',serif;letter-spacing:.04em;color:#3a2a1c}
.wv-rule{width:7.5rem;height:2px;margin:1.05rem auto 0;background:linear-gradient(90deg,transparent,#b8933f 18%,#d9b96a 50%,#b8933f 82%,transparent)}
.wv-tagline{margin:.95rem 0 0;color:#8a7657;font:400 .95rem/1.5 Georgia,serif;letter-spacing:.24em;text-transform:uppercase}
.wv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:clamp(1rem,2.4vw,1.8rem);justify-items:stretch;align-content:start;max-width:980px;margin:0 auto;width:100%}
.wv-plate{position:relative;display:flex;flex-direction:column;gap:.7rem;padding:0;border:0;background:none;cursor:pointer;text-align:center;animation:wv-rise .6s cubic-bezier(.2,.7,.2,1) backwards;animation-delay:calc(.05s * var(--i,0));transition:transform .18s ease}
.wv-plate:hover,.wv-plate:focus-visible{transform:translateY(-5px);outline:none}
.wv-mat{display:block;background:#fffdf7;border:1px solid rgba(184,147,63,.55);padding:9px;box-shadow:0 1px 2px rgba(58,42,28,.08),0 10px 24px -12px rgba(58,42,28,.28);transition:box-shadow .18s ease,border-color .18s ease}
.wv-plate:hover .wv-mat,.wv-plate:focus-visible .wv-mat{border-color:#b8933f;box-shadow:0 2px 3px rgba(58,42,28,.1),0 18px 34px -14px rgba(58,42,28,.4),0 0 0 1px rgba(184,147,63,.35)}
.wv-art{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#efe7d6}
.wv-plate:hover .wv-art{filter:saturate(1.05) brightness(1.03)}
.wv-art-blank{background:
 radial-gradient(42% 42% at 50% 46%,rgba(184,147,63,.22),transparent 72%),
 conic-gradient(from 30deg,rgba(184,147,63,.14) 0 60deg,transparent 0 120deg,rgba(184,147,63,.14) 0 180deg,transparent 0 240deg,rgba(184,147,63,.14) 0 300deg,transparent 0),#f4edde}
.wv-caption{color:#5c4630;font:600 .78rem/1.3 Georgia,'Times New Roman',serif;letter-spacing:.14em;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wv-plate:hover .wv-caption{color:#3a2a1c}
.wv-hint{margin:auto auto 0;padding-top:2.6rem;text-align:center;color:rgba(138,118,87,.75);font:400 .74rem/1 Georgia,serif;letter-spacing:.26em;text-transform:uppercase;animation:wv-fade 1s ease .6s backwards}
.wv-close{position:fixed;z-index:2147483600;right:calc(.75rem + env(safe-area-inset-right,0px) + var(--hc-scroll-gutter,0px));top:calc(.75rem + env(safe-area-inset-top,0px));width:2.25rem;height:2.25rem;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,253,247,.85);border:1px solid rgba(184,147,63,.5);backdrop-filter:blur(6px);color:#5c4630;cursor:pointer;font:1.3rem/1 serif;padding:0;opacity:.6;transition:opacity .16s ease}
.wv-close:hover{opacity:1}
/* THE DOG-EAR. A plate is a card and a card has a back; the corner is how you
   turn it. Standing on tiles that carry something, offered on hover
   elsewhere — never competing with the plate's own click. */
.wv-fold{position:absolute;right:0;top:0;width:2.1rem;height:2.1rem;padding:0;border:0;background:none;cursor:pointer;
 opacity:0;transition:opacity .18s ease;z-index:1;display:block}
.wv-fold::before{content:'';position:absolute;right:9px;top:9px;width:1.05rem;height:1.05rem;
 background:linear-gradient(225deg,#d9b96a 46%,rgba(184,147,63,.25) 48%,transparent 50%);
 box-shadow:-1px 1px 2px rgba(58,42,28,.18);transition:width .16s ease,height .16s ease}
.wv-fold[data-carries]{opacity:.85}
.wv-plate:hover .wv-fold,.wv-plate:focus-within .wv-fold,.wv-fold:focus-visible{opacity:1}
.wv-fold:hover::before,.wv-fold:focus-visible::before{width:1.35rem;height:1.35rem}
.wv-plate[data-open]{transform:translateY(-5px)}
.wv-plate[data-open] .wv-mat{border-color:#b8933f;box-shadow:0 2px 3px rgba(58,42,28,.1),0 18px 34px -14px rgba(58,42,28,.4),0 0 0 1px rgba(184,147,63,.35)}
.wv-plate[data-open] .wv-fold::before{width:1.45rem;height:1.45rem}
.wv-crest{position:relative}
/* The page's own corner is always there — every place carries something. */
.wv-crest .wv-fold{right:0;top:0;opacity:.7}
.wv-crest .wv-fold:hover,.wv-crest[data-open] .wv-fold{opacity:1}
@keyframes wv-rise{from{opacity:0;translate:0 14px}to{opacity:1;translate:0 0}}
@keyframes wv-fade{from{opacity:0}to{opacity:1}}
@media(prefers-reduced-motion:reduce){.wv-plate,.wv-crest{animation:none}.wv-hint{animation:none}}
@media(max-width:560px){.wv-grid{grid-template-columns:repeat(auto-fill,minmax(128px,1fr))}.wv-mat{padding:6px}.wv-caption{font-size:.68rem;letter-spacing:.1em}
 /* No hover to reveal it and a finger to hit it: the corner stands on every
    plate and takes a bigger target. The hold gesture opens it too. */
 .wv-fold{width:2.6rem;height:2.6rem;opacity:.8}.wv-fold::before{right:11px;top:11px}}
`

const _squareTileView = new SquareTileViewDrone()
window.ioc.register('@diamondcoreprocessor.com/SquareTileViewDrone', _squareTileView)
