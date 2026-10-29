// presentation/tiles/launcher-view.drone.ts
//
// LAUNCHER SCREENS. The place you are standing, drawn as screens you turn
// by swiping left or right (or the arrows, or the arrow keys).
//
// On a launch-group page the screens are the groups: /games, then the next
// group, the way a phone turns its home screens. Anywhere else the screens
// are pages of this layer's own tiles.
//
// TWO TILES, ONE VIEW. `icons` is a phone home screen — a squircle and the
// name under it. `square` is the larger square plate. The switch is on the
// screen, and `/launcher icons` / `/launcher square` set the same choice.
//
// PICTURES SHOW UP AT ONCE. Every plate paints its letter in the same turn
// the screen is built. The pictures then come from one small sprite — a
// single decode for the whole screen — or, until that sprite exists, from
// the 64–96px thumbnail. The full image is never what the first paint waits
// on. A miss asks the optimize phase for the sprite, so the next open is
// the one file.

import { Drone, EffectBus } from '@hypercomb/core'
import { titleForLabel } from '../../commands/decoration-kind-index.js'
import { listDecorations } from '../../commands/decoration-manifest.js'
import { isFeatureHiddenWithin } from '../../sharing/feature-hidden.js'
import { isBehaviorDormant } from '../../sharing/behavior-enablement.js'
import { readTilePropertiesAt, tilePictureCandidates } from '../../editor/tile-properties.js'
import { childNamesOf, type PlacementHistory, type PlacementLayer } from '../../history/layer-placement.js'
import type { BackGesture } from '../../navigation/back-gesture.service.js'
import { onPageCellsChanged, pageCellsAt, whenPageCells, type PageCell, type PageCells } from './page-cells.js'
import { readThumbnail, type ThumbnailStore } from './thumbnails.js'
import { resolveLocalResourceReference } from './local-resource-reference.js'
import {
  bootSpriteMaterial, bootSpriteSignature, readBootSprite, spriteSliceStyle,
} from './boot-sprite.js'
import {
  gridFor, launcherGroupScreens, pageAfter, pagesOf, perScreen, plateHue, plateLetter, swipeStep,
  type LaunchGroupScreen,
} from './launcher-pages.js'
import {
  LAUNCHER_KIND, LAUNCHER_VIEW, launcherStylePreference,
  setLauncherStylePreference, type LauncherPayload, type LauncherStyle,
} from '../../commands/launcher-kind.js'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
type NavigationShape = { goRaw(segments: readonly string[]): void }
type HistoryShape = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
}
type GroupShape = LaunchGroupScreen & { label?: string }
type ModeRegistryShape = {
  enter(mode: string, owner: string): void
  exit(mode: string, owner: string): void
  ownersOf(mode: string): readonly string[]
}

const SIG = /^[0-9a-f]{64}$/
const OWNER = 'launcher'
/** The tile's own path, which a flattening filter can place anywhere. */
const tilePath = new WeakMap<HTMLElement, readonly string[]>()

const revokeAll = (urls: readonly string[]): void => {
  for (const url of urls) {
    try { URL.revokeObjectURL(url) } catch { /* already gone */ }
  }
}

interface Plate {
  readonly label: string
  readonly segments: readonly string[]
  readonly title: string
  readonly plate: HTMLElement
}

export class LauncherViewDrone extends Drone {
  /** THE VIEW THIS BEE RENDERS, and nowhere else does it act. It sleeps
   *  until the view mode enters it (scripts/passive-queen.ts). */
  readonly renders: readonly string[] = ['launcher']

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description = 'Launcher screens — swipe sideways, square tiles or phone icons, pictures from one small sprite.'

  #host: HTMLElement | null = null
  #track: HTMLElement | null = null
  #bound = false
  #active = false
  #gen = 0
  #page = 0
  #pageCount = 1
  /** Launch-group ids when the screens ARE the groups. Null when the
   *  screens are pages of this layer's tiles. */
  #groupIds: readonly string[] | null = null
  #segments: string[] = []
  #targetSegments: string[] | null = null
  #objectUrls: string[] = []
  #suppressClick = false
  /** Skips a rebuild when a resize did not change the grid. */
  #layoutKey = ''
  #backOff: (() => void) | null = null
  #pageCellsOff: (() => void) | null = null
  #style: LauncherStyle = 'icons'

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#change)
      window.ioc?.get<EventTarget>('@hypercomb.social/Lineage')
        ?.addEventListener?.('change', this.#lineageChange)
      this.onEffect('decorations:changed', this.#change)
      this.onEffect('feature:hidden', this.#change)
      this.onEffect('feature:restored', this.#change)
      this.#pageCellsOff = onPageCellsChanged(this.#change)
      this.onEffect('global:escape', this.#escape)
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', payload => {
        if (payload?.view !== LAUNCHER_VIEW) return
        this.#targetSegments = (payload.segments ?? []).map(String).filter(Boolean)
        this.#vm()?.setMode(LAUNCHER_VIEW)
        void this.#reconcile()
      })
      this.#backOff = window.ioc?.get<BackGesture>('@diamondcoreprocessor.com/BackGesture')
        ?.register({ owner: OWNER, back: () => { this.#vm()?.setMode('hexagons') } }) ?? null
      window.addEventListener('keydown', this.#onKey)
      window.addEventListener('resize', this.#onResize)
      this.#bound = true
    }
    await this.#reconcile()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#change)
    window.ioc?.get<EventTarget>('@hypercomb.social/Lineage')
      ?.removeEventListener?.('change', this.#lineageChange)
    window.removeEventListener('keydown', this.#onKey)
    window.removeEventListener('resize', this.#onResize)
    this.#backOff?.()
    this.#backOff = null
    this.#pageCellsOff?.()
    this.#pageCellsOff = null
    this.#teardown()
  }

  readonly #change = (): void => { void this.#reconcile() }
  readonly #lineageChange = (): void => {
    this.#targetSegments = null
    this.#page = 0
    void this.#reconcile()
  }
  readonly #onResize = (): void => { void this.#reconcile() }
  readonly #escape = (): void => {
    if (this.#vm()?.mode !== LAUNCHER_VIEW) return
    const top = window.ioc?.get<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')?.ownersOf('view:active').at(-1)
    if (top && top !== OWNER) return
    this.#vm()?.setMode('hexagons')
  }
  readonly #onKey = (event: KeyboardEvent): void => {
    if (this.#vm()?.mode !== LAUNCHER_VIEW) return
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    this.#turn(event.key === 'ArrowLeft' ? -1 : 1)
  }

  #vm(): ViewModeShape | undefined {
    return window.ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  async #reconcile(): Promise<void> {
    const gen = ++this.#gen
    if (this.#vm()?.mode === LAUNCHER_VIEW) { await this.#mount(gen); return }
    this.#targetSegments = null
    this.#teardown()
  }

  async #mount(gen: number): Promise<void> {
    const lineage = window.ioc?.get<LineageShape>('@hypercomb.social/Lineage')
    const segments = this.#targetSegments ?? [...(lineage?.explorerSegments?.() ?? [])]
    if (isBehaviorDormant(LAUNCHER_KIND, segments) || await isFeatureHiddenWithin(segments, LAUNCHER_KIND)) {
      this.#targetSegments = null
      this.#teardown()
      this.#vm()?.setMode('hexagons')
      return
    }
    const records = await listDecorations<LauncherPayload>({ kind: LAUNCHER_KIND, segments })
    if (gen !== this.#gen || this.#vm()?.mode !== LAUNCHER_VIEW) return
    const marked = records.at(-1)?.record.payload?.style
    const style = launcherStylePreference()
      ?? (marked === 'square' || marked === 'icons' ? marked : 'icons')
    const page = pageCellsAt(segments) ?? await whenPageCells(segments) ?? await this.#layerCells(segments)
    if (gen !== this.#gen || this.#vm()?.mode !== LAUNCHER_VIEW) return

    const groups = window.ioc?.get<{ all?: () => GroupShape[] }>('@hypercomb.social/GroupLauncher')?.all?.() ?? []
    const groupScreens = launcherGroupScreens(groups, segments)
    const width = window.innerWidth || 390
    const height = window.innerHeight || 800
    const per = perScreen(style, width, height)
    const tilePages = groupScreens ? [page.cells] : pagesOf(page.cells, per)
    const pageCount = Math.max(1, groupScreens ? groupScreens.ids.length : tilePages.length)
    this.#page = pageAfter(groupScreens ? groupScreens.index : this.#page, pageCount, 0)
    this.#style = style
    this.#segments = segments
    this.#groupIds = groupScreens?.ids ?? null
    this.#pageCount = pageCount
    const layoutKey = [
      style, segments.join('/'), String(page.narrowed),
      page.cells.map(cell => cell.segments.join('/')).join('|'),
      String(per), String(pageCount),
    ].join('\n')
    if (layoutKey === this.#layoutKey && this.#host?.isConnected) {
      this.#snap()
      return
    }
    this.#layoutKey = layoutKey

    // Stay in view:active across the swap, or the hex canvas flashes between screens.
    this.#teardown(true)
    if (gen !== this.#gen) return
    const host = this.#build(segments, style, page, tilePages, groups)
    this.#host = host
    document.body.appendChild(host)
    this.#setActive(true)
    this.#snap()
    void this.#paintPictures(gen, host)
  }

  async #layerCells(segments: readonly string[]): Promise<PageCells> {
    const history = window.ioc?.get<HistoryShape>('@diamondcoreprocessor.com/HistoryService')
    const unread: PageCells = { cells: [], narrowed: false }
    if (!history) return unread
    try {
      const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => [...segments] }))
      if (!layer) return unread
      const labels = await childNamesOf(history as unknown as PlacementHistory, layer as unknown as PlacementLayer)
      return { cells: labels.map(label => ({ label, segments: [...segments, label] })), narrowed: false }
    } catch {
      return unread
    }
  }

  #build(
    segments: readonly string[],
    style: LauncherStyle,
    page: PageCells,
    tilePages: readonly (readonly PageCell[])[],
    groups: readonly GroupShape[],
  ): HTMLElement {
    const host = document.createElement('section')
    host.className = 'hc-launcher'
    host.dataset['style'] = style
    host.setAttribute('data-hc-launcher', '')
    host.setAttribute('data-consumes-wheel', '')
    host.innerHTML = `<style>${LAUNCHER_CSS}</style>`

    const bar = document.createElement('header')
    bar.className = 'ln-bar'
    const title = document.createElement('h1')
    title.className = 'ln-title'
    title.textContent = this.#title(segments, groups)
    bar.appendChild(title)

    const switcher = document.createElement('div')
    switcher.className = 'ln-switch'
    switcher.append(this.#styleButton('icons', style), this.#styleButton('square', style))
    bar.appendChild(switcher)

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'ln-close'
    close.textContent = '×'
    close.setAttribute('aria-label', this.#t('launcher.close', 'Back to hexagons'))
    close.addEventListener('click', () => this.#vm()?.setMode('hexagons'))
    bar.appendChild(close)
    host.appendChild(bar)

    const viewport = document.createElement('div')
    viewport.className = 'ln-viewport'
    const track = document.createElement('div')
    track.className = 'ln-track'
    const screens = this.#groupIds ? [tilePages[0] ?? []] : tilePages
    const grid = gridFor(style, window.innerWidth || 390, window.innerHeight || 800)
    if (screens.length === 0 || (screens.length === 1 && screens[0]!.length === 0)) {
      track.appendChild(this.#emptyScreen(page.narrowed))
    } else {
      for (const cells of screens) {
        const screen = document.createElement('div')
        screen.className = 'ln-screen'
        const wrap = document.createElement('div')
        wrap.className = 'ln-grid'
        wrap.style.setProperty('--cols', String(grid.cols))
        for (const cell of cells) wrap.appendChild(this.#tileButton(cell))
        screen.appendChild(wrap)
        track.appendChild(screen)
      }
    }
    viewport.appendChild(track)
    host.appendChild(viewport)
    this.#track = track
    this.#bindSwipe(viewport)

    const pager = document.createElement('nav')
    pager.className = 'ln-pager'
    pager.setAttribute('aria-label', this.#t('launcher.screens', 'Screens'))
    pager.appendChild(this.#arrow('previous', -1))
    const dots = document.createElement('div')
    dots.className = 'ln-dots'
    for (let index = 0; index < this.#pageCount; index++) {
      const dot = document.createElement('button')
      dot.type = 'button'
      dot.className = 'ln-dot'
      dot.dataset['page'] = String(index)
      const mark = document.createElement('span')
      dot.appendChild(mark)
      dot.addEventListener('click', () => this.#goTo(index))
      dots.appendChild(dot)
    }
    pager.appendChild(dots)
    pager.appendChild(this.#arrow('next', 1))
    host.appendChild(pager)
    if (this.#pageCount < 2) pager.hidden = true
    return host
  }

  #title(segments: readonly string[], groups: readonly GroupShape[]): string {
    if (this.#groupIds && segments.length === 1) {
      return groups.find(group => group.id === segments[0])?.label || segments[0] || this.#t('launcher.home', 'Home')
    }
    const label = segments.at(-1) ?? ''
    if (!label) return this.#t('launcher.home', 'Home')
    return titleForLabel(label, navigator.language) || label
  }

  #styleButton(style: LauncherStyle, current: LauncherStyle): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ln-style'
    button.dataset['style'] = style
    button.setAttribute('aria-pressed', String(style === current))
    const key = style === 'icons' ? 'launcher.style.icons' : 'launcher.style.square'
    const fallback = style === 'icons' ? 'Icons' : 'Square tiles'
    button.textContent = this.#t(key, fallback)
    button.addEventListener('click', () => {
      if (this.#style === style) return
      setLauncherStylePreference(style)
      this.#page = 0
      void this.#reconcile()
    })
    return button
  }

  #arrow(which: 'previous' | 'next', step: -1 | 1): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ln-arrow'
    button.dataset['dir'] = which
    button.textContent = step < 0 ? '‹' : '›'
    const key = which === 'previous' ? 'launcher.previous' : 'launcher.next'
    const fallback = which === 'previous' ? 'Previous screen' : 'Next screen'
    button.setAttribute('aria-label', this.#t(key, fallback))
    button.addEventListener('click', () => this.#turn(step))
    return button
  }

  #tileButton(cell: PageCell): HTMLButtonElement {
    const title = titleForLabel(cell.label, navigator.language) || cell.label
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ln-tile'
    button.dataset['label'] = cell.label
    tilePath.set(button, cell.segments)
    const plate = document.createElement('span')
    plate.className = 'ln-plate'
    plate.style.setProperty('--hue', String(plateHue(cell.label)))
    const letter = document.createElement('span')
    letter.className = 'ln-letter'
    letter.textContent = plateLetter(title)
    plate.appendChild(letter)
    button.appendChild(plate)
    const name = document.createElement('span')
    name.className = 'ln-name'
    name.textContent = title
    button.appendChild(name)
    button.addEventListener('click', () => {
      if (this.#suppressClick) return
      if (this.#groupIds) {
        EffectBus.emit('group:open', { label: cell.label })
        return
      }
      window.ioc?.get<NavigationShape>('@hypercomb.social/Navigation')?.goRaw(cell.segments)
    })
    return button
  }

  #emptyScreen(narrowed: boolean): HTMLElement {
    const screen = document.createElement('div')
    screen.className = 'ln-screen'
    const empty = document.createElement('p')
    empty.className = 'ln-empty'
    empty.textContent = narrowed
      ? this.#t('launcher.filtered', 'Nothing matches.')
      : this.#t('launcher.empty', 'Nothing on this screen.')
    screen.appendChild(empty)
    return screen
  }

  #bindSwipe(viewport: HTMLElement): void {
    let tracking = false
    let pointerId = -1
    let startX = 0
    let startY = 0
    let dx = 0
    const width = (): number => viewport.clientWidth || 1

    viewport.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      tracking = true
      pointerId = event.pointerId
      startX = event.clientX
      startY = event.clientY
      dx = 0
      if (this.#track) this.#track.style.transition = 'none'
      // A toast or another layer can cover the spot where the finger lifts.
      // Capture keeps the turn, instead of leaving the screen half-moved.
      try { viewport.setPointerCapture(event.pointerId) } catch { /* pointerup still arrives while the finger stays inside */ }
    })
    viewport.addEventListener('pointermove', event => {
      if (!tracking || event.pointerId !== pointerId || !this.#track) return
      dx = event.clientX - startX
      const dy = event.clientY - startY
      if (Math.abs(dy) > Math.abs(dx)) return
      const base = -this.#page * width()
      this.#track.style.transform = `translate3d(${base + dx}px,0,0)`
    })
    const end = (event: PointerEvent): void => {
      if (!tracking || event.pointerId !== pointerId) return
      tracking = false
      const step = swipeStep(dx, event.clientY - startY)
      if (this.#track) this.#track.style.transition = ''
      if (step === 0) { this.#snap(); return }
      this.#suppressClick = true
      setTimeout(() => { this.#suppressClick = false }, 0)
      this.#turn(step)
    }
    viewport.addEventListener('pointerup', end)
    viewport.addEventListener('pointercancel', end)
  }

  #turn(step: -1 | 1): void {
    if (this.#groupIds) {
      const index = this.#groupIds.indexOf(this.#segments[0] ?? '')
      const next = pageAfter(index < 0 ? 0 : index, this.#groupIds.length, step)
      if (next === index) { this.#snap(); return }
      const id = this.#groupIds[next]
      if (id) window.ioc?.get<NavigationShape>('@hypercomb.social/Navigation')?.goRaw([id])
      return
    }
    const next = pageAfter(this.#page, this.#pageCount, step)
    if (next === this.#page) { this.#snap(); return }
    this.#page = next
    this.#snap()
  }

  #goTo(index: number): void {
    if (this.#groupIds) {
      const id = this.#groupIds[index]
      if (id && id !== this.#segments[0]) {
        window.ioc?.get<NavigationShape>('@hypercomb.social/Navigation')?.goRaw([id])
      }
      return
    }
    this.#page = pageAfter(index, this.#pageCount, 0)
    this.#snap()
  }

  #snap(): void {
    const track = this.#track
    if (!track) return
    const page = this.#groupIds ? 0 : this.#page
    track.style.transform = `translate3d(${-page * 100}%,0,0)`
    const host = this.#host
    if (!host) return
    const shown = this.#groupIds
      ? Math.max(0, this.#groupIds.indexOf(this.#segments[0] ?? ''))
      : this.#page
    host.querySelectorAll<HTMLButtonElement>('.ln-dot').forEach(dot => {
      const on = Number(dot.dataset['page']) === shown
      dot.setAttribute('aria-current', on ? 'true' : 'false')
      const label = this.#t('launcher.screen', 'Screen {n} of {total}', { n: shown + 1, total: this.#pageCount })
      if (on) dot.setAttribute('aria-label', label)
    })
    const status = host.querySelector('.ln-status')
    if (!status) {
      const live = document.createElement('p')
      live.className = 'ln-status'
      live.setAttribute('aria-live', 'polite')
      host.appendChild(live)
    }
    const live = host.querySelector('.ln-status')
    if (live) {
      live.textContent = this.#pageCount > 1
        ? this.#t('launcher.screen', 'Screen {n} of {total}', { n: shown + 1, total: this.#pageCount })
        : ''
    }
  }

  /** Letters are already on screen. This only fills pictures, and it never
   *  blocks the screen on a full-size decode. */
  async #paintPictures(gen: number, host: HTMLElement): Promise<void> {
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.ln-tile')]
    const plates: Plate[] = []
    for (const button of buttons) {
      const label = button.dataset['label'] ?? ''
      const plate = button.querySelector<HTMLElement>('.ln-plate')
      if (!label || !plate) continue
      const segments = tilePath.get(button) ?? [...this.#segments, label]
      plates.push({ label, segments, title: '', plate })
    }
    const sigs = await Promise.all(plates.map(plate => this.#imageSig(plate.segments)))
    if (gen !== this.#gen) return
    const known = plates.flatMap((item, index) => {
      const sig = sigs[index]
      return sig ? [{ item, sig }] : []
    })
    const ordered = bootSpriteMaterial(known.map(entry => entry.sig)).split('\n').filter(Boolean)
    const key = await bootSpriteSignature(ordered)
    if (gen !== this.#gen) return
    const store = window.ioc?.get<ThumbnailStore & { getResourceLocal?: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
    if (!store) return
    const sheet = key ? await readBootSprite(store, key) : null
    if (gen !== this.#gen) return
    if (sheet && ordered.length) {
      const url = URL.createObjectURL(sheet)
      this.#objectUrls.push(url)
      const indexOf = new Map(ordered.map((sig, index) => [sig, index]))
      for (const entry of known) {
        const index = indexOf.get(entry.sig)
        if (index === undefined) continue
        const slice = spriteSliceStyle(index, ordered.length)
        const plate = entry.item.plate
        plate.style.backgroundImage = `url("${url}")`
        plate.style.backgroundRepeat = 'no-repeat'
        plate.style.backgroundSize = slice.size
        plate.style.backgroundPosition = slice.position
        plate.dataset['ready'] = 'sprite'
      }
      return
    }
    if (key && ordered.length) EffectBus.emit('sprite:boot:wanted', { key, sigs: ordered })
    const fresh: string[] = []
    await Promise.all(known.map(async entry => {
      const thumb = await readThumbnail(store, entry.sig)
      let blob = thumb
      if (!blob) {
        try { EffectBus.emit('thumbnail:wanted', { sig: entry.sig }) } catch { /* non-fatal */ }
        blob = store.getResourceLocal
          ? await resolveLocalResourceReference(store as ThumbnailStore & { getResourceLocal(sig: string): Promise<Blob | null> }, entry.sig)
          : null
      }
      if (!blob || blob.size === 0 || gen !== this.#gen) return
      const url = URL.createObjectURL(blob)
      fresh.push(url)
      const image = document.createElement('img')
      image.alt = ''
      image.draggable = false
      image.src = url
      const plate = entry.item.plate
      plate.appendChild(image)
      plate.dataset['ready'] = 'image'
    }))
    if (gen !== this.#gen) { revokeAll(fresh); return }
    this.#objectUrls.push(...fresh)
  }

  async #imageSig(segments: readonly string[]): Promise<string | null> {
    if (segments.length === 0) return null
    try {
      const props = await readTilePropertiesAt(segments.slice(0, -1), segments[segments.length - 1] ?? '')
      return tilePictureCandidates(props).find(sig => SIG.test(sig)) ?? null
    } catch {
      return null
    }
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const i18n = window.ioc?.get<{ t(k: string, p?: Record<string, string | number>): string }>('@hypercomb.social/I18n')
    const text = i18n?.t?.(key, params)
    const raw = text && text !== key ? text : fallback
    if (!params) return raw
    return raw.replace(/\{(\w+)\}/g, (_, token: string) => String(params[token] ?? `{${token}}`))
  }

  #teardown(keepActive = false): void {
    const urls = this.#objectUrls
    this.#objectUrls = []
    this.#host?.remove()
    this.#host = null
    this.#track = null
    revokeAll(urls)
    if (!keepActive) {
      this.#layoutKey = ''
      this.#setActive(false)
    }
  }

  #setActive(active: boolean): void {
    if (this.#active === active) return
    this.#active = active
    const modes = window.ioc?.get<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', OWNER)
    else modes?.exit('view:active', OWNER)
  }
}

const _launcherView = new LauncherViewDrone()
window.ioc.register('@diamondcoreprocessor.com/LauncherViewDrone', _launcherView)

const LAUNCHER_CSS = `
.hc-launcher{position:fixed;z-index:150;top:max(var(--hc-inset-top,0px),var(--hc-header-anchor,0px));right:var(--hc-inset-right,0px);bottom:var(--hc-inset-bottom,0px);left:var(--hc-inset-left,0px);display:flex;flex-direction:column;background:#10161b;color:rgba(233,240,246,.94);font-family:system-ui,sans-serif}
.ln-bar{display:flex;align-items:center;gap:.5rem;padding:.55rem .7rem .35rem}
.ln-title{flex:1;min-width:0;margin:0;font:600 1.05rem/1.2 system-ui,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ln-switch{display:flex;gap:.25rem}
.ln-style,.ln-close,.ln-arrow,.ln-dot{min-width:2.75rem;min-height:2.75rem;border:0;background:transparent;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.ln-style{border-radius:999px;padding:0 .7rem;font:600 .78rem/1 system-ui,sans-serif;color:rgba(207,226,238,.72)}
.ln-style[aria-pressed="true"]{background:rgba(126,182,214,.22);color:rgba(248,252,255,.98)}
.ln-close{font:400 1.6rem/1 system-ui,sans-serif}
.ln-viewport{flex:1;min-height:0;overflow:hidden;touch-action:pan-y}
.ln-track{display:flex;height:100%;transition:transform .28s ease}
.ln-screen{flex:0 0 100%;height:100%;overflow:auto}
.ln-grid{display:grid;grid-template-columns:repeat(var(--cols,4),minmax(0,1fr));align-content:start;box-sizing:border-box}
.hc-launcher[data-style="icons"] .ln-grid{grid-auto-rows:6.6rem;gap:.35rem .2rem;padding:.4rem .35rem 1rem}
.hc-launcher[data-style="square"] .ln-grid{gap:.85rem;padding:.5rem 1rem 1.2rem}
.ln-tile{display:flex;flex-direction:column;align-items:center;gap:.35rem;min-width:0;padding:0;border:0;background:none;color:inherit;cursor:pointer}
.ln-tile:active .ln-plate{transform:scale(.92)}
.ln-plate{position:relative;display:grid;place-items:center;overflow:hidden;background:hsl(var(--hue,200),32%,30%);box-shadow:inset 0 0 0 1px rgba(126,182,214,.22)}
.hc-launcher[data-style="icons"] .ln-plate{width:3.4rem;height:3.4rem;border-radius:.8rem}
.hc-launcher[data-style="square"] .ln-plate{width:100%;aspect-ratio:1;border-radius:.7rem}
.ln-plate img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ln-letter{font:600 1.15rem/1 system-ui,sans-serif;color:rgba(248,252,255,.94)}
.ln-plate[data-ready] .ln-letter{opacity:0}
.ln-name{max-width:100%;padding:0 .15rem;font:500 .72rem/1.15 system-ui,sans-serif;text-align:center;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hc-launcher[data-style="square"] .ln-name{font-size:.85rem}
.ln-empty{margin:18vh 1.5rem 0;text-align:center;color:rgba(207,226,238,.7)}
.ln-pager{display:flex;align-items:center;justify-content:center;gap:.1rem;padding:.1rem .3rem max(.45rem,var(--hc-safe-bottom,0px))}
.ln-dots{display:flex;align-items:center;justify-content:center}
.ln-dot{display:grid;place-items:center;padding:0}
.ln-dot>span{width:.42rem;height:.42rem;border-radius:999px;background:rgba(207,226,238,.32)}
.ln-dot[aria-current="true"]>span{width:1.15rem;background:rgba(233,240,246,.95)}
.ln-arrow{font:400 1.7rem/1 system-ui,sans-serif;color:rgba(207,226,238,.8)}
.ln-status{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (prefers-reduced-motion:reduce){.ln-track{transition:none}}
`
