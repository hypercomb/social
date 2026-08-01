// hypercomb-shared/ui/rewind-window/rewind-window.component.ts
//
// The Rewind window — the visual undo picker.
//
// Undo is TWO-STAGE. Stage 1 is BY TILES: the window shows a filmstrip
// of "moments" — every history entry where the tile membership of the
// current location actually changed — each rendered as a mosaic of hex
// thumbnails so the user recognises the state by picture, not by
// timestamp. Clicking a moment seeks the history cursor there.
//
// Stage 2 is BY BEHAVIOURS, revealed only inside the range stage 1
// selected: between the chosen moment and the next one lie the
// intermediate layers (content edits, tags, notes, …). A stepper walks
// those behaviour boundaries, clamped to the range — never a free
// global behaviour timeline. Tiles are the front door; behaviours are
// the second gear.
//
// Everything here is a pure READ over the lineage pool plus cursor
// seeks — no new truth, no new records. Thumbnails come from the
// `thumbnails:hex` derived pool keyed by SOURCE IMAGE SIG (never a tile
// property); a miss falls back to the full image bytes, and a further
// miss renders an initial-letter hex. Nothing is load-bearing.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, ElementRef, computed, effect, inject, signal, type AfterViewInit, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

type CursorState = {
  locationSig: string
  position: number
  total: number
  rewound: boolean
  at: number
}

type Content = { name?: string;[slot: string]: unknown }

type HistoryService = {
  listMarkerFilenames?(locationSig: string): Promise<readonly string[]>
  readMarker?(locationSig: string, filename: string): Promise<{
    bytes: ArrayBuffer
    parsed: Content | null
    layerSig: string
    at: number
    rawText: string
  } | null>
  getLayerBySig?(layerSig: string): Promise<Content | null>
}
type CursorService = {
  state: CursorState
  seek(position: number): void
}
type Store = {
  getResource(sig: string): Promise<Blob | null>
  getPool?(meaning: string): Promise<FileSystemDirectoryHandle | null>
}
type NavigationService = { segmentsRaw(): string[] }

const SIG_RE = /^[0-9a-f]{64}$/

// Derived pool holding hex thumbnails, keyed by source image sig.
// Mirrors THUMBNAIL_MEANING in essentials — shared cannot import
// essentials, and the meaning string IS the address, so the constant
// is the whole contract.
const THUMBNAIL_MEANING = 'thumbnails:hex'

// Behaviour palette — same hues the history viewer uses for its
// category ticks, so the two surfaces read as one system.
type Behaviour = 'tiles' | 'content' | 'tags' | 'notes' | 'system'
const BEHAVIOUR_COLOR: Readonly<Record<Behaviour, string>> = {
  tiles: '#6dc077',
  content: '#5f8bd9',
  tags: '#d9c25f',
  notes: '#b37dd4',
  system: '#e08c4d',
}

/** One entry of the lineage pool, enriched for display. */
type Step = {
  /** 0-based index into the entries array (cursor position - 1). */
  index: number
  at: number
  filename: string
  layerSig: string
  content: Content | null
  /** Dominant behaviour of the change vs the previous entry. */
  behaviour: Behaviour
  /** Short human delta, e.g. "+2 tiles" / "content" / "tags". */
  delta: string
  /** True when tile membership (child NAME set) changed at this step. */
  tileBoundary: boolean
}

/** A stage-1 card: a tile-boundary step plus the tiles alive there. */
type Moment = {
  step: Step
  /** Up to MOSAIC_MAX tiles to draw, resolved lazily to thumb URLs. */
  tiles: readonly { name: string; childSig: string }[]
  /** How many tiles beyond the mosaic cap exist at this step. */
  overflow: number
  /** Entry-index range this moment owns: [from .. to] inclusive. */
  from: number
  to: number
}

const MOSAIC_MAX = 5

@Component({
  selector: 'hc-rewind-window',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './rewind-window.component.html',
  styleUrls: ['./rewind-window.component.scss'],
})
export class RewindWindowComponent implements OnInit, AfterViewInit, OnDestroy {

  readonly #visible = signal(false)
  readonly visible = this.#visible.asReadonly()

  #entries = signal<readonly Step[]>([])
  #position = signal(0)          // 1-based cursor position
  #locationSig = signal('')
  #loadSeq = 0

  // Child layer sig → image sig ('' = resolved, no image). Immutable.
  readonly #imageByChild = new Map<string, string>()
  // Image sig → object URL for its thumbnail (or full bytes fallback).
  readonly #urlByImage = new Map<string, string>()
  // Bumped whenever an async thumbnail lands so the template re-reads.
  readonly #thumbTick = signal(0)

  #unsubs: (() => void)[] = []
  readonly #el: ElementRef<HTMLElement> = inject(ElementRef)

  // ── derived view state ────────────────────────────────────────────

  /** Stage 1 — tile moments, oldest → newest (time flows right). */
  readonly moments = computed<readonly Moment[]>(() => {
    const entries = this.#entries()
    const moments: Moment[] = []
    for (let i = 0; i < entries.length; i++) {
      const step = entries[i]
      if (!step.tileBoundary && moments.length > 0) continue
      const names = childTiles(step.content)
      moments.push({
        step,
        tiles: names.slice(0, MOSAIC_MAX),
        overflow: Math.max(0, names.length - MOSAIC_MAX),
        from: step.index,
        to: entries.length - 1, // patched below
      })
    }
    // Each moment owns the entries up to (not including) the next one.
    for (let m = 0; m < moments.length - 1; m++) {
      moments[m] = { ...moments[m], to: moments[m + 1].from - 1 }
    }
    return moments
  })

  /** The moment whose range contains the cursor — stage 1's selection. */
  readonly activeMoment = computed<Moment | null>(() => {
    const pos = this.#position() - 1
    if (pos < 0) return null
    return this.moments().find(m => pos >= m.from && pos <= m.to) ?? null
  })

  /**
   * Stage 2 — the behaviour steps INSIDE the active moment's range.
   * Only surfaced when the range holds more than the boundary itself;
   * a moment with no intermediate behaviours keeps stage 2 hidden.
   */
  readonly behaviourSteps = computed<readonly Step[]>(() => {
    const moment = this.activeMoment()
    if (!moment) return []
    const entries = this.#entries()
    return entries.slice(moment.from, moment.to + 1)
  })

  readonly showBehaviours = computed(() => this.behaviourSteps().length > 1)

  readonly activeIndex = computed(() => this.#position() - 1)

  readonly activeStep = computed<Step | null>(() => {
    const entries = this.#entries()
    const i = this.activeIndex()
    return i >= 0 && i < entries.length ? entries[i] : null
  })

  readonly canStepBack = computed(() => {
    const moment = this.activeMoment()
    return !!moment && this.activeIndex() > moment.from
  })
  readonly canStepForward = computed(() => {
    const moment = this.activeMoment()
    return !!moment && this.activeIndex() < moment.to
  })

  readonly pathLabel = computed(() => {
    // Recomputed on every reload via #locationSig; the raw segments are
    // read fresh — the sig signal is just the invalidation trigger.
    void this.#locationSig()
    const nav = this.#nav()
    const segments = nav?.segmentsRaw() ?? []
    return segments.length > 0 ? '/' + segments.join('/') : '/'
  })

  readonly behaviourColor = (b: Behaviour): string => BEHAVIOUR_COLOR[b]

  readonly momentIsActive = (moment: Moment): boolean =>
    this.activeMoment()?.step.filename === moment.step.filename

  readonly when = (at: number): string =>
    at > 0 ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

  /** Thumbnail object URL for a tile, or null while unresolved. */
  readonly thumbUrl = (childSig: string): string | null => {
    void this.#thumbTick()
    const imageSig = this.#imageByChild.get(childSig)
    if (!imageSig) return null
    return this.#urlByImage.get(imageSig) ?? null
  }

  readonly initial = (name: string): string =>
    (name.trim()[0] ?? '·').toUpperCase()

  // ── lifecycle ─────────────────────────────────────────────────────

  constructor() {
    this.#unsubs.push(
      EffectBus.on('rewind:open', () => this.#visible.set(true)),
      EffectBus.on('rewind:close', () => this.#visible.set(false)),
      EffectBus.on('rewind:toggle', () => this.#visible.set(!this.#visible())),
    )
    effect(() => {
      if (this.visible()) void this.#reload()
    })
  }

  ngOnInit(): void {
    this.#unsubs.push(
      EffectBus.on<CursorState>('history:cursor-changed', (s) => {
        if (!s) return
        const locationChanged = s.locationSig !== this.#locationSig()
        const grew = s.total !== this.#entries().length
        this.#position.set(s.position)
        if (locationChanged) this.#locationSig.set(s.locationSig)
        if ((locationChanged || grew) && this.visible()) void this.#reload()
      }),
    )
    document.addEventListener('keydown', this.#onKeydown)
  }

  ngAfterViewInit(): void {
    // Portal to body — same stacking-context escape as the viewer.
    const host = this.#el.nativeElement as HTMLElement
    if (host && host.parentNode !== document.body) document.body.appendChild(host)
  }

  ngOnDestroy(): void {
    for (const off of this.#unsubs) off()
    document.removeEventListener('keydown', this.#onKeydown)
    for (const url of this.#urlByImage.values()) URL.revokeObjectURL(url)
    this.#urlByImage.clear()
    const host = this.#el.nativeElement
    if (host && host.parentNode === document.body) document.body.removeChild(host)
  }

  readonly #onKeydown = (e: KeyboardEvent): void => {
    if (!this.visible()) return
    if (e.key === 'Escape') { this.hide(); return }
    if (e.key === 'ArrowLeft' && this.canStepBack()) { e.preventDefault(); this.stepBack() }
    if (e.key === 'ArrowRight' && this.canStepForward()) { e.preventDefault(); this.stepForward() }
  }

  readonly hide = (): void => { this.#visible.set(false) }

  // ── actions ───────────────────────────────────────────────────────

  /** Stage 1 click: land on the moment's tile-boundary entry. */
  readonly pickMoment = (moment: Moment): void => {
    this.#seek(moment.step.index)
  }

  /** Stage 2: walk one behaviour within the range. */
  readonly stepBack = (): void => {
    if (this.canStepBack()) this.#seek(this.activeIndex() - 1)
  }
  readonly stepForward = (): void => {
    if (this.canStepForward()) this.#seek(this.activeIndex() + 1)
  }
  readonly pickBehaviour = (step: Step): void => {
    const moment = this.activeMoment()
    if (!moment) return
    // Constrained by the range — a stale click outside it is dropped.
    if (step.index < moment.from || step.index > moment.to) return
    this.#seek(step.index)
  }

  #seek(index: number): void {
    const cursor = this.#cursor()
    if (!cursor) return
    cursor.seek(index + 1) // cursor positions are 1-based
  }

  // ── data ──────────────────────────────────────────────────────────

  #cursor(): CursorService | null {
    return window.ioc.get<CursorService>('@diamondcoreprocessor.com/HistoryCursorService') ?? null
  }
  #history(): HistoryService | null {
    return window.ioc.get<HistoryService>('@diamondcoreprocessor.com/HistoryService') ?? null
  }
  #store(): Store | null {
    return window.ioc.get<Store>('@hypercomb.social/Store') ?? null
  }
  #nav(): NavigationService | null {
    return window.ioc.get<NavigationService>('@hypercomb.social/Navigation') ?? null
  }

  async #reload(): Promise<void> {
    const seq = ++this.#loadSeq
    const cursor = this.#cursor()
    const history = this.#history()
    if (!cursor || !history?.listMarkerFilenames || !history.readMarker) return

    const locationSig = cursor.state.locationSig
    this.#locationSig.set(locationSig)
    this.#position.set(cursor.state.position)

    const filenames = await history.listMarkerFilenames(locationSig)
    if (seq !== this.#loadSeq) return

    const markers = await Promise.all(filenames.map(async (name) => {
      try { return await history.readMarker!(locationSig, name) } catch { return null }
    }))
    if (seq !== this.#loadSeq) return

    // Resolve child sigs → names first: tile identity is the NAME, so
    // the boundary detection must compare name sets, never raw sigs
    // (a downstream edit swaps sigs while the tiles stay put).
    const pending = new Set<string>()
    for (const m of markers) {
      for (const sig of childSigs(m?.parsed ?? null)) {
        if (!nameCache.has(sig)) pending.add(sig)
      }
    }
    if (pending.size > 0 && history.getLayerBySig) {
      await Promise.all([...pending].map(async (sig) => {
        try {
          const layer = await history.getLayerBySig!(sig)
          if (layer && typeof layer.name === 'string' && layer.name) {
            nameCache.set(sig, layer.name)
          }
        } catch { /* unresolvable — sig stands in for the name */ }
      }))
      if (seq !== this.#loadSeq) return
    }

    const steps: Step[] = []
    let prev: Content | null = null
    filenames.forEach((filename, i) => {
      const m = markers[i]
      const content = m?.parsed ?? null
      const { behaviour, delta, tileBoundary } = this.#classify(prev, content)
      steps.push({
        index: i,
        at: m?.at ?? 0,
        filename,
        layerSig: m?.layerSig ?? '',
        content,
        behaviour,
        // The genesis entry is "the empty page" — a real undo target, but
        // it isn't an edit; a neutral dot reads better than a false delta.
        delta: i === 0 ? '·' : delta,
        tileBoundary: i === 0 ? true : tileBoundary,
      })
      if (content) prev = content
    })

    this.#entries.set(steps)
    // Kick off thumbnail resolution for every tile the filmstrip shows.
    void this.#hydrateThumbnails(seq)
  }

  /**
   * Classify one step vs its predecessor. Tile-boundary when the child
   * NAME set changed; otherwise the dominant behaviour of whichever
   * slot moved. Pure display heuristic — never persisted.
   */
  #classify(prev: Content | null, next: Content | null): {
    behaviour: Behaviour; delta: string; tileBoundary: boolean
  } {
    if (!next) return { behaviour: 'system', delta: '·', tileBoundary: false }
    const prevNames = new Set(childTiles(prev).map(t => t.name))
    const nextNames = childTiles(next).map(t => t.name)
    const added = nextNames.filter(n => !prevNames.has(n)).length
    const removed = [...prevNames].filter(n => !nextNames.includes(n)).length
    if (added > 0 || removed > 0) {
      const parts: string[] = []
      if (added > 0) parts.push(`+${added}`)
      if (removed > 0) parts.push(`−${removed}`)
      return { behaviour: 'tiles', delta: parts.join(' '), tileBoundary: true }
    }
    // No membership change — find the first non-children slot delta.
    for (const key of new Set([...Object.keys(prev ?? {}), ...Object.keys(next)])) {
      if (key === 'name' || key === 'children') continue
      const a = slotArray(prev, key)
      const b = slotArray(next, key)
      if (!sameSet(a, b)) {
        if (key === 'tags') return { behaviour: 'tags', delta: 'tags', tileBoundary: false }
        if (key === 'notes') return { behaviour: 'notes', delta: 'notes', tileBoundary: false }
        return { behaviour: 'system', delta: key, tileBoundary: false }
      }
    }
    // Children sigs rippled (or props changed inside a tile) — content.
    return { behaviour: 'content', delta: 'edit', tileBoundary: false }
  }

  /**
   * Resolve thumbnails for every tile in every moment's mosaic:
   * child layer → `properties[0]` → props → `small.image` →
   * `thumbnails:hex` pool record → object URL. Falls back to the full
   * image bytes when no thumbnail record exists yet; a tile with no
   * image resolves to '' and renders as an initial-letter hex.
   */
  async #hydrateThumbnails(seq: number): Promise<void> {
    const history = this.#history()
    const store = this.#store()
    if (!history?.getLayerBySig || !store) return

    const wanted = new Set<string>()
    for (const moment of this.moments()) {
      for (const tile of moment.tiles) {
        if (!this.#imageByChild.has(tile.childSig)) wanted.add(tile.childSig)
      }
    }
    if (wanted.size === 0) return

    await Promise.all([...wanted].map(async (childSig) => {
      const imageSig = await this.#resolveImageSig(history, store, childSig)
      if (seq !== this.#loadSeq) return
      this.#imageByChild.set(childSig, imageSig ?? '')
      if (imageSig && !this.#urlByImage.has(imageSig)) {
        const blob = await this.#readThumbBlob(store, imageSig)
        if (seq !== this.#loadSeq || !blob) return
        if (!this.#urlByImage.has(imageSig)) {
          this.#urlByImage.set(imageSig, URL.createObjectURL(blob))
        }
      }
      this.#thumbTick.update(n => n + 1)
    }))
  }

  async #resolveImageSig(history: HistoryService, store: Store, childSig: string): Promise<string | null> {
    try {
      const layer = await history.getLayerBySig!(childSig)
      const propsSlot = (layer as Record<string, unknown> | null)?.['properties']
      if (!Array.isArray(propsSlot) || propsSlot.length === 0) return null
      let props: Record<string, unknown> | null = null
      const head = propsSlot[0]
      if (typeof head === 'string' && SIG_RE.test(head)) {
        const blob = await store.getResource(head)
        if (!blob) return null
        try { props = JSON.parse(await blob.text()) } catch { return null }
      } else if (head && typeof head === 'object') {
        props = head as Record<string, unknown>
      }
      const img = readImageSig(props)
      return img && SIG_RE.test(img) ? img : null
    } catch {
      return null
    }
  }

  /** Thumbnail record first (derived pool, keyed by image sig); full
   *  image bytes as the always-correct fallback. */
  async #readThumbBlob(store: Store, imageSig: string): Promise<Blob | null> {
    try {
      const pool = await store.getPool?.(THUMBNAIL_MEANING)
      if (pool) {
        const handle = await pool.getFileHandle(imageSig, { create: false })
        const file = await handle.getFile()
        if (file.size > 0) return file
      }
    } catch { /* miss is normal — fall back */ }
    try { return await store.getResource(imageSig) } catch { return null }
  }
}

// ── pure helpers ────────────────────────────────────────────────────

function childSigs(content: Content | null): string[] {
  const kids = (content as Record<string, unknown> | null)?.['children']
  if (!Array.isArray(kids)) return []
  return kids.filter((s): s is string => typeof s === 'string' && SIG_RE.test(s))
}

function childTiles(content: Content | null): { name: string; childSig: string }[] {
  // Names resolve through the module-level cache the component fills;
  // an unresolved sig stands in for itself so identity never collapses.
  const sigs = childSigs(content)
  return sigs.map(sig => ({ name: nameCache.get(sig) ?? sig, childSig: sig }))
}

// Shared between the component and the pure helpers: content-addressed
// layers mean a sig's name never changes, so one module-level cache is
// safe and never needs invalidation.
const nameCache = new Map<string, string>()

function slotArray(content: Content | null, key: string): unknown[] {
  const v = (content as Record<string, unknown> | null)?.[key]
  return Array.isArray(v) ? v : []
}

function sameSet(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false
  const bs = new Set(b.map(x => typeof x === 'string' ? x : JSON.stringify(x)))
  return a.every(x => bs.has(typeof x === 'string' ? x : JSON.stringify(x)))
}

function readImageSig(props: Record<string, unknown> | null): string | null {
  if (!props) return null
  const small = (props['small'] as Record<string, unknown> | undefined)?.['image']
  if (typeof small === 'string') return small
  const flat = props['flat'] as Record<string, unknown> | undefined
  const flatSmall = (flat?.['small'] as Record<string, unknown> | undefined)?.['image']
  return typeof flatSmall === 'string' ? flatSmall : null
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by
// an app.html tag.
registerShellSurface({
  name: 'hc-rewind-window',
  owner: '@hypercomb.shared/RewindWindowComponent',
  component: RewindWindowComponent,
  order: 3,
})
