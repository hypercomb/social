// diamondcoreprocessor.com/presentation/tiles/tile-view.drone.ts
//
// THE DEFAULT FULLSCREEN TILE VIEW — what a tap on a plain content tile opens.
//
// On desktop every per-tile action (edit, adopt, share, public/private) lives on
// the HOVER action band. A stationary touch produces no hover, so on a phone
// that band is structurally unreachable and a leaf tile is a dead end: its tap
// emits `tile:action {action:'open'}`, which only link and contact tiles
// consume — a plain content tile does literally nothing. This view is the touch
// answer: tap a leaf tile, it opens full-screen with its picture, its name, its
// notes, and a row of thumb-sized actions.
//
// LAST IN THE TAKEOVER ORDER. tile-overlay consults `#viewTakeoverFor(label)`
// first, so a tile carrying a deck (`slides`) or a gallery (`lightbox`)
// decoration still opens ITS view. This one needs no decoration at all — it is
// the fallback for the undecorated majority, which is exactly why it cannot be
// expressed as a ranked registry bee (the picker requires `hasDecorationKind`).
//
// IN PLACE, NEVER NAVIGATES. Like slides/lightbox it pins the segments it was
// opened for and mounts over the current layer, so closing drops you exactly
// where you tapped — no entrance collapse, no history entry.
//
// Chrome hiding is the owner-counted `ModeRegistry.enter('view:active', …)`
// (a doctrine ratchet forbids emitting `view:active` directly). It deliberately
// does NOT take a ViewMode mode string: (a) no hand-maintained TRANSIENT_MODES
// edit, so a stale persisted mode can never strand the hive on a blank screen,
// and (b) a non-silent `adopt:done` forces `viewMode.set('hexagons')` in both
// shells — a ViewMode-expressed takeover would be torn down mid-adopt by its
// own button.
//
// Because `view:active` hides hc-controls-bar (which carries the mobile back
// button), this view owns every way out: the exit button, a backdrop tap,
// Escape, right-click, and the hardware/browser BACK button — the one a phone
// user reaches for first, and the one no other takeover handles.

import { Drone, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { sniffImageMime } from '../../link/photo.js'
import { readTilePropsIndex, lookupTilePropsSig, cellLocationSig } from '../../editor/tile-properties.js'

const SIG = /^[0-9a-f]{64}$/
/** Shared takeover z across the full-surface view drones (home/site/slides). */
const TAKEOVER_Z = 59988
const STEEL = 'rgba(126,182,214,0.92)'
const DIM = 'rgba(207,226,238,0.62)'
/** Thumb-target floor. The desktop band's 3rem circles are a cursor size. */
const TAP = '3.25rem'

type StoreShape = {
  getResource(sig: string): Promise<Blob | null>
  getResourceLocal(sig: string): Promise<Blob | null>
}
type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
}
type NotesShape = { notesFor(cellLabel: string): Array<{ text?: unknown }> }

type OpenPayload = { label?: unknown; segments?: unknown }

/** One action chip in the bottom row. `when` decides whether it renders at all;
 *  `backingKey` shades it inert while its bee is still registering (the same
 *  readiness rule the desktop band applies — a tap that silently no-ops during
 *  boot is worse than a visibly unavailable control). */
type Chip = {
  action: string
  glyph: string
  labelKey: string
  fallback: string
  backingKey?: string
  when?: () => boolean
  accent?: boolean
}

export class TileViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    store: '@hypercomb.social/Store',
  }
  protected override listens = ['tile:view-open']
  protected override emits = ['tile:action', 'view:active']

  #registered = false
  #bound = false
  /** The tile this view is open for — null when closed. */
  #label: string | null = null
  #segments: readonly string[] = []
  #host: HTMLDivElement | null = null
  #viewActive = false
  /** Object URLs minted for the picture; revoked on close. */
  #urls: string[] = []
  /** Labels the current render says are external (peer-published, adoptable). */
  #external = new Set<string>()
  /** True while we hold the synthetic history entry that catches BACK. */
  #historyTrap = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register('@diamondcoreprocessor.com/TileViewDrone', this)
      this.#registered = true
    }
    if (this.#bound) return
    this.#bound = true

    this.onEffect<OpenPayload>('tile:view-open', payload => {
      const label = typeof payload?.label === 'string' ? payload.label : ''
      if (!label) return
      const segs = Array.isArray(payload?.segments) ? payload.segments.map(s => String(s)) : []
      void this.open(label, segs)
    })

    // Adoptability rides the render pass: `external` means "on screen but not a
    // child of my layer" — the same signal that flips the desktop band to its
    // peer profile. tile:hover carries no such flag, so this is the only source.
    this.onEffect<{ externalLabels?: unknown }>('render:cell-count', payload => {
      const list = Array.isArray(payload?.externalLabels) ? payload.externalLabels : []
      this.#external = new Set(list.map(s => String(s)))
    })

    // The tile stopped existing under us (deleted, or navigated away from).
    this.onEffect<{ cell?: unknown }>('cell:removed', ({ cell }) => {
      if (this.#label && String(cell ?? '') === this.#label) this.close()
    })
    this.onEffect('navigation:guard-start', () => this.close())

    // Adopt opens the Beehaviors panel and both shells snap back to hexagons on
    // a non-silent adopt:done. Get out of the way rather than be torn down.
    this.onEffect('adopt:done', () => this.close())

    // Escape and right-click, capture phase, inert while closed. Escape is
    // stopped immediately so the global cascade never also clears the selection.
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('contextmenu', this.#onContextMenu, true)
    // The BACK button is what a phone user presses to leave a full screen. No
    // other takeover handles it; without this the view stays mounted while the
    // lineage moves underneath it.
    window.addEventListener('popstate', this.#onPopState)
  }

  /** Is this view currently up? Read by the overlay to avoid double-opens. */
  public get open_(): boolean { return this.#label !== null }

  public async open(label: string, segments: readonly string[]): Promise<void> {
    if (this.#label === label) return
    this.close()
    this.#label = label
    this.#segments = [...segments]
    this.#mount()
    // Push one synthetic entry so the hardware/browser BACK button closes the
    // view instead of navigating the hive out from under it. Popped in #close.
    try {
      window.history.pushState({ hcTileView: label }, '')
      this.#historyTrap = true
    } catch { /* history unavailable — the other close paths still work */ }
    await this.#paintPicture(label)
  }

  public close(): void {
    if (!this.#label) return
    this.#label = null
    this.#segments = []
    if (this.#host) {
      this.#host.remove()
      this.#host = null
    }
    for (const url of this.#urls) {
      try { URL.revokeObjectURL(url) } catch { /* noop */ }
    }
    this.#urls = []
    if (this.#viewActive) this.#setViewActive(false)
    // Drop our synthetic entry so the history stack is exactly as we found it.
    // Guard first: when BACK is what closed us, the entry is already gone and a
    // second back() would leave the page.
    if (this.#historyTrap) {
      this.#historyTrap = false
      try { window.history.back() } catch { /* noop */ }
    }
  }

  #onPopState = (): void => {
    if (!this.#label) return
    // Our entry is already popped — closing must not pop again.
    this.#historyTrap = false
    this.close()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.#label || e.key !== 'Escape') return
    e.preventDefault()
    e.stopImmediatePropagation()
    this.close()
  }

  #onContextMenu = (e: MouseEvent): void => {
    if (!this.#label) return
    e.preventDefault()
    this.close()
  }

  // ── DOM ────────────────────────────────────────────────────

  #mount(): void {
    const label = this.#label
    if (!label) return

    const host = document.createElement('div')
    host.id = 'hc-tile-view-host'
    host.style.cssText =
      `position:fixed;inset:0;z-index:${TAKEOVER_Z};overflow:hidden;background:#05040f;` +
      'display:flex;flex-direction:column;font-family:inherit;' +
      'padding:max(0.9rem,env(safe-area-inset-top,0px)) max(0.9rem,env(safe-area-inset-right,0px)) ' +
      'max(0.9rem,env(safe-area-inset-bottom,0px)) max(0.9rem,env(safe-area-inset-left,0px));'
    host.setAttribute('data-consumes-wheel', '')
    // A tap on the backdrop closes; taps inside the card do not (the card stops
    // the event). Pointerdown, not click, so it matches the bar's back button.
    host.addEventListener('pointerdown', e => {
      if (e.target === host) this.close()
    })
    document.body.appendChild(host)
    this.#host = host
    this.#setViewActive(true)

    // Picture — a background-image on a definite-size box, NOT an <img>: a
    // viewBox-only SVG has no intrinsic size and collapses an <img> to 0×0.
    const picture = document.createElement('div')
    picture.dataset['role'] = 'picture'
    picture.style.cssText =
      'flex:1 1 auto;min-height:0;border-radius:14px;' +
      'background-repeat:no-repeat;background-position:center;background-size:contain;'
    host.appendChild(picture)

    const name = document.createElement('div')
    name.textContent = label
    name.style.cssText =
      'flex:0 0 auto;margin:0.85rem 0 0;font-size:1.35rem;font-weight:600;' +
      'color:rgba(245,245,245,0.94);text-align:center;word-break:break-word;'
    host.appendChild(name)

    const notes = this.#notesText(label)
    if (notes) {
      const noteEl = document.createElement('div')
      noteEl.textContent = notes
      noteEl.style.cssText =
        `flex:0 1 auto;margin:0.5rem 0 0;font-size:0.95rem;line-height:1.45;color:${DIM};` +
        'text-align:center;overflow-y:auto;max-height:30vh;white-space:pre-wrap;'
      host.appendChild(noteEl)
    }

    host.appendChild(this.#actionRow(label))
  }

  /** The action row — the touch equivalent of the hover band. Only chips that
   *  can actually do something render: adopt appears solely on a peer tile,
   *  public/private solely on one of your own. */
  #actionRow(label: string): HTMLElement {
    const row = document.createElement('div')
    row.style.cssText =
      'flex:0 0 auto;display:flex;align-items:center;justify-content:center;' +
      'gap:0.75rem;flex-wrap:wrap;margin-top:1rem;'

    const external = this.#external.has(label)
    const chips: Chip[] = [
      {
        action: 'adopt',
        glyph: 'download',
        labelKey: 'action.adopt',
        fallback: 'make this yours',
        backingKey: '@diamondcoreprocessor.com/SwarmAdoptDrone',
        when: () => external,
        accent: true,
      },
      { action: 'edit', glyph: 'edit', labelKey: 'action.edit', fallback: 'edit' },
      {
        action: 'make-public',
        glyph: 'public',
        labelKey: 'action.make-public',
        fallback: 'share',
        when: () => !external,
      },
    ]

    for (const chip of chips) {
      if (chip.when && !chip.when()) continue
      row.appendChild(this.#chip(chip, label))
    }
    row.appendChild(this.#exitChip())
    return row
  }

  #chip(chip: Chip, label: string): HTMLElement {
    const btn = document.createElement('button')
    const inert = !!chip.backingKey && !window.ioc?.has?.(chip.backingKey)
    btn.type = 'button'
    btn.setAttribute('aria-label', this.#t(chip.labelKey, chip.fallback))
    btn.style.cssText =
      `min-width:${TAP};min-height:${TAP};padding:0 1.05rem;border-radius:${TAP};` +
      'display:inline-flex;align-items:center;gap:0.5rem;cursor:pointer;' +
      `background:${chip.accent ? STEEL : 'rgba(20,26,34,0.9)'};` +
      `color:${chip.accent ? '#04121b' : 'rgba(245,245,245,0.9)'};` +
      `border:1px solid ${chip.accent ? 'transparent' : 'rgba(255,255,255,0.12)'};` +
      `font-size:0.95rem;font-weight:600;opacity:${inert ? 0.4 : 1};` +
      `pointer-events:${inert ? 'none' : 'auto'};`

    const glyph = document.createElement('span')
    glyph.textContent = chip.glyph
    glyph.style.cssText = "font-family:'Material Symbols Outlined';font-size:1.35rem;line-height:1;"
    btn.appendChild(glyph)

    const text = document.createElement('span')
    text.textContent = this.#t(chip.labelKey, chip.fallback)
    btn.appendChild(text)

    btn.addEventListener('click', () => {
      // The exact rendered name: swarm-adopt string-matches the peer entry's
      // `name` and does NOT normalize, so a normalized label would silently
      // match nothing.
      this.emitEffect('tile:action', { action: chip.action, label })
      // Editing and sharing open their own surface over this one; adopt is
      // handled by its own adopt:done listener (it may route to a panel first).
      if (chip.action !== 'adopt') this.close()
    })
    return btn
  }

  #exitChip(): HTMLElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('aria-label', this.#t('slides.exit', 'Back to the hive'))
    btn.style.cssText =
      `min-width:${TAP};min-height:${TAP};border-radius:50%;cursor:pointer;` +
      'display:inline-flex;align-items:center;justify-content:center;' +
      'background:rgba(20,26,34,0.9);border:1px solid rgba(255,255,255,0.12);' +
      'color:rgba(245,245,245,0.9);'
    const glyph = document.createElement('span')
    glyph.textContent = 'grid_view'
    glyph.style.cssText = "font-family:'Material Symbols Outlined';font-size:1.5rem;line-height:1;"
    btn.appendChild(glyph)
    btn.addEventListener('click', () => this.close())
    return btn
  }

  // ── content ────────────────────────────────────────────────

  #notesText(label: string): string {
    try {
      const notes = window.ioc?.get?.('@diamondcoreprocessor.com/NotesService') as NotesShape | undefined
      const list = notes?.notesFor?.(label) ?? []
      return list.map(n => String(n?.text ?? '')).filter(Boolean).join('\n\n')
    } catch { return '' }
  }

  /** Resolve the tile's display picture and paint it. Async and best-effort —
   *  the view is already up and useful without it (a tile with no picture is a
   *  name, its notes and its actions, not an error). */
  async #paintPicture(label: string): Promise<void> {
    const sig = await this.#pictureSig(label)
    // Bailed out or closed while resolving.
    if (!sig || this.#label !== label || !this.#host) return
    const url = await this.#objectUrl(sig)
    if (!url || this.#label !== label || !this.#host) return
    const picture = this.#host.querySelector('[data-role="picture"]') as HTMLElement | null
    if (picture) picture.style.backgroundImage = `url("${url}")`
  }

  /** The tile's DISPLAY picture signature (`large.image`), read canonical-first
   *  then through the participant-local props index — the same two stores, in
   *  the same order, the slides viewer reads (index-only tiles are common). */
  async #pictureSig(label: string): Promise<string> {
    const store = this.resolve<StoreShape>('store')
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as HistoryShape | undefined
    if (!store?.getResourceLocal) return ''

    const fromPropsSig = async (sig: string): Promise<string> => {
      if (!SIG.test(sig)) return ''
      try {
        const blob = await store.getResourceLocal(sig)
        if (!blob) return ''
        const props = JSON.parse(await blob.text()) as { large?: { image?: unknown } }
        const image = props?.large?.image
        return typeof image === 'string' && SIG.test(image) ? image : ''
      } catch { return '' }
    }

    try {
      if (history?.sign && history?.currentLayerAt) {
        const sig = await history.sign({ explorerSegments: () => [...this.#segments, label] })
        const layer = await history.currentLayerAt(sig)
        const slot = layer?.['properties']
        const canonical = await fromPropsSig(Array.isArray(slot) && typeof slot[0] === 'string' ? slot[0] : '')
        if (canonical) return canonical
      }
    } catch { /* fall through to the index */ }

    try {
      const key = await cellLocationSig(this.#segments, label)
      const indexed = lookupTilePropsSig(readTilePropsIndex(), key, label)
      if (indexed) return await fromPropsSig(indexed)
    } catch { /* index unavailable */ }
    return ''
  }

  /** Object URL for a content signature. Sig-addressed bytes carry NO MIME and
   *  an empty-type blob does not decode in a CSS background — sniff the real
   *  type from the bytes and re-wrap. */
  async #objectUrl(sig: string): Promise<string> {
    const store = this.resolve<StoreShape>('store')
    if (!store?.getResource) return ''
    try {
      const blob = await store.getResource(sig)
      if (!blob) return ''
      let typed = blob
      if (!blob.type) {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const mime = sniffImageMime(bytes) || ''
        if (mime) typed = new Blob([bytes], { type: mime })
      }
      const url = URL.createObjectURL(typed)
      this.#urls.push(url)
      return url
    } catch { return '' }
  }

  #t(key: string, fallback: string): string {
    try {
      const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
      return i18n?.t(key) ?? fallback
    } catch { return fallback }
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    const modes = window.ioc.get('@diamondcoreprocessor.com/ModeRegistry') as
      { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void } | undefined
    if (active) modes?.enter('view:active', 'tile-view')
    else modes?.exit('view:active', 'tile-view')
  }
}

const _tileView = new TileViewDrone()
window.ioc.register('@diamondcoreprocessor.com/TileViewDrone', _tileView)
