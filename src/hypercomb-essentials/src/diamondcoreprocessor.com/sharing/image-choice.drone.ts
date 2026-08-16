// diamondcoreprocessor.com/sharing/image-choice.drone.ts
//
// THE IMAGE HIVE — every picture the room is carrying for one tile, laid out
// as ordinary tiles. Click one and it becomes your tile's picture.
//
// In a swarm everybody brings their own image for the same tile. Clicking the
// images icon replaces the mesh with a hive of those pictures: yours in the
// middle slot, then one tile per distinct picture any participant is
// publishing here, each wearing the name of who is offering it. They are laid
// out on the SAME axial matrix a real layer uses, at full size, so the choice
// looks like the hive it came from — not like a dialog over it.
//
//   CLICK a tile → that picture becomes yours. One revision, undoable.
//   ESC / empty  → everything snaps back. Nothing was written.
//
// The hive is hidden through `render:set-hive-visible`, the same takeover
// lever wave-view and the screensaver use, so show-cell keeps ownership of
// its own mesh. Every exit path restores it — including dispose — because a
// stranded pick would leave a blank canvas.
//
// While the pick is up this drone OWNS the pointer: moves and presses are
// stopped at window capture so tile-overlay cannot act on the hidden layer
// underneath.
//
// Read-only until the click: candidates are POINTERS off the wire, and the
// bytes behind them are pulled for the picture you see (and again, as a
// guarantee, before anything is written). A picture nobody can serve never
// becomes your tile — it paints as a labelled hex that refuses to be picked.

import { Drone, I18N_IOC_KEY, RESOURCE_URL_PREFIX, consumePointerGesture, type I18nProvider } from '@hypercomb/core'
import { Container, Graphics, Point, Sprite, Text, Texture } from 'pixi.js'
import type { HostReadyPayload } from '../presentation/tiles/pixi-host.worker.js'
import {
  cellLocationSig,
  readTilePropertiesAt,
  readTilePropsIndex,
  writeTilePropertiesAt,
} from '../editor/tile-properties.js'
import { peerImageCandidates, previewSigOf, type PeerImageCandidate, type PeerImageProps } from './peer-images.js'

type Axial = { q: number; r: number }

/** One choice on screen: a picture, who is offering it, where it sits, and the
 *  pointers that get written if it is picked. `pos` is in the pick layer's own
 *  coordinates — the layer pans and zooms, so a choice is found by DISTANCE
 *  from the cursor rather than by asking the hive's hex detector, which only
 *  ever knew about the untransformed mesh. */
type Choice = {
  slot: Axial
  pos: { x: number; y: number }
  props: PeerImageProps
  previewSig: string
  who: string
  mine: boolean
}

const PICK_Z = 7006                 // above wave-view's dive (7005)
// There is no small cap. A room of a hundred people is a hundred pictures and
// the wall is meant to hold them — this is only a runaway guard, and when it
// bites it SAYS SO rather than quietly showing a subset.
const MAX_CHOICES = 400
const ZOOM_MIN = 0.15
const ZOOM_MAX = 4
const ZOOM_STEP = 1.12              // per wheel notch
const DRAG_SLOP = 6                 // px before a press becomes a pan, not a pick
const TILE_FILL = 0x0e1018
const TILE_FILL_ALPHA = 0.96
const TILE_BORDER = 0x7eb6d6        // steel hairline (matches chrome)
const TILE_BORDER_ALPHA = 0.85
const TILE_BORDER_WIDTH = 1.2
const MINE_BORDER = 0x7eb6d6        // the picture you are already wearing
const MINE_BORDER_WIDTH = 2.4
const HOVER_BORDER = 0xa8ffd8       // the tile a click would commit to
const HOVER_BORDER_WIDTH = 2.4
const TILE_LABEL_FILL = 0xdceaf5
const TITLE_FILL = 0x9fc4dc
const LABEL_SIZE_FACTOR = 0.22
const LABEL_MAX_WIDTH_FACTOR = 1.45
// The label band, copied from the hex shader's own numbers (hex-sdf.shader.ts:
// `bandW = u_radiusPx * 0.88`, `rowH = u_radiusPx * 0.15`, black at 0.55) so a
// choice wears its name exactly the way every tile in the mesh does.
const BAND_HALF_WIDTH = 0.88
const BAND_HALF_HEIGHT = 0.15
const BAND_ALPHA = 0.55
const LABEL_RESOLUTION = (worldScale: number): number =>
  Math.min(4, Math.max(2, worldScale * (globalThis.devicePixelRatio || 1)))
const TEXTURE_CACHE_MAX = 128

export class ImageChoiceDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  override description =
    'The image hive: every picture the room is carrying for a tile, as tiles — click one and it becomes yours.'

  // ── render plumbing ───────────────────────────────────────────────
  #renderContainer: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: HostReadyPayload['renderer'] | null = null
  #meshOffset = { x: 0, y: 0 }
  #spacing = 38                             // centre-to-centre: circumradius + gap
  #circumRadius = 32                        // the hex itself
  #flat = false

  // ── pick state ────────────────────────────────────────────────────
  #label = ''                               // the tile being dressed
  #segments: string[] = []                  // its PARENT path
  #layer: Container | null = null
  #choices: Choice[] = []
  #choiceByAxial = new Map<string, Choice>()
  #hoverKey: string | null = null
  #hiveHidden = false
  #buildToken = 0
  #applying = false
  #lastClient: { x: number; y: number } | null = null

  #textures = new Map<string, Texture | null>()

  protected override listens = [
    'render:host-ready', 'render:mesh-offset', 'render:geometry-changed',
    'render:set-orientation', 'images:open', 'render:cell-count',
  ]
  protected override emits = ['render:set-hive-visible', 'tile:saved', 'toast:show']

  #wired = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#wired) return
    this.#wired = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#renderContainer = payload.container
      this.#canvas = payload.canvas
      this.#renderer = payload.renderer
      this.#renderContainer.sortableChildren = true
    })
    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => { this.#meshOffset = offset })
    this.onEffect<{ spacing?: number; circumRadiusPx?: number }>('render:geometry-changed', (geo) => {
      if (geo?.spacing) this.#spacing = geo.spacing
      if (geo?.circumRadiusPx) this.#circumRadius = geo.circumRadiusPx
    })
    this.onEffect<{ flat?: boolean }>('render:set-orientation', (p) => { this.#flat = !!p?.flat })

    this.onEffect<{ label?: string; segments?: readonly string[] }>('images:open', (payload) => {
      const label = String(payload?.label ?? '').trim()
      if (!label) return
      void this.#open(label, payload?.segments ?? [])
    })

    // A layer landing under the pick: back out ONLY when it is a different
    // PLACE. In a swarm this fires on every peer burst — closing on all of
    // them would make the choice unusable exactly where it is needed, and the
    // choices themselves are re-read live when it reopens.
    this.onEffect('render:cell-count', () => {
      if (!this.#layer && !this.#open_) return
      if (this.#locationKey() !== this.#openedAt) this.#close()
    })

    window.addEventListener('pointermove', this.#onPointerMove, true)
    window.addEventListener('pointerdown', this.#onPointerDown, true)
    window.addEventListener('pointerup', this.#onPointerUp, true)
    window.addEventListener('pointercancel', this.#onPointerUp, true)
    window.addEventListener('wheel', this.#onWheel, { capture: true, passive: false })
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('blur', this.#onWindowBlur)
  }

  protected override dispose(): void {
    window.removeEventListener('pointermove', this.#onPointerMove, true)
    window.removeEventListener('pointerdown', this.#onPointerDown, true)
    window.removeEventListener('pointerup', this.#onPointerUp, true)
    window.removeEventListener('pointercancel', this.#onPointerUp, true)
    window.removeEventListener('wheel', this.#onWheel, true)
    window.removeEventListener('keydown', this.#onKeyDown, true)
    window.removeEventListener('blur', this.#onWindowBlur)
    this.#close()                            // never strand a hidden hive
    for (const t of this.#textures.values()) { try { t?.destroy(true) } catch { /* gone */ } }
    this.#textures.clear()
  }

  /** Armed from the click until the hive is painted — so a second click, or a
   *  render arriving mid-resolution, is judged against a pick that exists. */
  #open_ = false
  /** The place the pick was opened at; a cell-count from anywhere else means
   *  the participant navigated away. */
  #openedAt = ''

  #locationKey(): string {
    const segs = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
      ?.explorerSegments?.() ?? []
    return segs.map(s => String(s ?? '').trim()).filter(Boolean).join('/')
  }

  #t(key: string, fallback: string): string {
    const value = window.ioc.get<I18nProvider>(I18N_IOC_KEY)?.t?.(key)
    return value && value !== key ? value : fallback
  }

  // ── input ─────────────────────────────────────────────────────────

  // A wall of pictures is navigated the way the hive itself is: drag to move,
  // wheel or pinch to zoom. The gestures are handled HERE rather than left to
  // the pan/zoom drones because the pick owns the pointer while it is up — the
  // mesh underneath is hidden and nothing else may act on it — so the picker
  // has to answer the same gestures itself or the wall would be frozen.
  #pointers = new Map<number, { x: number; y: number }>()
  #panning = false
  #moved = 0                                 // px travelled since the press
  #pinchStart = 0
  #pinchStartZoom = 1
  #zoom = 1

  #onPointerMove = (e: PointerEvent): void => {
    this.#lastClient = { x: e.clientX, y: e.clientY }
    if (!this.#layer) return
    e.stopPropagation()

    const prior = this.#pointers.get(e.pointerId)
    if (prior) this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (this.#pointers.size >= 2) { this.#pinchTo(); return }

    if (prior) {
      this.#moved += Math.hypot(e.clientX - prior.x, e.clientY - prior.y)
      if (this.#moved > DRAG_SLOP) this.#panning = true
      if (this.#panning) {
        this.#panBy(prior, { x: e.clientX, y: e.clientY })
        return
      }
    }
    this.#updateHover()
  }

  #onPointerDown = (e: PointerEvent): void => {
    if (!this.#layer) return
    e.stopPropagation()                      // tile-overlay must not act on the hidden layer
    if (e.button !== 0 && e.pointerType === 'mouse') { this.#close(); return }
    this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.#pointers.size === 2) {
      // Second finger down — this is a pinch from here, never a pick.
      this.#panning = true
      this.#pinchStart = this.#pinchSpan()
      this.#pinchStartZoom = this.#zoom
    }
    this.#moved = 0
  }

  /** The PICK happens on release, so a drag across the wall is navigation and
   *  only a press that stayed put is a choice. */
  #onPointerUp = (e: PointerEvent): void => {
    if (!this.#layer) { this.#pointers.delete(e.pointerId); return }
    e.stopPropagation()
    const wasPanning = this.#panning
    this.#pointers.delete(e.pointerId)
    if (this.#pointers.size === 0) { this.#panning = false; this.#pinchStart = 0 }
    if (wasPanning) return                   // a pan never picks and never closes

    const choice = this.#choiceUnderCursor(e.clientX, e.clientY)
    consumePointerGesture(e.pointerId)       // trailing click dies at window capture
    if (!choice) { this.#close(); return }   // a tap on empty space backs out
    if (choice.mine) { this.#close(); return }  // already wearing it — nothing to write
    void this.#apply(choice)
  }

  #onWheel = (e: WheelEvent): void => {
    if (!this.#layer) return
    e.preventDefault()
    e.stopPropagation()
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
    this.#zoomAbout(e.clientX, e.clientY, this.#zoom * factor)
    this.#updateHover()
  }

  /** Move the wall by the cursor's travel, in the layer's parent space. */
  #panBy(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const a = this.#toParent(from.x, from.y)
    const b = this.#toParent(to.x, to.y)
    if (!a || !b || !this.#layer) return
    this.#layer.position.set(this.#layer.position.x + (b.x - a.x), this.#layer.position.y + (b.y - a.y))
  }

  #pinchSpan(): number {
    const [a, b] = [...this.#pointers.values()]
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0
  }

  #pinchTo(): void {
    const span = this.#pinchSpan()
    if (!this.#pinchStart || !span) return
    const [a, b] = [...this.#pointers.values()]
    this.#zoomAbout((a.x + b.x) / 2, (a.y + b.y) / 2, this.#pinchStartZoom * (span / this.#pinchStart))
  }

  /** Zoom so the picture under the given screen point stays under it. */
  #zoomAbout(clientX: number, clientY: number, target: number): void {
    if (!this.#layer) return
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, target))
    const anchor = this.#toParent(clientX, clientY)
    if (!anchor) return
    const local = {
      x: (anchor.x - this.#layer.position.x) / this.#zoom,
      y: (anchor.y - this.#layer.position.y) / this.#zoom,
    }
    this.#zoom = next
    this.#layer.scale.set(next)
    this.#layer.position.set(anchor.x - local.x * next, anchor.y - local.y * next)
  }

  /** A screen point in the pick layer's PARENT coordinates (the hive's own
   *  content space) — the space `layer.position` is measured in. */
  #toParent(clientX: number, clientY: number): { x: number; y: number } | null {
    const global = this.#toGlobal(clientX, clientY)
    if (!global || !this.#renderContainer) return null
    const p = this.#renderContainer.toLocal(new Point(global.x, global.y))
    return { x: p.x, y: p.y }
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.#layer || e.key !== 'Escape') return
    e.stopPropagation()
    this.#close()
  }

  #onWindowBlur = (): void => { this.#close() }

  // ── lifecycle ─────────────────────────────────────────────────────

  /** Gather the room's pictures for `label`, decode them, and put them on the
   *  grid. Nothing is hidden until there is a complete hive to put in its
   *  place — resolving behind a blank canvas would flash. */
  async #open(label: string, segments: readonly string[]): Promise<void> {
    const token = ++this.#buildToken
    this.#close()
    this.#open_ = true
    this.#label = label
    this.#segments = segments.map(s => String(s ?? '').trim()).filter(Boolean)
    this.#openedAt = this.#segments.join('/')

    const mine = await this.#myImageProps(label)
    if (token !== this.#buildToken) return
    const minePreview = mine ? previewSigOf(mine) : ''

    const entries: { props: PeerImageProps; previewSig: string; who: string; mine: boolean }[] = []
    if (mine && minePreview) {
      entries.push({ props: mine, previewSig: minePreview, who: this.#t('images.yours', 'yours'), mine: true })
    }
    const offered = peerImageCandidates(label)
    for (const candidate of offered) {
      if (entries.length >= MAX_CHOICES) break
      // A peer carrying exactly the picture you already wear folds into YOUR
      // tile — the same picture is one choice however many people have it.
      if (candidate.previewSig === minePreview) continue
      entries.push({ props: candidate.props, previewSig: candidate.previewSig, who: this.#who(candidate), mine: false })
    }
    if (entries.length === 0) { this.#open_ = false; return }
    // A cap that bites is SAID OUT LOUD. Showing a subset silently would read
    // as "this is everything the room has", which is the one thing a chooser
    // must never lie about.
    const dropped = Math.max(0, offered.length - (entries.length - (mine && minePreview ? 1 : 0)))
    if (dropped > 0) {
      this.emitEffect('toast:show', {
        type: 'warning',
        message: `showing ${entries.length} of ${offered.length + 1} pictures — ${dropped} more are in the room`,
      })
    }

    // Decode every picture BEFORE painting: the hive lands once, complete,
    // never as a trickle of tiles popping in.
    for (const e of entries) {
      await this.#texture(e.previewSig)
      if (token !== this.#buildToken) return
    }

    const slots = this.#gridSlots(entries.length)
    const choices: Choice[] = []
    for (let i = 0; i < entries.length && i < slots.length; i++) {
      const p = this.#axialToPixel(slots[i].q, slots[i].r)
      choices.push({
        ...entries[i],
        slot: slots[i],
        pos: { x: p.x + this.#meshOffset.x, y: p.y + this.#meshOffset.y },
      })
    }
    if (choices.length === 0) { this.#open_ = false; return }
    this.#paint(choices)
  }

  #who(candidate: PeerImageCandidate): string {
    const names = candidate.peers.map(p => p.label || p.pubkey.slice(0, 8))
    return names.length <= 2 ? names.join(', ') : `${names[0]} +${names.length - 1}`
  }

  /** The image pointers already on the participant's own tile, read from the
   *  canonical properties slot (the layer) with the participant-local index as
   *  the fallback — the same two stores, in the same order, the renderer uses,
   *  so "yours" is whatever you can actually see on the tile. */
  async #myImageProps(label: string): Promise<PeerImageProps | undefined> {
    const pointers = (props: Record<string, unknown> | null): PeerImageProps | undefined => {
      if (!props) return undefined
      const out: PeerImageProps = {}
      const direct = props['imageSig']
      const small = (props['small'] as { image?: string } | undefined)?.image
      const flat = ((props['flat'] as { small?: { image?: string } } | undefined)?.small)?.image
      const point = (props['point'] as { image?: string } | undefined)?.image
      if (typeof direct === 'string') out.imageSig = direct
      if (typeof small === 'string') out.small = { image: small }
      if (typeof flat === 'string') out.flat = { small: { image: flat } }
      if (typeof point === 'string') out.point = { image: point }
      return previewSigOf(out) ? out : undefined
    }

    try {
      const canonical = pointers(await readTilePropertiesAt(this.#segments, label))
      if (canonical) return canonical
      const key = await cellLocationSig(this.#segments, label)
      const sig = readTilePropsIndex()[key] ?? readTilePropsIndex()[label]
      if (!sig) return undefined
      const blob = await this.#store()?.getResource?.(sig)
      return blob ? pointers(JSON.parse(await blob.text())) : undefined
    } catch { return undefined }
  }

  /** Restore the hive and drop everything the pick owned. Safe to call twice. */
  #close(): void {
    this.#buildToken++                       // cancel any in-flight resolution
    this.#open_ = false
    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer)
      this.#layer.destroy({ children: true })  // textures are cache-owned, not auto-destroyed
      this.#layer = null
    }
    this.#choices = []
    this.#choiceByAxial.clear()
    this.#hoverKey = null
    this.#pointers.clear()
    this.#panning = false
    this.#pinchStart = 0
    this.#zoom = 1                           // the next wall opens fitted, not where this one was left
    this.#label = ''
    this.#segments = []
    if (this.#hiveHidden) {
      this.#hiveHidden = false
      this.emitEffect('render:set-hive-visible', { visible: true })
    }
  }

  // ── the commit ────────────────────────────────────────────────────

  /**
   * Wear this picture. Pulls every pointer's bytes first — a picture nobody
   * can serve must not become your tile — then writes ONE revision carrying
   * the new pointers, drops the old full-size original (a peer publishes hex
   * thumbnails only, so keeping it would leave the lightbox showing a picture
   * the tile no longer wears) and the substrate default mark (a picture you
   * chose on purpose is not filler), and re-points the participant-local
   * index at the canonical sig so the tile repaints at once.
   */
  async #apply(choice: Choice): Promise<void> {
    if (this.#applying) return
    this.#applying = true
    const label = this.#label
    const segments = [...this.#segments]
    try {
      const sigs = [choice.props.small?.image, choice.props.flat?.small.image, choice.props.point?.image, choice.props.imageSig]
        .filter((s): s is string => typeof s === 'string')
      const blobs = await Promise.all(sigs.map(s => this.#bytes(s)))
      if (blobs.some(b => !b)) {
        this.emitEffect('toast:show', { type: 'warning', message: this.#t('images.failed', 'That picture could not be fetched — nothing changed.') })
        return
      }

      const existing = await readTilePropertiesAt(segments, label)
      const updates: Record<string, unknown> = {
        small: choice.props.small,
        flat: choice.props.flat,
        point: choice.props.point,
        imageSig: choice.props.imageSig,
        large: undefined,
        substrate: undefined,
      }
      const oldLarge = ((existing['large'] as { image?: string } | undefined)?.image) ?? ''
      if (oldLarge && existing['link'] === `${RESOURCE_URL_PREFIX}${oldLarge}`) updates['link'] = undefined

      // The props index follows via the central layer-keyed seed inside
      // writeTilePropertiesAt — no location write (Phase C sweep,
      // visuals-across-lineages.md).
      await writeTilePropertiesAt(segments, label, updates)

      this.emitEffect('tile:saved', { cell: label, segments })
    } catch (err) {
      console.warn('[image-choice] apply failed', err)
      this.emitEffect('toast:show', { type: 'warning', message: this.#t('images.failed', 'That picture could not be fetched — nothing changed.') })
    } finally {
      this.#applying = false
      this.#close()                          // the hive comes back wearing the pick
    }
  }

  // ── painting ──────────────────────────────────────────────────────

  #paint(choices: Choice[]): void {
    if (!this.#renderContainer) { this.#open_ = false; return }

    if (!this.#hiveHidden) {
      this.#hiveHidden = true
      this.emitEffect('render:set-hive-visible', { visible: false })
    }

    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer)
      this.#layer.destroy({ children: true })
    }

    const layer = new Container()
    layer.zIndex = PICK_Z
    const r = this.#circumRadius

    this.#choiceByAxial.clear()
    for (const c of choices) {
      const tile = this.#buildTile(r, c)
      tile.position.set(c.pos.x, c.pos.y)
      layer.addChild(tile)
      this.#choiceByAxial.set(`${c.slot.q},${c.slot.r}`, c)
    }

    // What you are choosing FOR, above the hive — without it a screen of
    // pictures says nothing about which tile is about to change.
    const title = new Text({
      text: `${this.#t('images.title', 'Images for')} ${this.#label} — ${this.#t('images.hint', 'click to use, Esc to cancel')}`,
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: r * 0.26,
        fontWeight: '600',
        fill: TITLE_FILL,
        align: 'center',
      },
    })
    title.resolution = LABEL_RESOLUTION(this.#worldScale())
    title.anchor.set(0.5)
    const top = Math.min(...choices.map(c => this.#axialToPixel(c.slot.q, c.slot.r).y))
    title.position.set(this.#meshOffset.x, top + this.#meshOffset.y - r * 1.7)
    layer.addChild(title)

    this.#renderContainer.addChild(layer)
    this.#layer = layer
    this.#choices = choices
    this.#hoverKey = null
    this.#fitToScreen(choices)
    this.#updateHover()
  }

  /**
   * Open showing ALL of them. A wall of a hundred pictures laid out at tile
   * size is far wider than the screen, and landing on a corner of it with no
   * clue that the rest exists is the same failure as capping the list. So the
   * wall is scaled to fit the viewport on arrival — zoomed out if there are
   * many, never zoomed IN past life size if there are few — and the wheel and
   * a drag take it from there.
   */
  #fitToScreen(choices: Choice[]): void {
    if (!this.#layer || !this.#renderer || choices.length === 0) return
    const r = this.#circumRadius * 2.2                 // tile + its label breathing room
    const xs = choices.map(c => c.pos.x)
    const ys = choices.map(c => c.pos.y)
    const width = Math.max(...xs) - Math.min(...xs) + r * 2
    const height = Math.max(...ys) - Math.min(...ys) + r * 2
    const scale = this.#containerScale()
    const viewW = this.#renderer.screen.width / scale
    const viewH = this.#renderer.screen.height / scale
    if (!(viewW > 0) || !(viewH > 0)) return

    this.#zoom = Math.max(ZOOM_MIN, Math.min(1, Math.min(viewW / width, viewH / height) * 0.9))
    this.#layer.scale.set(this.#zoom)
    // Hold the mesh centre still while scaling about the layer's origin, so the
    // wall opens centred where the hive was.
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2
    this.#layer.position.set(
      this.#meshOffset.x - cx * this.#zoom,
      this.#meshOffset.y - cy * this.#zoom,
    )
  }

  /** Accumulated scale of the render container — local units to renderer px. */
  #containerScale(): number {
    let s = 1
    for (let n = this.#renderContainer as Container | null; n; n = n.parent as Container | null) {
      s *= Math.abs(n.scale?.x ?? 1) || 1
    }
    return Number.isFinite(s) && s > 0 ? s : 1
  }

  #buildTile(tileR: number, c: Choice): Container {
    const node = new Container()

    const body = new Graphics()
    const verts = this.#hexVerts(0, 0, tileR)
    body.poly(verts, true)
    body.fill({ color: TILE_FILL, alpha: TILE_FILL_ALPHA })
    body.poly(verts, true)
    body.stroke({
      color: c.mine ? MINE_BORDER : TILE_BORDER,
      alpha: TILE_BORDER_ALPHA,
      width: c.mine ? MINE_BORDER_WIDTH : TILE_BORDER_WIDTH,
    })
    node.addChild(body)

    const tex = this.#textures.get(c.previewSig) ?? null
    if (tex) {
      const sprite = new Sprite(tex)
      sprite.anchor.set(0.5)
      const side = tileR * 1.75
      const s = Math.max(side / (tex.width || side), side / (tex.height || side))
      sprite.scale.set(s)
      const mask = new Graphics()
      mask.poly(this.#hexVerts(0, 0, tileR * 0.97), true)
      mask.fill({ color: 0xffffff })
      node.addChild(sprite)
      node.addChild(mask)
      sprite.mask = mask
    }

    // WHO is offering this picture — the only thing that distinguishes one
    // choice from another, so it is always on, over the picture, like the
    // mesh superimposes a tile's name.
    const size = tileR * LABEL_SIZE_FACTOR
    const who = tex ? c.who : `${c.who} · ${this.#t('images.unavailable', 'not sent')}`
    const text = new Text({
      text: who.length > 16 ? `${who.slice(0, 15)}…` : who,
      style: {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: size,
        fontWeight: '600',
        fill: TILE_LABEL_FILL,
        align: 'center',
      },
    })
    text.resolution = LABEL_RESOLUTION(this.#worldScale())
    text.anchor.set(0.5)
    const maxWidth = tileR * LABEL_MAX_WIDTH_FACTOR
    if (text.width > maxWidth) text.scale.set(maxWidth / text.width)
    // The SAME label band a real tile wears: the hex shader draws it centred
    // on the tile, 0.88 of the radius wide either side and one row (0.15 r)
    // high either side, black at 0.55 — so a choice reads as a tile with a
    // name on it, not as a picture with a box stuck to it.
    const band = new Graphics()
    band.rect(-tileR * BAND_HALF_WIDTH, -tileR * BAND_HALF_HEIGHT, tileR * BAND_HALF_WIDTH * 2, tileR * BAND_HALF_HEIGHT * 2)
    band.fill({ color: 0x000000, alpha: BAND_ALPHA })
    node.addChild(band)
    node.addChild(text)

    // Hover ring, toggled by #updateHover — built once so the highlight costs
    // a visibility flip per pointer move, never a rebuild.
    const ring = new Graphics()
    ring.poly(this.#hexVerts(0, 0, tileR), true)
    ring.stroke({ color: HOVER_BORDER, alpha: 0.95, width: HOVER_BORDER_WIDTH })
    ring.visible = false
    ring.label = 'hover-ring'
    node.addChild(ring)

    return node
  }

  /** Light up the picture under the cursor — the one a click commits to. A
   *  picture that never arrived is not lit: it cannot be chosen. */
  #updateHover(): void {
    if (!this.#layer) return
    const choice = this.#lastClient ? this.#nearestChoice(this.#lastClient.x, this.#lastClient.y) : null
    const hit = choice && this.#textures.get(choice.previewSig) && !choice.mine
      ? `${choice.slot.q},${choice.slot.r}` : null
    if (hit === this.#hoverKey) return
    this.#hoverKey = hit

    for (let i = 0; i < this.#choices.length; i++) {
      const c = this.#choices[i]
      const ring = (this.#layer.children[i] as Container | undefined)
        ?.children.find(child => (child as { label?: string }).label === 'hover-ring')
      if (ring) ring.visible = hit === `${c.slot.q},${c.slot.r}`
    }
  }

  #choiceUnderCursor(clientX: number, clientY: number): Choice | null {
    const choice = this.#nearestChoice(clientX, clientY)
    // An unresolved picture is a labelled hex, not a choice.
    return choice && (choice.mine || this.#textures.get(choice.previewSig)) ? choice : null
  }

  /**
   * The choice under a screen point — nearest centre within a hexagon's reach.
   *
   * NOT the hive's hex detector: that answers for the mesh's own untransformed
   * grid, and this wall pans and zooms independently of it, so asking the
   * detector would return the tile that WOULD be under the cursor if the wall
   * had never moved. Distance in the layer's own space is the honest question.
   */
  #nearestChoice(clientX: number, clientY: number): Choice | null {
    if (!this.#layer) return null
    const global = this.#toGlobal(clientX, clientY)
    if (!global) return null
    const p = this.#layer.toLocal(new Point(global.x, global.y))
    const reach = this.#circumRadius * 0.95
    let best: Choice | null = null
    let bestDistance = reach
    for (const c of this.#choices) {
      const d = Math.hypot(p.x - c.pos.x, p.y - c.pos.y)
      if (d < bestDistance) { bestDistance = d; best = c }
    }
    return best
  }

  // ── bytes ─────────────────────────────────────────────────────────

  #store() {
    return window.ioc.get<{ getResource?: (s: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
  }

  async #bytes(sig: string): Promise<Blob | null> {
    if (!sig) return null
    // Full cascade (local → host → mesh) with write-through to OPFS — the same
    // path the renderer's detached fill uses for a peer's picture.
    try { return await this.#store()?.getResource?.(sig) ?? null } catch { return null }
  }

  async #texture(sig: string): Promise<Texture | null> {
    if (this.#textures.has(sig)) return this.#textures.get(sig) ?? null
    let tex: Texture | null = null
    try {
      const blob = await this.#bytes(sig)
      if (blob) tex = Texture.from(await createImageBitmap(blob))
    } catch { tex = null }
    if (this.#textures.size >= TEXTURE_CACHE_MAX) {
      const oldest = this.#textures.keys().next().value
      if (oldest !== undefined) {
        try { this.#textures.get(oldest)?.destroy(true) } catch { /* gone */ }
        this.#textures.delete(oldest)
      }
    }
    this.#textures.set(sig, tex)
    return tex
  }

  // ── geometry (same transforms as wave-view / move-preview / tile-overlay) ──

  /**
   * `count` slots on the axial matrix a real layer is laid out on, spiralling
   * out from the centre — so the choices sit where tiles sit however many
   * there are. The hive's own AxialService answers first (identical placement
   * to a real layer), and the spiral below carries on past the end of it: that
   * service is sized for a layer, and a room can offer more pictures than a
   * layer has slots. Running out of slots must never mean dropping a picture.
   */
  #gridSlots(count: number): Axial[] {
    const axial = window.ioc.get<{ items?: Map<number, { q: number; r: number }> }>(
      '@diamondcoreprocessor.com/AxialService',
    )
    const out: Axial[] = []
    for (let i = 0; i < count; i++) {
      const item = axial?.items?.get(i)
      if (!item) break
      out.push({ q: item.q, r: item.r })
    }
    if (out.length >= count) return out

    // Spiral on: rings outward from the origin, skipping anything the service
    // already placed so the two halves never collide.
    const taken = new Set(out.map(s => `${s.q},${s.r}`))
    const DIRS: Axial[] = [
      { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
      { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
    ]
    const push = (s: Axial): void => {
      const key = `${s.q},${s.r}`
      if (taken.has(key)) return
      taken.add(key)
      out.push(s)
    }
    push({ q: 0, r: 0 })
    for (let ring = 1; out.length < count && ring < 64; ring++) {
      let hex: Axial = { q: -ring, r: ring }          // start on the ring's SW corner
      for (let side = 0; side < 6 && out.length < count; side++) {
        for (let step = 0; step < ring && out.length < count; step++) {
          push({ ...hex })
          hex = { q: hex.q + DIRS[side].q, r: hex.r + DIRS[side].r }
        }
      }
    }
    return out.slice(0, count)
  }

  /** A screen point in renderer (global) pixels. */
  #toGlobal(cx: number, cy: number): { x: number; y: number } | null {
    if (!this.#renderer || !this.#canvas) return null
    const events = (this.#renderer as { events?: { mapPositionToPoint?: (p: Point, x: number, y: number) => void } }).events
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, cx, cy)
      return { x: out.x, y: out.y }
    }
    const rect = this.#canvas.getBoundingClientRect()
    const screen = this.#renderer.screen
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height),
    }
  }

  #axialToPixel(q: number, r: number): { x: number; y: number } {
    return this.#flat
      ? { x: 1.5 * this.#spacing * q, y: Math.sqrt(3) * this.#spacing * (r + q / 2) }
      : { x: Math.sqrt(3) * this.#spacing * (q + r / 2), y: this.#spacing * 1.5 * r }
  }

  /** Accumulated scale from this container up to the stage — what a local unit
   *  actually measures on screen. Walked rather than read off worldTransform,
   *  which is a frame behind at paint time. */
  #worldScale(): number {
    let s = 1
    for (let n = this.#renderContainer as Container | null; n; n = n.parent as Container | null) {
      s *= Math.abs(n.scale?.x ?? 1) || 1
    }
    const dpr = globalThis.devicePixelRatio || 1
    const total = s * (this.#renderer?.resolution ?? 1) / dpr
    return Number.isFinite(total) && total > 0 ? total : 1
  }

  /** Pointy-top hex vertices about (cx, cy). */
  #hexVerts(cx: number, cy: number, radius: number): number[] {
    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 2
      verts.push(cx + radius * Math.cos(angle))
      verts.push(cy + radius * Math.sin(angle))
    }
    return verts
  }
}

const _imageChoice = new ImageChoiceDrone()
window.ioc.register('@diamondcoreprocessor.com/ImageChoiceDrone', _imageChoice)
