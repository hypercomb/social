// hypercomb-shared/ui/backgrounds-window/backgrounds-window.component.ts
//
// THE BACKGROUNDS WINDOW — what is behind the hive, and what fills a blank
// tile, in one place you can see.
//
// It exists because the job had been split across two words that did not point
// at each other. `/background` chose a theme; `/substrate` curated pictures;
// neither said the other was there, and the one thing people actually looked
// for — "put my own picture behind the hive" — was in neither, because until
// now the screen could only ever be a drawn pattern. So the answer to "how do
// I set a backdrop image?" was, correctly, that you could not.
//
// TWO SECTIONS, because there are exactly two things being dressed:
//
//   SCREEN — what is behind the hive. Your own picture first (that is the
//            question people arrive with), then the drawn looks.
//   TILES  — the pictures that fill blank tiles, as groups, with every picture
//            in the live group listed and an eye beside it.
//
// They are PEER SECTIONS over one subject, so they take `accordion()`: one
// open at a time. A screen full of thumbnails under an open Tiles section must
// not push Screen off the bottom of the panel you opened to compare them.
//
// HIDING IS THE THIRD VERB. A group of twenty scenes will always contain two
// you do not want on your wall, and the only way to act on that was a slash
// behaviour that has been retired. An eye per picture is the whole feature —
// and the hidden set is persisted now (substrate.service.ts), so hiding one is
// a decision rather than a thing you redo every reload.
//
// EVERYTHING COMES OVER IoC. Shell UI must never import essentials: a build
// without the presentation module simply has a window with nothing in it, and
// a community module that registers a theme of its own appears here for free.

import { Component, HostListener, computed, signal, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { accordion } from '../accordion'
import { signalSession } from '../window-session'

/** Structural mirrors of the essentials shapes — shared cannot import them. */
type ScreenHalf = { archetype: string; palette: string }
type ThemeLike = {
  id: string
  label: string
  screen?: ScreenHalf
  tiles?: string
  chrome?: string
  preview?: string
}
type ThemesLike = EventTarget & {
  themes: readonly ThemeLike[]
  active: string | null
  lightWorld?: boolean
  set(input: string): Promise<string | null>
  swatch(input: string): string
  /** The looks that dress a half, filtered to the world the chrome is in.
   *  A build from before this existed falls back to the flat list. */
  half?(which: 'screen' | 'tiles', all?: boolean): readonly ThemeLike[]
  mood?(id: string): 'light' | 'dark' | null
}
type CanvasLike = EventTarget & {
  picture: string | null
  dim: number
  zoom: number
  panX: number
  panY: number
  enabled: boolean
  setPicture(sig: string): Promise<boolean>
  adoptPicture(blob: Blob): Promise<string | null>
  clearPicture(): void
  setDim(value: number): void
  setZoom(value: number): void
  setPan(x: number, y: number): void
  setPreview(active: boolean): void
  pictureSwatch(): string
  status(): string
  // The saved shelves. Optional: an essentials build from before they existed
  // simply has a window without them.
  saved?: { light: readonly string[]; dark: readonly string[] }
  savePicture?(sig: string, world: 'light' | 'dark'): boolean
  unsavePicture?(sig: string): void
  worldOf?(sig: string): 'light' | 'dark' | null
}
type SubstrateLike = {
  ensureLoaded(): Promise<void>
  listImages(): { name: string; imageSig: string; enabled: boolean }[]
  setImageHidden(signature: string, hidden: boolean): void
  showAllImages(): void
  hiddenImages(): readonly string[]
}
type StoreLike = { getResource(sig: string): Promise<Blob | null> }

const THEMES_KEY = '@diamondcoreprocessor.com/BackgroundThemes'
const CANVAS_KEY = '@diamondcoreprocessor.com/CanvasBackground'
const SUBSTRATE_KEY = '@diamondcoreprocessor.com/SubstrateService'
const STORE_KEY = '@hypercomb.social/Store'

type Ioc = {
  get<T>(key: string): T | undefined
  whenReady?(key: string, cb: (value: unknown) => void): void
}
const ioc = (): Ioc | undefined => (globalThis as { ioc?: Ioc }).ioc

/** A look, as the window draws it. */
export type LookRow = {
  id: string
  label: string
  /** A CSS `background` value — the look itself, at card scale. */
  swatch: string
  /** What it dresses, in the theme's own words. */
  dresses: string
  active: boolean
}

/** One picture in the live tiles pool. */
export type PictureRow = {
  signature: string
  name: string
  hidden: boolean
  /** Object URL, once the bytes have resolved. Empty until then. */
  thumb: string
}

/** One saved backdrop on a shelf. A shelf shows pictures, not names — the
 *  participant's own backdrops never had names to begin with. */
export type SavedRow = {
  signature: string
  /** Object URL, once the bytes have resolved. Empty until then. */
  thumb: string
}

/** The largest picture worth putting behind a hive. Anything bigger is a
 *  photograph at print resolution being scaled down by the compositor on every
 *  paint; the backdrop is blurred and washed, so the detail was never seen. */
const MAX_BACKDROP_EDGE = 2560

@Component({
  selector: 'hc-backgrounds-window',
  standalone: true,
  imports: [TranslatePipe, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './backgrounds-window.component.html',
  styleUrls: ['./backgrounds-window.component.scss'],
})
export class BackgroundsWindowComponent implements OnDestroy {
  readonly visible = signal(false)
  /** SCREEN or TILES — one at a time. */
  readonly sections = accordion('screen')
  /** Bumped to re-read the services, which are EventTargets, not signals. */
  readonly revision = signal(0)
  /** The live tiles pool, resolved lazily when the Tiles section opens. */
  readonly pictures = signal<readonly PictureRow[]>([])
  readonly loadingPictures = signal(false)
  /** The saved backdrops, one shelf per world. */
  readonly savedLight = signal<readonly SavedRow[]>([])
  readonly savedDark = signal<readonly SavedRow[]>([])
  /** The shelf a drag is currently held over, for the drop highlight. */
  readonly dragWorld = signal<'light' | 'dark' | null>(null)
  /** The two shelves, in the order the window draws them. */
  readonly worlds = ['light', 'dark'] as const
  /** Set while a chosen file is being signed and stored. */
  readonly adopting = signal(false)
  /** Show the looks that belong to the OTHER world too.
   *
   *  Off by default, which is the whole point: a wall of deep-space plates
   *  under cream panels is not a choice anyone makes on purpose, so the list
   *  follows the chrome. But a filter you cannot turn off is a list that has
   *  quietly decided for you — and someone who wants Cosmos under Honey is
   *  allowed to want that. */
  readonly showAllLooks = signal(false)
  readonly panning = signal(false)
  readonly spacePan = signal(false)
  #panStart: { pointerX: number; pointerY: number; imageX: number; imageY: number } | null = null

  readonly session = signalSession(
    this.visible,
    open => { EffectBus.emit('backgrounds:state', { open }) },
    {
      // One level per press: an open section closes before the window does.
      dismiss: () => this.sections.dismiss(),
      close: () => this.close(),
    },
  )

  readonly #cleanups: Array<() => void> = []
  readonly #thumbs = new Map<string, string>()

  constructor() {
    this.#cleanups.push(EffectBus.on('backgrounds:open', () => this.open()))
    this.#cleanups.push(EffectBus.on('backgrounds:close', () => this.close()))
    this.#cleanups.push(EffectBus.on('backgrounds:toggle', () => { if (this.visible()) this.close(); else this.open() }))
    // A section the command line asked for — `/background tiles` opens the
    // window ALREADY on tiles, so the two doors land in the same place.
    this.#cleanups.push(EffectBus.on<{ section?: string }>('backgrounds:reveal', payload => {
      const key = payload?.section === 'tiles' ? 'tiles' : 'screen'
      this.open()
      this.sections.reveal(key)
      if (key === 'tiles') void this.#loadPictures()
    }))
    this.#cleanups.push(EffectBus.on('substrate:changed', () => {
      this.revision.update(n => n + 1)
      if (this.visible() && this.sections.isOpen('tiles')) void this.#loadPictures()
    }))
    this.#cleanups.push(EffectBus.on('locale:changed', () => this.revision.update(n => n + 1)))

    this.#follow(THEMES_KEY)
    // The canvas also carries the saved shelves, whose thumbnails resolve
    // asynchronously — refresh them alongside every repaint it asks for.
    this.#follow(CANVAS_KEY, () => {
      void this.#refreshSaved()
      this.#canvas()?.setPreview(this.visible())
    })
  }

  ngOnDestroy(): void {
    for (const cleanup of this.#cleanups) cleanup()
    this.#releaseThumbs()
  }

  /** Repaint whenever a service says its state moved — including one that
   *  registers after this component is built (the web shell loads the module
   *  at runtime). */
  #follow(key: string, also?: () => void): void {
    const attach = (target: EventTarget | undefined): void => {
      if (!target?.addEventListener) return
      const bump = (): void => { this.revision.update(n => n + 1); also?.() }
      target.addEventListener('change', bump)
      this.#cleanups.push(() => target.removeEventListener('change', bump))
      bump()
    }
    const ready = ioc()?.get<EventTarget>(key)
    if (ready) attach(ready)
    else ioc()?.whenReady?.(key, value => attach(value as EventTarget))
  }

  #themes(): ThemesLike | undefined { return ioc()?.get<ThemesLike>(THEMES_KEY) }
  #canvas(): CanvasLike | undefined { return ioc()?.get<CanvasLike>(CANVAS_KEY) }
  #substrate(): SubstrateLike | undefined { return ioc()?.get<SubstrateLike>(SUBSTRATE_KEY) }

  // ── what is showing ──────────────────────────────────────────────────

  readonly status = computed<string>(() => {
    this.revision()
    return this.#canvas()?.status() ?? ''
  })

  /** The picture behind the hive, at card scale. Empty when the screen is a
   *  drawn pattern. */
  readonly pictureSwatch = computed<string>(() => {
    this.revision()
    return this.#canvas()?.pictureSwatch() ?? ''
  })

  readonly hasPicture = computed<boolean>(() => {
    this.revision()
    return Boolean(this.#canvas()?.picture)
  })

  /** The picture's opacity, said the way round people ask for it: 100 is the
   *  picture exactly as chosen, anything less is washed toward the palette. */
  readonly opacity = computed<number>(() => {
    this.revision()
    return 100 - Math.round((this.#canvas()?.dim ?? 0) * 100)
  })

  readonly zoom = computed<number>(() => {
    this.revision()
    return Math.round((this.#canvas()?.zoom ?? 1) * 100)
  })

  /** The active picture's signature — what a drag onto a shelf carries. */
  readonly activePicture = computed<string | null>(() => {
    this.revision()
    return this.#canvas()?.picture ?? null
  })

  /** True while the active picture is on NO shelf — which is every picture's
   *  honest default, and what the drag-to-sort hint exists to say. */
  readonly unsorted = computed<boolean>(() => {
    this.revision()
    const canvas = this.#canvas()
    const sig = canvas?.picture
    if (!sig || !canvas?.worldOf) return false
    return canvas.worldOf(sig) === null
  })

  /** Whether this essentials build has shelves to offer at all. */
  readonly hasShelves = computed<boolean>(() => {
    this.revision()
    return Boolean(this.#canvas()?.savePicture)
  })

  /** The looks that dress the SCREEN. */
  readonly screenLooks = computed<LookRow[]>(() => this.#looks('screen'))

  /** The groups that dress TILES. */
  readonly tileGroups = computed<LookRow[]>(() => this.#looks('tiles'))

  /** Is the chrome a bright look? What the filter turns on, and what the
   *  toggle's own label has to say out loud. */
  readonly lightWorld = computed<boolean>(() => {
    this.revision()
    return this.#themes()?.lightWorld === true
  })

  /** How many looks the world filter is currently holding back. Zero means
   *  the toggle has nothing to offer, so it does not draw. */
  readonly withheld = computed<number>(() => {
    this.revision()
    const service = this.#themes()
    if (!service?.half) return 0
    const all = service.half('screen', true).length + service.half('tiles', true).length
    const suited = service.half('screen').length + service.half('tiles').length
    return Math.max(0, all - suited)
  })

  #looks(which: 'screen' | 'tiles'): LookRow[] {
    this.revision()
    const service = this.#themes()
    if (!service) return []
    const active = service.active
    // THE FILTER IS THE SERVICE'S, not the window's. The command dropdown asks
    // the same question of the same object, so the two surfaces cannot drift
    // into offering different lists — which is what "the window shows me a
    // theme the command line says does not exist" always turns out to be.
    const looks = service.half
      ? service.half(which, this.showAllLooks())
      : service.themes.filter(theme => (which === 'screen' ? theme.screen : theme.tiles))
    return looks.map(theme => ({
      id: theme.id,
      label: theme.label,
      swatch: service.swatch(theme.id) || '',
      // Said in the theme's own terms rather than the section's, because a
      // look that dresses both halves is going to move the other section too
      // and the card is the only place that can warn you.
      dresses: [theme.screen ? 'screen' : null, theme.tiles ? 'tiles' : null, theme.chrome ? 'chrome' : null]
        .filter(Boolean).join(' + '),
      active: theme.id === active,
    }))
  }

  readonly hiddenCount = computed<number>(() => this.pictures().filter(row => row.hidden).length)

  isOpen(key: string): boolean { return this.sections.isOpen(key) }

  // ── verbs ────────────────────────────────────────────────────────────

  open(): void {
    this.visible.set(true)
    this.#canvas()?.setPreview(true)
    EffectBus.emit('backgrounds:state', { open: true })
  }

  close(): void {
    this.cancelSpacePan()
    this.#canvas()?.setPreview(false)
    this.visible.set(false)
    EffectBus.emit('backgrounds:state', { open: false })
  }

  section(key: string): void {
    this.sections.toggle(key)
    if (this.sections.isOpen('tiles')) void this.#loadPictures()
  }

  /** Wear a look. The theme decides which halves move — the card says which,
   *  so a look that also carries tiles cannot surprise you. */
  async wear(id: string): Promise<void> {
    await this.#themes()?.set(id)
    this.revision.update(n => n + 1)
    if (this.sections.isOpen('tiles')) void this.#loadPictures()
  }

  /** Bring in a picture of your own. It becomes a signed resource first, so
   *  the same bytes behind the hive, on a tile and in the references pool are
   *  one file with three references. */
  async adopt(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null
    const file = input?.files?.[0]
    // The picker is reset either way: choosing the SAME file twice in a row
    // fires no change event otherwise, which reads as a dead button.
    if (input) input.value = ''
    if (!file) return
    this.adopting.set(true)
    try {
      const blob = await downscale(file, MAX_BACKDROP_EDGE)
      const sig = await this.#canvas()?.adoptPicture(blob)
      EffectBus.emit('activity:log', {
        message: sig ? 'picture set behind the hive' : 'that picture could not be stored',
      })
    } finally {
      this.adopting.set(false)
      this.revision.update(n => n + 1)
    }
  }

  /** Put one of the tile pictures behind the hive. The bytes are already a
   *  resource, so this is a reference and nothing is copied. */
  async useBehindHive(signature: string): Promise<void> {
    await this.#canvas()?.setPicture(signature)
    this.revision.update(n => n + 1)
  }

  removePicture(): void {
    this.#canvas()?.clearPicture()
    this.revision.update(n => n + 1)
  }

  setOpacity(value: string | number): void {
    const percent = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(percent)) return
    this.#canvas()?.setDim((100 - percent) / 100)
    this.revision.update(n => n + 1)
  }

  zoomPicture(event: WheelEvent): void {
    if (!this.hasPicture()) return
    event.preventDefault()
    event.stopPropagation()
    const canvas = this.#canvas()
    if (!canvas) return
    canvas.setZoom(canvas.zoom + (event.deltaY < 0 ? 0.1 : -0.1))
    this.revision.update(n => n + 1)
  }

  startPan(event: PointerEvent): void {
    if (event.button !== 0 || !this.hasPicture() || !this.spacePan()) return
    const canvas = this.#canvas()
    if (!canvas) return
    this.#panStart = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      imageX: canvas.panX,
      imageY: canvas.panY,
    }
    this.panning.set(true)
    ;(event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  movePan(event: PointerEvent): void {
    const start = this.#panStart
    if (!start) return
    this.#canvas()?.setPan(
      start.imageX + event.clientX - start.pointerX,
      start.imageY + event.clientY - start.pointerY,
    )
    event.preventDefault()
  }

  endPan(event: PointerEvent): void {
    if (!this.#panStart) return
    this.#panStart = null
    this.panning.set(false)
    const target = event.currentTarget as HTMLElement | null
    if (target?.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  }

  resetPan(): void {
    this.#canvas()?.setPan(0, 0)
  }

  @HostListener('window:keydown', ['$event'])
  beginSpacePan(event: KeyboardEvent): void {
    if (!this.visible() || !this.hasPicture() || event.code !== 'Space' || this.#isTyping(event.target)) return
    event.preventDefault()
    this.spacePan.set(true)
  }

  @HostListener('window:keyup', ['$event'])
  endSpacePan(event: KeyboardEvent): void {
    if (event.code !== 'Space') return
    this.spacePan.set(false)
    if (this.#panStart) {
      this.#panStart = null
      this.panning.set(false)
    }
  }

  @HostListener('window:blur')
  cancelSpacePan(): void {
    this.spacePan.set(false)
    this.#panStart = null
    this.panning.set(false)
  }

  #isTyping(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    return Boolean(el?.closest('input, textarea, select, [contenteditable="true"]'))
  }

  // ── the saved shelves ────────────────────────────────────────────────

  /** Pick a picture up — the active one off its chip, or a saved one off its
   *  shelf. The drag carries nothing but the signature. */
  dragPicture(event: DragEvent, signature: string | null): void {
    if (!signature) return
    event.dataTransfer?.setData('text/plain', signature)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
  }

  dragOver(event: DragEvent, world: 'light' | 'dark'): void {
    event.preventDefault()
    this.dragWorld.set(world)
  }

  dragLeave(world: 'light' | 'dark'): void {
    if (this.dragWorld() === world) this.dragWorld.set(null)
  }

  /** Drop a picture on a shelf — the sorting itself. A picture already on the
   *  other shelf moves; nothing is ever copied. */
  dropOnShelf(event: DragEvent, world: 'light' | 'dark'): void {
    event.preventDefault()
    this.dragWorld.set(null)
    const sig = event.dataTransfer?.getData('text/plain')?.trim().toLowerCase() ?? ''
    if (!/^[0-9a-f]{64}$/.test(sig)) return
    this.#canvas()?.savePicture?.(sig, world)
  }

  /** Take a saved picture off its shelf. The bytes are left alone. */
  unsave(signature: string): void {
    this.#canvas()?.unsavePicture?.(signature)
  }

  shelfRows(world: 'light' | 'dark'): readonly SavedRow[] {
    return world === 'light' ? this.savedLight() : this.savedDark()
  }

  /** The shelves, with thumbnails resolved lazily off the same cache the tiles
   *  pool uses — one signature behind the hive and on a shelf is one URL. */
  async #refreshSaved(): Promise<void> {
    const saved = this.#canvas()?.saved
    if (!saved) { this.savedLight.set([]); this.savedDark.set([]); return }
    const rows = (sigs: readonly string[]): SavedRow[] =>
      sigs.map(sig => ({ signature: sig, thumb: this.#thumbs.get(sig) ?? '' }))
    this.savedLight.set(rows(saved.light))
    this.savedDark.set(rows(saved.dark))
    const store = ioc()?.get<StoreLike>(STORE_KEY)
    if (!store?.getResource) return
    for (const sig of [...saved.light, ...saved.dark]) {
      if (this.#thumbs.has(sig)) continue
      const blob = await store.getResource(sig).catch(() => null)
      if (!blob) continue
      const url = URL.createObjectURL(blob)
      this.#thumbs.set(sig, url)
      const patch = (current: readonly SavedRow[]): SavedRow[] =>
        current.map(row => (row.signature === sig ? { ...row, thumb: url } : row))
      this.savedLight.update(patch)
      this.savedDark.update(patch)
    }
  }

  /** Take a picture out of the rotation, or put it back. */
  setHidden(signature: string, hidden: boolean): void {
    this.#substrate()?.setImageHidden(signature, hidden)
    this.pictures.update(rows => rows.map(row => (row.signature === signature ? { ...row, hidden } : row)))
  }

  showAll(): void {
    this.#substrate()?.showAllImages()
    this.pictures.update(rows => rows.map(row => ({ ...row, hidden: false })))
  }

  // ── the live tiles pool ──────────────────────────────────────────────

  /** The pictures the active group would actually hand out, with thumbnails.
   *  Resolved when the section opens rather than at boot: a group of twenty
   *  photographs is twenty reads nobody asked for until they look. */
  async #loadPictures(): Promise<void> {
    const substrate = this.#substrate()
    if (!substrate) { this.pictures.set([]); return }
    this.loadingPictures.set(true)
    try {
      await substrate.ensureLoaded()
      const rows = substrate.listImages()
      this.pictures.set(rows.map(row => ({
        signature: row.imageSig,
        name: row.name,
        hidden: !row.enabled,
        thumb: this.#thumbs.get(row.imageSig) ?? '',
      })))
      const store = ioc()?.get<StoreLike>(STORE_KEY)
      if (!store?.getResource) return
      for (const row of rows) {
        if (this.#thumbs.has(row.imageSig)) continue
        const blob = await store.getResource(row.imageSig).catch(() => null)
        if (!blob) continue
        const url = URL.createObjectURL(blob)
        this.#thumbs.set(row.imageSig, url)
        this.pictures.update(current =>
          current.map(item => (item.signature === row.imageSig ? { ...item, thumb: url } : item)))
      }
    } finally {
      this.loadingPictures.set(false)
    }
  }

  #releaseThumbs(): void {
    for (const url of this.#thumbs.values()) {
      try { URL.revokeObjectURL(url) } catch { /* already gone */ }
    }
    this.#thumbs.clear()
  }
}

/**
 * Shrink a chosen file to something a backdrop can use. A phone photograph is
 * commonly 4000px on its long edge and several megabytes; behind a blurred,
 * washed backdrop none of that survives, and storing it would put the whole
 * thing into the content root forever. Anything already small enough is passed
 * through untouched — re-encoding a picture that did not need it is a loss for
 * no reason.
 */
async function downscale(file: Blob, maxEdge: number): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const longest = Math.max(bitmap.width, bitmap.height)
    if (longest <= maxEdge) { bitmap.close?.(); return file }
    const scale = maxEdge / longest
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const offscreen = typeof OffscreenCanvas !== 'undefined'
    const canvas: HTMLCanvasElement | OffscreenCanvas = offscreen
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })
    const context = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!context) { bitmap.close?.(); return file }
    context.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, width, height)
    bitmap.close?.()
    if (canvas instanceof OffscreenCanvas) return await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
    const element = canvas
    return await new Promise<Blob>(resolve => {
      element.toBlob(blob => resolve(blob ?? file), 'image/webp', 0.9)
    })
  } catch {
    // A format the browser cannot decode is still a file the participant
    // chose; store it as it came rather than refusing it.
    return file
  }
}

registerShellSurface({
  name: 'hc-backgrounds-window',
  owner: '@hypercomb.shared/BackgroundsWindowComponent',
  component: BackgroundsWindowComponent,
  order: 156,
})
