// sharing/image-choice.drone.ts
//
// THE IMAGES WALL — the pictures a tile holds, laid out as ordinary tiles.
// Click one and it becomes the tile's picture.
//
// A tile's pictures are a COLLECTION (the lightbox gallery, kept by
// `holdPictures`): every picture saved through the editor stays in it, so
// nothing a tile has worn is lost. Opening the wall replaces the mesh with that
// collection on the SAME axial matrix a real layer uses, then adds what other
// hosts publish under the tile's name and what the other participants in the
// swarm are showing for that name. Hosts are asked at `sign(name)`. The swarm
// is the live room, read at the canonical root and at the lineage you are in.
//
//   CLICK a tile → that picture becomes the tile's. One revision, undoable.
//                  Positioning is the editor's job, opened afterwards.
//   ESC / empty  → everything snaps back. Nothing was written.
//
// The hive is hidden through `render:set-hive-visible`, the same takeover lever
// wave-view and the screensaver use, and every exit path restores it. While the
// wall is up this drone OWNS the pointer so tile-overlay cannot act on the
// hidden layer beneath.
//
// A cross-host picture is a POINTER until clicked: its bytes are pulled for the
// preview, and again, as a guarantee, before anything is written. One nobody can
// serve paints as a labelled hex that refuses to be picked.
//
// MANY TILES, ONE AT A TIME. `images:open` may carry `labels` — the selected
// tiles, in selection order — and the wall then opens for each in turn
// (image-queue.ts). Choosing a picture moves on to the next tile; so does the
// SKIP tile at the end of the wall (or →). The caption counts "2 of 5 — name".
// Leaving the wall any other way (Esc, empty space, navigating, the window
// losing focus) ends the queue. Every step is said as `images:queue`, so the
// selection shelf can mark the tiles already answered. A single label is the
// wall exactly as it always was: no skip tile, no counter.

import {
  Drone,
  I18N_IOC_KEY,
  RESOURCE_URL_PREFIX,
  requestConfirm,
  type I18nProvider,
} from '@hypercomb/core'
import { Container, Graphics, Point, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import type { HostReadyPayload } from '../presentation/tiles/pixi-host.worker.js'
import { readTilePropertiesAt, writeTilePropertiesAt } from '../editor/tile-properties.js'
import { referenceEditsRootDefaultForLabel, referenceTargetForLabel } from '../commands/decoration-kind-index.js'
import { forgetPicture, forgetPreview, galleryImageSigsAt, holdPictures } from '../commands/lightbox-kind.js'
import { imageWallHasChoice } from './image-collection.js'
import { fetchThroughContentHop, terminalContentSig } from '../presentation/tiles/artifact-content.js'
import { canonicalPeerImageCandidates, type PeerImageCandidate, type PeerImageProps } from './peer-images.js'
import { imageChoiceWriteTargets } from './image-choice-targets.js'
import { markSeen, unseenNow } from './image-updates.js'
import { ImageQueue } from './image-queue.js'
import { readThumbnail, type ThumbnailStore } from '../presentation/tiles/thumbnails.js'
import { FILL_HEX_R, divideBySheet, fillFrame, readFillSheet, type FillDivision, type FillOrientation } from '../presentation/tiles/fill-sprite.js'

type Axial = { q: number; r: number }

/** One choice on screen. `held` is a picture of the tile's own collection (its
 *  large bytes); otherwise it is a cross-host picture carried by pointers.
 *  `pos` is in the wall layer's own coordinates. */
type Choice = {
  slot: Axial
  pos: { x: number; y: number }
  props: PeerImageProps
  previewSig: string
  who: string
  mine: boolean
  held: boolean
  /** Offered by a domain and not yet shown to this participant — the reason a badge was raised. */
  fresh?: boolean
  /** Not a picture: the queue's skip tile, which moves on to the next tile. */
  skip?: boolean
  /** The stand-in tile shown while hosts and the swarm are still answering. */
  pending?: boolean
}
type ChoiceEntry = Omit<Choice, 'slot' | 'pos'>

const PICK_Z = 7006                 // above wave-view's dive (7005)
// There is no small cap. A room of a hundred people is a hundred pictures and
// the wall is meant to hold them — this is only a runaway guard, and when it
// bites it SAYS SO rather than quietly showing a subset.
const MAX_CHOICES = 400
const ZOOM_MIN = 0.15
/** Screen px kept clear at the top for the caption, and at the other edges. */
const WALL_HEADER_PX = 76
const WALL_MARGIN_PX = 24
/** The wall is fitted a little under full, so it breathes inside its area. */
const WALL_SHRINK = 0.88
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
const CAPTION_SOURCE = 'images'
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
const TEXTURE_TIMEOUT_MS = 20000
/** Longest side of a wall thumbnail — a wall hex is ~60px across at life size. */
const THUMB_PX = 96

export class ImageChoiceDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  override description =
    'The images wall: the pictures a tile holds, plus what other hosts publish for its name, as tiles — click one and it becomes the tile\'s.'

  // ── render plumbing ───────────────────────────────────────────────
  #renderContainer: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: HostReadyPayload['renderer'] | null = null
  #meshOffset = { x: 0, y: 0 }
  #spacing = 38                             // centre-to-centre: circumradius + gap
  #circumRadius = 32                        // the hex itself
  #flat = false

  // ── wall state ────────────────────────────────────────────────────
  #label = ''                               // the tile being dressed
  #segments: string[] = []                  // its PARENT path
  #layer: Container | null = null
  #choices: Choice[] = []
  #hoverKey: string | null = null
  #hoverChoice: Choice | null = null
  #forgetting = false
  #hiveHidden = false
  #buildToken = 0
  #applying = false
  // A browser synthesizes `click` after the pointerup that chooses a picture.
  // This one-shot latch keeps that trailing click from landing on (and
  // navigating into) the restored hive.
  #suppressTrailingClick = false
  #lastClient: { x: number; y: number } | null = null
  /** Armed from the open until the wall is painted, and the place it opened at;
   *  a cell-count from anywhere else means the participant navigated away. */
  #open_ = false
  #openedAt = ''
  /** The tiles still to dress when many were asked for at once. Survives the
   *  #close every #open begins with; only leaving the wall ends it. */
  #queue = new ImageQueue()

  #textures = new Map<string, Texture | null>()
  #inflight = new Set<string>()
  /** Sigs whose texture is a frame of a fill sheet (shares the sheet's source). */
  #sheetCut = new Set<string>()
  /** The decoded sheets those frames are cut from; released on dispose. */
  #sheetBases: Texture[] = []
  #entries: ChoiceEntry[] = []
  #loading = false
  #repaintQueued = false

  protected override listens = [
    'render:host-ready', 'render:mesh-offset', 'render:geometry-changed',
    'render:set-orientation', 'images:open', 'render:cell-count',
  ]
  protected override emits = ['render:set-hive-visible', 'tile:hover', 'caption:show', 'caption:clear', 'tile:saved', 'toast:show', 'thumbnail:wanted', 'images:queue']

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
    this.onEffect<{ flat?: boolean }>('render:set-orientation', (p) => { this.#reorient(!!p?.flat) })

    this.onEffect<{ label?: string; labels?: readonly string[]; segments?: readonly string[] }>('images:open', (payload) => {
      const segments = payload?.segments ?? []
      // Two or more tiles: the wall opens for each in turn. One is today's wall.
      const labels = Array.isArray(payload?.labels) ? payload.labels : []
      if (new Set(labels.map(l => String(l ?? '').trim()).filter(Boolean)).size > 1) {
        const first = this.#queue.start(labels, segments)
        this.#emitQueue()
        if (first) void this.#open(first, this.#queue.segments)
        return
      }
      const label = String(payload?.label ?? labels[0] ?? '').trim()
      if (!label) return
      this.#endQueue()                          // a plain open is not part of a queue
      void this.#open(label, segments)
    })

    // A layer landing under the wall: back out ONLY when it is a different PLACE.
    this.onEffect('render:cell-count', () => {
      if (!this.#layer && !this.#open_) return
      if (this.#locationKey() !== this.#openedAt) { this.#close(); this.#endQueue() }
    })

    window.addEventListener('pointermove', this.#onPointerMove, true)
    window.addEventListener('pointerdown', this.#onPointerDown, true)
    window.addEventListener('pointerup', this.#onPointerUp, true)
    window.addEventListener('pointercancel', this.#onPointerUp, true)
    window.addEventListener('click', this.#onClick, true)
    window.addEventListener('keydown', this.#onKeyDown, true)
    window.addEventListener('blur', this.#onWindowBlur)
  }

  protected override dispose(): void {
    window.removeEventListener('pointermove', this.#onPointerMove, true)
    window.removeEventListener('pointerdown', this.#onPointerDown, true)
    window.removeEventListener('pointerup', this.#onPointerUp, true)
    window.removeEventListener('pointercancel', this.#onPointerUp, true)
    window.removeEventListener('click', this.#onClick, true)
    window.removeEventListener('keydown', this.#onKeyDown, true)
    window.removeEventListener('blur', this.#onWindowBlur)
    this.#close()                            // never strand a hidden hive
    this.#endQueue()
    for (const sig of [...this.#textures.keys()]) this.#drop(sig)
    for (const base of this.#sheetBases) { try { base.destroy(true) } catch { /* gone */ } }
    this.#sheetBases = []
  }

  #locationKey(): string {
    const segs = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
      ?.explorerSegments?.() ?? []
    return segs.map(s => String(s ?? '').trim()).filter(Boolean).join('/')
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const value = window.ioc.get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    if (value && value !== key) return value
    return params ? fallback.replace(/\{(\w+)\}/g, (all, token: string) => token in params ? String(params[token]) : all) : fallback
  }

  // ── input ─────────────────────────────────────────────────────────

  #onPointerMove = (e: PointerEvent): void => {
    this.#lastClient = { x: e.clientX, y: e.clientY }
    if (!this.#layer) return
    e.stopPropagation()
    this.#updateHover()
  }

  #onPointerDown = (e: PointerEvent): void => {
    if (!this.#layer) return
    e.preventDefault()
    e.stopImmediatePropagation()             // tile-overlay must not act on the hidden layer
    if (e.button !== 0 && e.pointerType === 'mouse') this.#close()
  }

  /** The PICK happens on release. */
  #onPointerUp = (e: PointerEvent): void => {
    if (!this.#layer) return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const choice = this.#choiceUnderCursor(e.clientX, e.clientY)
    this.#suppressTrailingClick = true
    // The small x on a latent picture of this tile forgets it, never picks it.
    const forgettable = this.#nearestChoice(e.clientX, e.clientY)
    if (forgettable && this.#canForget(forgettable) && this.#onForgetBadge(forgettable, e.clientX, e.clientY)) { void this.#forget(forgettable); return }
    // The skip tile answers this tile with "none" and moves on.
    if (choice?.skip) { this.#skip(); return }
    // Empty space backs out; the picture already worn has nothing to write.
    if (!choice || choice.mine) { this.#dismiss(); return }
    void this.#apply(choice)
  }

  #onClick = (e: MouseEvent): void => {
    // While the wall is visible it owns clicks. After a selection closes it,
    // swallow exactly the synthesized click belonging to that release.
    if (!this.#layer && !this.#suppressTrailingClick) return
    this.#suppressTrailingClick = false
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.#layer) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.#hoverChoice && this.#canForget(this.#hoverChoice)) {
      e.preventDefault()
      e.stopPropagation()
      void this.#forget(this.#hoverChoice)
      return
    }
    // → is the skip tile from the keyboard, only while a queue runs and no
    // pick is still being written.
    if (e.key === 'ArrowRight' && this.#queue.running && !this.#applying) {
      e.preventDefault()
      e.stopPropagation()
      this.#skip()
      return
    }
    if (e.key !== 'Escape') return
    e.stopPropagation()
    this.#dismiss()
  }

  // ── forgetting a latent picture (local gallery only; peers get none) ──

  #canForget(c: Choice): boolean { return c.held && !c.mine && !c.skip }

  #onForgetBadge(c: Choice, clientX: number, clientY: number): boolean {
    if (!this.#layer) return false
    const global = this.#toGlobal(clientX, clientY)
    if (!global) return false
    const p = this.#layer.toLocal(new Point(global.x, global.y))
    const r = this.#circumRadius
    return Math.hypot(p.x - (c.pos.x + r * 0.62), p.y - (c.pos.y - r * 0.62)) < r * 0.3
  }

  async #forget(c: Choice): Promise<void> {
    if (this.#forgetting) return
    this.#forgetting = true
    const label = this.#label
    const segments = [...this.#segments]
    try {
      const address = [...segments, label]
      const preview = await forgetPreview(address, c.props.imageSig ?? '')
      if (preview.worn) { this.emitEffect('toast:show', { type: 'info', message: this.#t('images.forget-worn', 'That is the picture this tile wears — it cannot be removed.') }); return }
      if (!preview.held) return
      // ONE confirmation, stating the outcome. Keys: the dialog runs them through t.
      const confirmed = await requestConfirm({
        title: 'images.forget-title',
        message: preview.bytesGo ? 'images.forget-bytes' : 'images.forget-shared',
        messageParams: { size: formatBytes(preview.size) },
        warning: 'images.forget-warning',
        confirmLabel: 'images.forget-label',
        danger: true,
      })
      if (!confirmed) return
      const result = await forgetPicture(address, c.props.imageSig ?? '')
      if (result.reason === 'worn') { this.emitEffect('toast:show', { type: 'info', message: this.#t('images.forget-worn', 'That is the picture this tile wears — it cannot be removed.') }); return }
      if (!result.removed) return
      this.#drop(c.previewSig)
      this.emitEffect('toast:show', { type: 'info', message: result.bytesRemoved ? this.#t('images.forgot', 'Picture removed') : this.#t('images.forgot-kept', 'Picture removed from this tile; the file stays because another tile uses it.') })
      await this.#open(label, segments)         // repaint the wall without it
    } catch (err) {
      console.warn('[image-choice] forget failed', err)
    } finally {
      this.#forgetting = false
    }
  }

  #onWindowBlur = (): void => {
    this.#close()
    this.#endQueue()
  }

  // ── the queue: many tiles, one wall each ──────────────────────────

  /** Say where the queue stands. Last-value, so a shelf opened late reads it. */
  #emitQueue(): void {
    this.emitEffect('images:queue', this.#queue.state())
  }

  /** End the queue, if one runs, and say so — once. */
  #endQueue(): void {
    if (!this.#queue.running) return
    this.#queue.end()
    this.#emitQueue()
  }

  /** The tile on the wall is answered; open the wall for the next one, or close
   *  for good after the last. */
  #advance(): void {
    if (!this.#queue.running) return
    const next = this.#queue.advance()
    this.#emitQueue()
    if (next) void this.#open(next, this.#queue.segments)
    else this.#close()
  }

  /** Skip: this tile keeps what it wears. Nothing is written, nothing marked seen.
   *  Not while a pick is being written: that pick's own close would then shut
   *  the NEXT tile's wall and count it done, though nobody saw it. */
  #skip(): void {
    if (!this.#queue.running || this.#applying) return
    this.#close()
    this.#advance()
  }

  // ── lifecycle ─────────────────────────────────────────────────────

  /** Gather the tile's pictures and what other hosts publish for its name,
   *  decode them, and put them on the grid. Nothing is hidden until there is a
   *  complete wall to put in the hive's place. */
  async #open(label: string, segments: readonly string[]): Promise<void> {
    this.#close()
    // #close invalidates any older build. Mint this opening's token AFTER it.
    const token = ++this.#buildToken
    this.#open_ = true
    this.#label = label
    this.#segments = segments.map(s => String(s ?? '').trim()).filter(Boolean)
    this.#openedAt = this.#segments.join('/')

    const worn = await this.#wornLarge(label)
    const held = await galleryImageSigsAt([...this.#segments, label])
    if (token !== this.#buildToken) return

    const entries: ChoiceEntry[] = held.slice(0, MAX_CHOICES).map((imageSig, i) => ({
      props: { imageSig },
      previewSig: imageSig,
      who: imageSig === worn ? this.#t('images.yours', 'yours') : `${i + 1}`,
      mine: imageSig === worn,
      held: true,
    }))
    // The picture the tile wears belongs on the wall even when the collection
    // has not recorded it yet.
    if (worn && !entries.some(entry => entry.previewSig === worn)) {
      entries.unshift({
        props: { imageSig: worn },
        previewSig: worn,
        who: this.#t('images.yours', 'yours'),
        mine: true,
        held: true,
      })
    }
    if (entries.length > MAX_CHOICES) entries.length = MAX_CHOICES

    // Paint at once with what is held. Hosts and the swarm answer later: a
    // loading tile stands in for them, and each picture fills its tile as its
    // bytes land. Nothing on this path waits on the network.
    this.#entries = entries
    this.#loading = true
    this.#paintNow(token)
    this.#loadTextures(token, entries)

    void this.#gatherOffered(token, label, entries)
  }

  /** Hosts at `sign(name)`, plus the pictures the swarm is showing for this
   *  name, folded into the wall as they arrive. */
  async #gatherOffered(token: number, label: string, entries: ChoiceEntry[]): Promise<void> {
    const offered = await canonicalPeerImageCandidates(label).catch(() => [] as readonly PeerImageCandidate[])
    const fresh = await unseenNow(label).catch(() => new Set<string>() as ReadonlySet<string>)
    if (token !== this.#buildToken) return
    const added: ChoiceEntry[] = []
    for (const candidate of offered) {
      if (entries.length >= MAX_CHOICES) break
      if (entries.some(entry => entry.previewSig === candidate.previewSig)) continue
      const entry: ChoiceEntry = { props: candidate.props, previewSig: candidate.previewSig, who: this.#who(candidate), mine: false, held: false, fresh: fresh.has(candidate.previewSig) }
      entries.push(entry)
      added.push(entry)
    }
    this.#loading = false
    // One picture the tile is not wearing is still a choice — a paste onto
    // the tile that has not been picked yet. The worn picture alone is not.
    if (!imageWallHasChoice(entries)) {
      this.#close()
      // In a queue a tile with nothing to choose is answered as it stands: say
      // so, and carry on to the next rather than stopping the whole run.
      if (this.#queue.running) {
        this.emitEffect('toast:show', { type: 'info', message: this.#t('images.none-next', 'Nothing to choose for "{cell}" — on to the next tile.', { cell: label }) })
        this.#advance()
        return
      }
      this.emitEffect('toast:show', { type: 'info', message: this.#t('images.none', 'Only one picture for this tile — nothing to choose from yet.') })
      return
    }
    this.#paintNow(token)
    this.#loadTextures(token, added)
  }

  /** Start every picture's bytes; each repaints the wall as it lands. What is
   *  needed is DIVIDED first: a fill sheet holding two or more of these is one
   *  read and one decode, cut into frames; the rest load one by one. */
  #loadTextures(token: number, entries: readonly ChoiceEntry[]): void {
    const wanted = entries.map(entry => entry.previewSig).filter(sig => sig && !this.#textures.has(sig))
    if (!wanted.length) return
    for (const sig of wanted) this.#inflight.add(sig)
    const store = this.#store() as ThumbnailStore | undefined
    void (async () => {
      const division = store?.getPool
        // The wall draws in the hive's orientation, so it reads that sheet of each pair.
        ? await divideBySheet(store, wanted, this.#orientation()).catch(() => ({ sheets: new Map(), singles: wanted }) as FillDivision)
        : { sheets: new Map(), singles: wanted } as FillDivision
      for (const [sheet, members] of division.sheets) {
        void this.#cutSheet(store!, sheet, members).then(missed => {
          this.#scheduleRepaint(token)
          for (const sig of missed) void this.#texture(sig).then(() => this.#scheduleRepaint(token))
        })
      }
      for (const sig of division.singles) {
        this.#inflight.delete(sig)
        void this.#texture(sig).then(() => this.#scheduleRepaint(token))
      }
    })()
  }

  /** Decode one fill sheet and cut a texture per wanted slot. Returns the sigs
   *  it could not serve (sheet reaped, undecodable) for the single path. */
  async #cutSheet(store: ThumbnailStore, sheet: string, members: readonly { sig: string; slot: number }[]): Promise<string[]> {
    const release = (): string[] => {
      for (const member of members) this.#inflight.delete(member.sig)
      return members.map(member => member.sig)
    }
    try {
      const blob = await readFillSheet(store, sheet)
      if (!blob) return release()
      const base = Texture.from(await createImageBitmap(blob))
      this.#sheetBases.push(base)
      const missed: string[] = []
      for (const { sig, slot } of members) {
        this.#inflight.delete(sig)
        if (this.#textures.has(sig)) continue
        const frame = fillFrame(slot, this.#orientation())
        // A slot past the sheet's edge is a record that outran its sheet.
        if (frame.x + frame.width > base.width || frame.y + frame.height > base.height) { missed.push(sig); continue }
        this.#sheetCut.add(sig)
        this.#remember(sig, new Texture({ source: base.source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) }))
      }
      return missed
    } catch {
      return release()
    }
  }

  /** Destroy a cached texture. A frame cut from a sheet shares the sheet's
   *  source, so only the frame goes — never the source under its neighbours. */
  #drop(sig: string): void {
    const tex = this.#textures.get(sig)
    try { tex?.destroy(!this.#sheetCut.has(sig)) } catch { /* gone */ }
    this.#textures.delete(sig)
    this.#sheetCut.delete(sig)
  }

  #scheduleRepaint(token: number): void {
    if (this.#repaintQueued || token !== this.#buildToken) return
    this.#repaintQueued = true
    setTimeout(() => {
      this.#repaintQueued = false
      if (token === this.#buildToken) this.#paintNow(token)
    }, 60)
  }

  #paintNow(token: number): void {
    if (token !== this.#buildToken || !this.#open_) return
    this.#paintEntries(this.#entries)
  }

  /** What the caption says under the title: the tile, and — when some pictures are
   *  new — how to answer them. */
  #wallText(choices: readonly Choice[]): string {
    // In a queue the tile is named with where it stands: "2 of 5 — garden".
    const { index, total } = this.#queue.position()
    const name = this.#queue.running && total > 1
      ? `${this.#t('images.queue-of', '{index} of {total}', { index, total })} — ${this.#label}`
      : this.#label
    return choices.some(c => c.fresh)
      ? `${name} — ${this.#t('images.dismiss', 'new pictures are ringed; Esc dismisses them')}`
      : name
  }

  #paintEntries(entries: readonly ChoiceEntry[]): void {
    // While hosts and the swarm are still being asked, one more tile says so.
    const shown: ChoiceEntry[] = this.#loading
      ? [...entries, { props: { imageSig: '' }, previewSig: '', who: this.#t('images.loading', 'loading…'), mine: false, held: false, pending: true }]
      : [...entries]
    // In a queue the skip tile sits after the pictures, on the same matrix, so
    // moving on is a tile like any choice — never a button bolted onto the canvas.
    if (this.#queue.running) {
      shown.push({ props: {}, previewSig: '', who: this.#t('images.skip', 'skip ›'), mine: false, held: false, skip: true })
    }
    const slots = this.#gridSlots(shown.length)
    const choices: Choice[] = shown.slice(0, slots.length).map((entry, index) => {
      const p = this.#axialToPixel(slots[index].q, slots[index].r)
      return { ...entry, slot: slots[index], pos: { x: p.x + this.#meshOffset.x, y: p.y + this.#meshOffset.y } }
    })
    if (choices.length) this.#paint(choices)
  }

  #who(candidate: PeerImageCandidate): string {
    const names = candidate.peers.map(p => p.label || p.pubkey.slice(0, 8))
    return names.length <= 2 ? names.join(', ') : `${names[0]} +${names.length - 1}`
  }

  /** The signature of the picture the tile wears now (its large copy), read
   *  from the tile's own properties. */
  async #wornLarge(label: string): Promise<string> {
    try {
      // A Portal row READS what it dresses: the target where the item lives.
      const [target] = imageChoiceWriteTargets(this.#segments, label, this.#portalTarget(label))
      if (!target) return ''
      const props = await readTilePropertiesAt(target.parentSegments, target.cell)
      const large = (props['large'] as { image?: unknown } | undefined)?.image
      if (typeof large !== 'string') return ''
      // Stored as a content hop; the collection is compared at its terminal bytes.
      const store = window.ioc.get<{ getResourceLocal(sig: string): Promise<Blob | null> }>('@hypercomb.social/Store')
      return (store ? await terminalContentSig(store, large) : null) ?? large
    } catch { return '' }
  }

  /** The route a Portal default-authoring row points at; null for any other
   *  tile, so it dresses its own appearance. Never the hive root. */
  #portalTarget(label: string): readonly string[] | null {
    return referenceEditsRootDefaultForLabel(label) ? referenceTargetForLabel(label) : null
  }

  /** Close the wall having LOOKED: every picture on it is marked seen, so the
   *  tile's new-pictures badge is answered. (Leaving by navigating away, or the
   *  window losing focus, is not an answer — that is a plain #close.) */
  #dismiss(): void {
    const label = this.#label
    const shown = this.#shownSigs()
    this.#close()
    this.#endQueue()                         // leaving the wall ends the run of tiles
    if (label && shown.length) void markSeen(label, shown)
  }

  /** The pictures on the wall — the skip and loading tiles are not. */
  #shownSigs(): string[] {
    return this.#choices.filter(c => !c.skip && !c.pending).map(c => c.previewSig)
  }

  /** Restore the hive and drop everything the wall owned. Safe to call twice. */
  #close(): void {
    this.#buildToken++                       // cancel any in-flight resolution
    this.#open_ = false
    this.emitEffect('caption:clear', { source: CAPTION_SOURCE })
    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer)
      this.#layer.destroy({ children: true })  // textures are cache-owned, not auto-destroyed
      this.#layer = null
    }
    this.#choices = []
    this.#hoverKey = null
    this.#hoverChoice = null
    this.#label = ''
    this.#segments = []
    if (this.#hiveHidden) {
      this.#hiveHidden = false
      this.emitEffect('render:set-hive-visible', { visible: true })
    }
  }

  // ── the commit ────────────────────────────────────────────────────

  /**
   * Wear this picture, as ONE revision.
   *
   * A held picture is the tile's large copy: it becomes `large` at its default
   * framing and the stale thumbnails go, so the tile paints from it at once and
   * the editor — opened afterwards — positions it. A cross-host picture has its
   * bytes pulled first (one nobody can serve must not become the tile), then its
   * pointers are written and the picture joins the tile's collection, so it
   * stays after the next pick. Either way the substrate default mark goes (a
   * picture chosen on purpose is not filler).
   */
  async #apply(choice: Choice): Promise<void> {
    if (this.#applying) return
    this.#applying = true
    const label = this.#label
    const segments = [...this.#segments]
    const shown = this.#shownSigs()
    let worn = false
    try {
      const sigs = choice.held
        ? [choice.props.imageSig]
        : [choice.props.small?.image, choice.props.flat?.small.image, choice.props.point?.image, choice.props.imageSig, choice.props.large?.image]
      const blobs = await Promise.all(sigs.filter((s): s is string => typeof s === 'string').map(s => this.#bytes(s)))
      if (blobs.some(b => !b)) {
        this.emitEffect('toast:show', { type: 'warning', message: this.#t('images.failed', 'That picture could not be fetched — nothing changed.') })
        return
      }

      // Readers follow the Life Primitive hop explicitly — every fetch here goes
      // through `fetchThroughContentHop`; `getResource` does not do it alone.
      // The place captured at the click: a wall closed mid-fetch (focus lost)
      // has emptied #segments, and the pick must not land at the hive root.
      const targets = imageChoiceWriteTargets(segments, label, this.#portalTarget(label))
      for (const target of targets) {
        const existing = await readTilePropertiesAt(target.parentSegments, target.cell)
        const oldLarge = ((existing['large'] as { image?: string } | undefined)?.image) ?? ''
        const updates: Record<string, unknown> = choice.held
          ? {
              large: { image: choice.props.imageSig, x: 0, y: 0, scale: 1 },
              small: undefined, flat: undefined, point: undefined, imageSig: undefined, substrate: undefined,
            }
          : {
              small: choice.props.small,
              flat: choice.props.flat,
              point: choice.props.point,
              imageSig: choice.props.imageSig,
              // A publisher whose tile wears `large` alone: so does this one,
              // at the default framing the held path uses.
              large: choice.props.large ? { image: choice.props.large.image, x: 0, y: 0, scale: 1 } : undefined,
              substrate: undefined,
            }
        if (oldLarge && existing['link'] === `${RESOURCE_URL_PREFIX}${oldLarge}`) {
          updates['link'] = undefined
        }
        if (!choice.held) {
          // The collection is the tile's memory of every picture it has worn:
          // keep what this replaces and what it becomes.
          await holdPictures([...target.parentSegments, target.cell], [oldLarge, choice.previewSig]).catch(() => undefined)
        }
        await writeTilePropertiesAt(target.parentSegments, target.cell, updates)
        this.emitEffect('tile:saved', {
          cell: target.cell,
          segments: target.parentSegments,
        })
      }
      // Taking a picture answers the badge: everything on the wall was seen.
      if (shown.length) void markSeen(label, shown)
      worn = true
    } catch (err) {
      console.warn('[image-choice] apply failed', err)
      this.emitEffect('toast:show', { type: 'warning', message: this.#t('images.failed', 'That picture could not be fetched — nothing changed.') })
    } finally {
      this.#applying = false
      this.#close()                          // the hive comes back wearing the pick
      // In a queue: a pick moves on to the next tile; a pick that could not be
      // fetched leaves this tile unanswered, so its wall opens again.
      if (this.#queue.running) {
        if (worn) this.#advance()
        else void this.#open(label, segments)
      }
    }
  }

  // ── painting ──────────────────────────────────────────────────────

  #paint(choices: Choice[]): void {
    if (!this.#renderContainer) { this.#open_ = false; this.#endQueue(); return }

    if (!this.#hiveHidden) {
      this.#hiveHidden = true
      // The tile under the pointer when the wall opened is no longer there to be
      // hovered — clear it so no hover text (name, holder count, band) is left.
      this.emitEffect('tile:hover', { label: null })
      this.emitEffect('render:set-hive-visible', { visible: false })
    }

    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer)
      this.#layer.destroy({ children: true })
    }

    const layer = new Container()
    layer.zIndex = PICK_Z
    const r = this.#circumRadius

    for (const c of choices) {
      const tile = this.#buildTile(r, c)
      tile.position.set(c.pos.x, c.pos.y)
      layer.addChild(tile)
    }

    // What you are choosing FOR — a screen of pictures says nothing about which
    // tile is about to change, so the caption (top-centre, under the command
    // line) names it. Cleared by #close with the rest of the wall.
    this.emitEffect('caption:show', { source: CAPTION_SOURCE, title: this.#t('images.select', 'select image'), text: this.#wallText(choices) })

    this.#renderContainer.addChild(layer)
    this.#layer = layer
    this.#choices = choices
    this.#hoverKey = null
    this.#fitToScreen(choices)
    this.#updateHover()
  }

  /** Open showing ALL of them: the wall is scaled to fit the viewport — zoomed
   *  out if there are many, never in past life size — centred where the hive was. */
  #fitToScreen(choices: Choice[]): void {
    if (!this.#layer || !this.#renderer || choices.length === 0) return
    const r = this.#circumRadius * 2.2                 // tile + its label breathing room
    const xs = choices.map(c => c.pos.x)
    const ys = choices.map(c => c.pos.y)
    const width = Math.max(...xs) - Math.min(...xs) + r * 2
    const height = Math.max(...ys) - Math.min(...ys) + r * 2
    const scale = this.#containerScale()
    const screen = this.#renderer.screen
    // The caption owns a band at the top (under the command line); the wall is
    // fitted into what is left and centred in it, so nothing runs under the
    // header or off the bottom — never anchored on the hive's own centre, which
    // is not the middle of the space that remains.
    const areaTop = Math.min(WALL_HEADER_PX, screen.height * 0.25)
    const areaW = screen.width - WALL_MARGIN_PX * 2
    const areaH = screen.height - areaTop - WALL_MARGIN_PX
    const viewW = areaW / scale
    const viewH = areaH / scale
    if (!(viewW > 0) || !(viewH > 0)) return

    const zoom = Math.max(ZOOM_MIN, Math.min(1, Math.min(viewW / width, viewH / height) * WALL_SHRINK))
    this.#layer.scale.set(zoom)
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2
    const target = this.#renderContainer
      ? this.#renderContainer.toLocal(new Point(WALL_MARGIN_PX + areaW / 2, areaTop + areaH / 2))
      : { x: this.#meshOffset.x, y: this.#meshOffset.y }
    this.#layer.position.set(target.x - cx * zoom, target.y - cy * zoom)
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
    // Image choosing is visual comparison: dimming an option hides the very
    // information needed to choose it. Every picture and theme entrance stays
    // fully opaque; the current image is identified by its stronger border.
    node.alpha = 1

    const body = new Graphics()
    const verts = this.#hexVerts(0, 0, tileR)
    body.poly(verts, true)
    body.fill({ color: TILE_FILL, alpha: TILE_FILL_ALPHA })
    body.poly(verts, true)
    body.stroke({
      // The skip tile wears the mint hairline a click would light, at the plain width.
      color: c.mine ? MINE_BORDER : c.fresh || c.skip ? HOVER_BORDER : TILE_BORDER,
      alpha: TILE_BORDER_ALPHA,
      width: c.mine ? MINE_BORDER_WIDTH : c.fresh ? HOVER_BORDER_WIDTH : TILE_BORDER_WIDTH,
    })
    node.addChild(body)

    const tex = c.skip ? null : this.#textures.get(c.previewSig) ?? null
    if (tex) {
      const sprite = new Sprite(tex)
      sprite.anchor.set(0.5)
      if (this.#sheetCut.has(c.previewSig)) {
        // A sheet frame is a hexagon's bounding box whose corners hold its
        // neighbours: the cell's own hexagon is drawn at the tile's radius,
        // so the clip below (0.97 r) shows this cell and nothing beside it.
        sprite.scale.set(tileR / FILL_HEX_R)
      } else {
        const side = tileR * 1.75
        sprite.scale.set(Math.max(side / (tex.width || side), side / (tex.height || side)))
      }
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
    const waiting = c.pending || this.#inflight.has(c.previewSig)
    const who = tex || c.pending || c.skip ? c.who : `${c.who} · ${waiting ? this.#t('images.loading', 'loading…') : this.#t('images.unavailable', 'not sent')}`
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

    // The forget affordance: a small x, shown only while a latent picture of this
    // tile is hovered (Delete does the same). Peer pictures never get one.
    if (this.#canForget(c)) {
      const badge = new Container()
      badge.label = 'forget-badge'
      badge.visible = false
      const disc = new Graphics()
      disc.circle(0, 0, tileR * 0.22)
      disc.fill({ color: 0x000000, alpha: 0.75 })
      const mark = new Text({ text: '×', style: { fontFamily: 'system-ui, sans-serif', fontSize: tileR * 0.34, fontWeight: '700', fill: 0xffb4a8 } })
      mark.anchor.set(0.5)
      badge.addChild(disc)
      badge.addChild(mark)
      badge.position.set(tileR * 0.62, -tileR * 0.62)
      node.addChild(badge)
    }

    return node
  }

  /** Light up the picture under the cursor — the one a click commits to. A
   *  picture that never arrived is not lit: it cannot be chosen. */
  #updateHover(): void {
    if (!this.#layer) return
    const choice = this.#lastClient ? this.#nearestChoice(this.#lastClient.x, this.#lastClient.y) : null
    const hit = choice && (choice.skip || this.#textures.get(choice.previewSig)) && !choice.mine
      ? `${choice.slot.q},${choice.slot.r}` : null
    if (hit === this.#hoverKey) return
    this.#hoverKey = hit
    this.#hoverChoice = choice && hit ? choice : null
    // Who offers the picture under the pointer — the caption says it, so the
    // tile itself stays a picture. Back to the wall's own words when none is hovered.
    // The skip tile says where it goes: the next tile's name, or that this is the last.
    if (choice?.skip && hit) {
      const next = this.#queue.peekNext()
      this.emitEffect('caption:show', {
        source: CAPTION_SOURCE,
        title: this.#t('images.skip-title', 'skip this tile'),
        text: next
          ? this.#t('images.skip-next', 'next: {cell}', { cell: next })
          : this.#t('images.skip-last', 'the last tile — the wall closes'),
      })
    }
    else if (choice && hit) this.emitEffect('caption:show', { source: CAPTION_SOURCE, title: choice.who, text: choice.held ? this.#t('images.held', 'held on this tile') : choice.fresh ? this.#t('images.fresh', 'new — not seen before') : this.#t('images.offered', 'offered by another host') })
    else this.emitEffect('caption:show', { source: CAPTION_SOURCE, title: this.#t('images.select', 'select image'), text: this.#wallText(this.#choices) })

    for (let i = 0; i < this.#choices.length; i++) {
      const c = this.#choices[i]
      const ring = (this.#layer.children[i] as Container | undefined)
        ?.children.find(child => (child as { label?: string }).label === 'hover-ring')
      if (ring) ring.visible = hit === `${c.slot.q},${c.slot.r}`
      const badge = (this.#layer.children[i] as Container | undefined)
        ?.children.find(child => (child as { label?: string }).label === 'forget-badge')
      if (badge) badge.visible = hit === `${c.slot.q},${c.slot.r}`
    }
  }

  #choiceUnderCursor(clientX: number, clientY: number): Choice | null {
    const choice = this.#nearestChoice(clientX, clientY)
    // An unresolved picture is a labelled hex, not a choice.
    return choice && (choice.mine || choice.skip || this.#textures.get(choice.previewSig)) ? choice : null
  }

  /** The choice under a screen point: nearest centre within a hexagon's reach,
   *  measured in the wall layer's own space (the hive's hex detector knows only the
   *  untransformed mesh). */
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

  #store() {
    return window.ioc.get<{
      getResource?: (s: string) => Promise<Blob | null>
    }>('@hypercomb.social/Store')
  }

  async #bytes(sig: string): Promise<Blob | null> {
    if (!sig) return null
    // Full cascade (local → host → mesh) with write-through to OPFS — the same
    // path the renderer's detached fill uses for a peer's picture — THROUGH the
    // Life Primitive hop. `getResource` does not follow it on its own, so a
    // reference that names an incidence rather than raw bytes would come back as
    // the envelope's JSON and paint as a broken picture.
    const store = this.#store()
    if (!store?.getResource) return null
    try {
      return await fetchThroughContentHop(sig, s => store.getResource!(s))
    } catch { return null }
  }

  async #texture(sig: string): Promise<Texture | null> {
    if (!sig) return null
    if (this.#textures.has(sig)) return this.#textures.get(sig) ?? null
    this.#inflight.add(sig)
    let tex: Texture | null = null
    try {
      // A picture nobody serves must not hold its tile "loading" forever; a
      // timeout is not cached, so opening the wall again asks again.
      // The cached quick shot first (sign('thumbnails:hex'), keyed by this very
      // sig): one tiny local read, no network. A miss falls back to the full
      // bytes and asks the optimizer to cut the shot for next time.
      const store = this.#store() as ThumbnailStore | undefined
      const cached = store?.getPool ? await readThumbnail(store, sig) : null
      if (cached) {
        tex = Texture.from(await createImageBitmap(cached))
      } else {
        const blob = await Promise.race([
          this.#bytes(sig),
          new Promise<null>(resolve => setTimeout(() => resolve(null), TEXTURE_TIMEOUT_MS)),
        ])
        if (blob) {
          tex = Texture.from(await thumbnailOf(blob))
          this.emitEffect('thumbnail:wanted', { sig })
        }
      }
    } catch { tex = null }
    this.#inflight.delete(sig)
    if (!tex) return null
    this.#remember(sig, tex)
    return tex
  }

  #remember(sig: string, tex: Texture): void {
    if (this.#textures.size >= TEXTURE_CACHE_MAX) {
      const oldest = this.#textures.keys().next().value
      if (oldest !== undefined) this.#drop(oldest)
    }
    this.#textures.set(sig, tex)
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

  /** The hive turned flat-top or pointy-top. A frame cut from a sheet is cut
   *  for one orientation, so those go; an open wall is laid out again in place
   *  and cuts its frames from the other sheet of each pair. */
  #reorient(flat: boolean): void {
    if (flat === this.#flat) return
    this.#flat = flat
    for (const sig of [...this.#sheetCut]) this.#drop(sig)
    if (!this.#layer) return
    const token = this.#buildToken
    this.#paintNow(token)
    this.#loadTextures(token, this.#entries)
  }

  /** The orientation the hive draws in — the wall's hexagons and the sheet a
   *  frame is cut from both follow it. */
  #orientation(): FillOrientation { return this.#flat ? 'flat' : 'point' }

  /** Hex vertices about (cx, cy), pointy-top or flat-top as the hive is. */
  #hexVerts(cx: number, cy: number, radius: number): number[] {
    const verts: number[] = []
    const start = this.#flat ? 0 : -Math.PI / 2
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + start
      verts.push(cx + radius * Math.cos(angle))
      verts.push(cy + radius * Math.sin(angle))
    }
    return verts
  }
}

/** A quick shot: the wall only ever draws a picture a few dozen pixels across,
 *  so it keeps a small decode, never the full bitmap. The full bytes are pulled
 *  once, by `#apply`, for the picture actually chosen — everything else on the
 *  wall is released when the wall closes. Decoders that ignore the resize hint
 *  (older Safari/Firefox) fall back to a canvas draw, then to the plain decode. */
const thumbnailOf = async (blob: Blob): Promise<ImageBitmap | HTMLCanvasElement> => {
  try {
    const bitmap = await createImageBitmap(blob, { resizeWidth: THUMB_PX, resizeQuality: 'medium' })
    if (bitmap.width <= THUMB_PX * 2) return bitmap
    bitmap.close()
  } catch { /* resize options unsupported */ }
  const full = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, THUMB_PX / Math.max(full.width, full.height))
    if (scale === 1) return full
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(full.width * scale))
    canvas.height = Math.max(1, Math.round(full.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return full
    context.drawImage(full, 0, 0, canvas.width, canvas.height)
    full.close()
    return canvas
  } catch { return full }
}

const formatBytes =(n: number | null): string => {
  if (n === null) return '?'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const _imageChoice = new ImageChoiceDrone()
window.ioc.register('@diamondcoreprocessor.com/ImageChoiceDrone', _imageChoice)
