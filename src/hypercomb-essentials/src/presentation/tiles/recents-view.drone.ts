// presentation/tiles/recents-view.drone.ts
//
// RecentsViewDrone — the full-screen recents view (documentation/recents-and-
// the-quick-tray.md, codex H7): every atom this hive made, newest at the
// centre, hidden ones shaded and further out. It takes over the hive's own
// surface the way a dive does: the atoms are handed to show-cell as
// `render:dive`, so they are painted by the page's own shader, atlases and
// geometry packer, and the page comes back exactly as it was. There is no
// second renderer.
//
// Opened by `recents:open`; closed by Escape, a press on empty space, or the
// explorer moving. While it is up it owns the pointer:
//   wheel        pages further out and back (recents-layout.ts: a screen is
//                finite, so the view pages rather than caps)
//   click        walks to the atom
//   ctrl/shift   sends a reference to the quick tray and stays open
// An atom no page lists has nowhere to walk to, so a plain click takes it too:
// that is how a cut tile gets back onto a page.
//
// READS ONLY. The census is read through its reader; a miss asks for it
// (`recents:wanted`) and the view paints when `recents:census-changed` lands.
// Two atoms may share a name: the hexes stay right because clicks are resolved
// by axial position, but the hover highlight is keyed by label in show-cell, so
// it lands on only one of them.

import { Drone, EffectBus, I18N_IOC_KEY, consumePointerGesture, type I18nProvider } from '@hypercomb/core'
import { recoverableTileImageSig } from '../../editor/tile-properties.js'
import { RECENTS_CENSUS_KEY, type RecentsCensusReader } from '../../history/recents-census.service.js'
import type { RecentAtom } from '../../history/recents-census.js'
import type { DiveCell } from './show-cell.drone.js'
import { takePayload } from './portal-carry.plan.js'
import { clampPage, filterAtoms, layoutPage, recentsClickPlan, type Axial } from './recents-layout.js'

type OverlayLike = { dropTargetAtClient?(x: number, y: number): { q: number; r: number } | null }
type StoreLike = {
  getLayerBytes?(sig: string): Promise<Uint8Array | null>
  getResource?(sig: string): Promise<Blob | null>
}

const SIG = /^[0-9a-f]{64}$/i

export class RecentsViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  public override description =
    'The full-screen recents view: every atom this hive made, newest at the centre, hidden ones shaded and further out.'

  protected override listens = ['render:set-orientation', 'render:dive-painted']
  protected override emits = ['render:dive', 'render:dive-hover', 'quick-tray:take', 'toast:show']

  #open = false
  #painted = false
  #filter = ''
  #page = 0
  #total = 0
  #flat = false
  #byAxial = new Map<string, RecentAtom>()
  #hoverLabel: string | null = null
  #buildToken = 0
  /** sig → the picture its layer names. Content is immutable, so this never
   *  goes stale; a miss is remembered too. */
  #images = new Map<string, string | undefined>()

  constructor() {
    super()
    this.onEffect<{ flat?: boolean }>('render:set-orientation', p => { this.#flat = !!p?.flat })
    // show-cell's word on what is up: a zero while the view believes it is
    // painted means the surface was taken from under it.
    this.onEffect<{ count?: number }>('render:dive-painted', p => {
      if (this.#painted && (p?.count ?? 0) === 0) this.#close()
    })
    EffectBus.on<{ filter?: string }>('recents:open', p => { void this.#show(String(p?.filter ?? '')) })
    EffectBus.on('recents:census-changed', () => { if (this.#open) void this.#paint() })
  }

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => { }

  protected override dispose(): void {
    this.#close()
  }

  async #show(filter: string): Promise<void> {
    if (!this.#open) {
      this.#open = true
      window.addEventListener('keydown', this.#onKeyDown, true)
      window.addEventListener('wheel', this.#onWheel, { capture: true, passive: false })
      window.addEventListener('pointerdown', this.#onPointerDown, true)
      window.addEventListener('pointermove', this.#onPointerMove, true)
      window.addEventListener('navigate', this.#onNavigate)
    }
    this.#filter = filter
    this.#page = 0
    // Asked every time: it recounts the bags, which a read cannot do.
    EffectBus.emitTransient('recents:wanted', {})
    await this.#paint()
    if (this.#open && !this.#painted) this.#say('recents.counting', 'Counting what this hive has made…')
  }

  #close(): void {
    this.#buildToken++
    const wasPainted = this.#painted
    this.#open = false
    this.#painted = false
    this.#byAxial.clear()
    this.#hoverLabel = null
    window.removeEventListener('keydown', this.#onKeyDown, true)
    window.removeEventListener('wheel', this.#onWheel, { capture: true } as EventListenerOptions)
    window.removeEventListener('pointerdown', this.#onPointerDown, true)
    window.removeEventListener('pointermove', this.#onPointerMove, true)
    window.removeEventListener('navigate', this.#onNavigate)
    if (wasPainted) this.emitEffect('render:dive', { cells: null })
  }

  async #paint(): Promise<void> {
    const token = ++this.#buildToken
    const reader = window.ioc.get<RecentsCensusReader>(RECENTS_CENSUS_KEY)
    const everything = await reader?.atoms().catch(() => [] as RecentAtom[]) ?? []
    if (token !== this.#buildToken) return
    const atoms = filterAtoms(everything, this.#filter)
    this.#total = atoms.length
    this.#page = clampPage(this.#page, atoms.length)
    if (atoms.length === 0) {
      if (everything.length > 0) { this.#say('recents.no-match', 'Nothing here matches that'); this.#close() }
      return
    }
    const laid = layoutPage(atoms, this.#page)
    const cells: DiveCell[] = []
    const byAxial = new Map<string, RecentAtom>()
    for (const { atom, slot } of laid) {
      const imageSig = await this.#imageOf(atom.sig)
      if (token !== this.#buildToken) return
      byAxial.set(axialKey(slot), atom)
      cells.push({
        q: slot.q, r: slot.r, label: atom.label, imageSig, hasBranch: false,
        hideText: false, portal: false, shaded: atom.hidden,
      })
    }
    this.#byAxial = byAxial
    this.#painted = true
    this.#hoverLabel = null
    this.emitEffect('render:dive', { cells })
  }

  /** The picture an atom's own layer names, read from this device only. An
   *  atom whose layer holds none falls to the substrate, as a page would. */
  async #imageOf(sig: string): Promise<string | undefined> {
    if (!this.#images.has(sig)) this.#images.set(sig, await this.#readImage(sig))
    return this.#images.get(sig)
      ?? window.ioc.get<{ pickImageForLabel?: (l: string) => string | null }>('@diamondcoreprocessor.com/SubstrateService')
        ?.pickImageForLabel?.(this.#labelOf(sig)) ?? undefined
  }

  #labelOf(sig: string): string {
    for (const atom of this.#byAxial.values()) if (atom.sig === sig) return atom.label
    return ''
  }

  async #readImage(sig: string): Promise<string | undefined> {
    try {
      const store = window.ioc.get<StoreLike>('@hypercomb.social/Store')
      const bytes = await store?.getLayerBytes?.(sig)
      if (!bytes?.byteLength) return undefined
      const layer = JSON.parse(new TextDecoder().decode(bytes)) as { properties?: unknown }
      const propsSig = Array.isArray(layer.properties) ? layer.properties[0] : undefined
      if (typeof propsSig !== 'string' || !SIG.test(propsSig)) return undefined
      const blob = await store?.getResource?.(propsSig)
      return blob ? recoverableTileImageSig(JSON.parse(await blob.text()), this.#flat) : undefined
    } catch { return undefined }
  }

  #atomAt(x: number, y: number): RecentAtom | null {
    const overlay = window.ioc.get<OverlayLike>('@diamondcoreprocessor.com/TileOverlayDrone')
    const hit = overlay?.dropTargetAtClient?.(x, y)
    return hit ? this.#byAxial.get(axialKey(hit)) ?? null : null
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    this.#close()
  }

  #onNavigate = (): void => { this.#close() }

  #onWheel = (e: WheelEvent): void => {
    if ((e.target as Element | null)?.closest?.('[data-consumes-wheel]')) return
    e.preventDefault()
    e.stopPropagation()
    const next = clampPage(this.#page + (e.deltaY > 0 ? 1 : -1), this.#total)
    if (next === this.#page) return
    this.#page = next
    void this.#paint()
  }

  #onPointerMove = (e: PointerEvent): void => {
    if (!this.#painted) return
    const label = this.#atomAt(e.clientX, e.clientY)?.label ?? null
    if (label === this.#hoverLabel) return
    this.#hoverLabel = label
    this.emitEffect('render:dive-hover', { label })
  }

  #onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.#painted) return
    // Chrome stays chrome: the tray is what a take lands in, and its rows must
    // still drag while the view is up.
    if ((e.target as Element | null)?.closest?.('hc-quick-tray')) return
    e.stopPropagation()                     // tile-overlay must not act on the hidden page
    const atom = this.#atomAt(e.clientX, e.clientY)
    if (!atom) { this.#close(); return }    // a press on empty space backs out
    consumePointerGesture(e.pointerId)      // trailing pointerup + click die at window capture
    const plan = recentsClickPlan(atom, e.ctrlKey || e.metaKey || e.shiftKey)
    if (plan.kind === 'take') {
      this.emitEffect('quick-tray:take', takePayload(atom.label, plan.source, atom.sig, !atom.placed))
      return
    }
    this.#close()
    window.ioc.get<{ goRaw?: (s: readonly string[]) => void }>('@hypercomb.social/Navigation')?.goRaw?.([...plan.travel])
  }

  #say(key: string, fallback: string): void {
    const message = window.ioc.get<I18nProvider>(I18N_IOC_KEY)?.t?.(key) ?? fallback
    this.emitEffect('toast:show', { type: 'info', message })
  }
}

const axialKey = (a: Axial): string => `${a.q},${a.r}`

const _recentsView = new RecentsViewDrone()
window.ioc.register('@diamondcoreprocessor.com/RecentsViewDrone', _recentsView)
