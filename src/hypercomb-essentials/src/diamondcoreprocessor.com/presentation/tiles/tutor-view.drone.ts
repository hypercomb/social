// diamondcoreprocessor.com/presentation/tiles/tutor-view.drone.ts
//
// Full-viewport STUDY takeover — the tutor analogue of SiteViewDrone. When
// ViewMode is 'tutor', the current cell's generated study deck is fetched
// and the TutorShell (a canvas game session) is mounted inline over the
// viewport. Toggling back to hexagons (the `/tutor` toggle, Escape, or
// right-click) tears it down.
//
// Mirrors SiteViewDrone's lifecycle (lineage + ViewMode listeners, boot
// capture, reconcile, fixed host below the Pixi layer) but instead of
// parsing HTML it resolves the cell's study items and hands them to the
// shell. The deck is FIRST-CLASS: the cell's `tutor` slot is a flat array of
// study-item signatures (each item its own content-addressed resource, like
// `notes`). ViewBee lights the study toggle straight from that slot — no
// decoration. (A legacy single-deck-blob sig in the slot is expanded
// gracefully.)

import { Drone } from '@hypercomb/core'
import { TUTOR_SLOT } from '../../commands/tutor-slot.js'
import { isFeatureHidden } from '../../sharing/feature-hidden.js'
import { TutorShell } from '../../games/tutor/shell.js'
import type { StudyItem } from '../../games/tutor/deck.types.js'

const TUTOR_VIEW = 'tutor'
/** The tutor behaviour's feature identity (registry decorationKind) — the key
 *  the Beehaviors panel writes a hide record under. */
const TUTOR_DECK_KIND = 'visual:tutor:deck'
const SIG = /^[0-9a-f]{64}$/

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }

type MountState = {
  host: HTMLDivElement
  /** Joined item-sig array — the identity of the mounted set (skip remount if unchanged). */
  itemsKey: string
  shell: TutorShell
}

export class TutorViewDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description =
    'Full-viewport study takeover. When ViewMode is "tutor", mounts the current cell\'s study deck as a game session.'

  #mount: MountState | null = null
  #viewActive = false
  #registered = false
  #lineageBound = false
  #viewModeBound = false
  #contextMenuBound = false
  #featureBound = false
  /** Guards against re-entrant async reconciles racing each other. */
  #reconciling = false

  protected override deps = {
    lineage: '@hypercomb.social/Lineage',
    store: '@hypercomb.social/Store',
  }
  protected override listens: string[] = []
  protected override emits = ['view:active']

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register('@diamondcoreprocessor.com/TutorViewDrone', this)
      this.#registered = true
    }
    if (!this.#lineageBound) {
      const lineage = this.resolve<EventTarget & { addEventListener?: typeof EventTarget.prototype.addEventListener }>('lineage')
      if (lineage?.addEventListener) {
        lineage.addEventListener('change', this.#onLineageChange)
        this.#lineageBound = true
      }
    }
    if (!this.#viewModeBound) {
      const vm = this.#vm()
      if (vm?.addEventListener) {
        vm.addEventListener('change', this.#onViewModeChange)
        this.#viewModeBound = true
      }
    }
    if (!this.#contextMenuBound) {
      // Right-click anywhere in tutor mode = exit back to hexagons. Capture
      // phase so the browser context menu never appears. Gated on the mode
      // so it's inert in hexagon view.
      window.addEventListener('contextmenu', this.#onContextMenu, true)
      this.#contextMenuBound = true
    }
    if (!this.#featureBound) {
      // Hide / restore in the Beehaviors panel turns this behaviour off / back on.
      this.onEffect('feature:hidden', () => { void this.#reconcile() })
      this.onEffect('feature:restored', () => { void this.#reconcile() })
      this.#featureBound = true
    }
    void this.#reconcile()
  }

  protected override dispose(): void {
    const lineage = this.resolve<EventTarget & { removeEventListener?: typeof EventTarget.prototype.removeEventListener }>('lineage')
    if (this.#lineageBound && lineage?.removeEventListener) lineage.removeEventListener('change', this.#onLineageChange)
    const vm = this.#vm()
    if (this.#viewModeBound && vm?.removeEventListener) vm.removeEventListener('change', this.#onViewModeChange)
    if (this.#contextMenuBound) window.removeEventListener('contextmenu', this.#onContextMenu, true)
    this.#teardown()
  }

  // ── reactivity ─────────────────────────────────────────────

  readonly #onLineageChange = (): void => { void this.#reconcile() }
  readonly #onViewModeChange = (): void => { void this.#reconcile() }

  readonly #onContextMenu = (e: MouseEvent): void => {
    const vm = this.#vm()
    if (!vm || vm.mode !== TUTOR_VIEW) return
    e.preventDefault()
    vm.setMode('hexagons')
  }

  #vm(): ViewModeShape | undefined {
    return (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc?.get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  // ── reconcile / mount ──────────────────────────────────────

  async #reconcile(): Promise<void> {
    if (this.#reconciling) return
    this.#reconciling = true
    try {
      const lineage = this.resolve<{ explorerSegments?: () => readonly string[] }>('lineage')
      const store = this.resolve<{ hypercombRoot?: unknown; getResource?: (sig: string) => Promise<Blob | null> }>('store')
      if (!lineage || !store?.getResource) return
      const getResource = store.getResource.bind(store)

      const vm = this.#vm()
      if (vm && vm.mode !== TUTOR_VIEW) { this.#teardown(); return }

      const segments: string[] = [...(lineage.explorerSegments?.() ?? [])]
      // Honor the Beehaviors panel's off switch (hidden-pool gate).
      if (await isFeatureHidden(segments, TUTOR_DECK_KIND)) { this.#teardown(); return }
      const found = await this.#findItems(segments)
      if (!found || found.sigs.length === 0) { this.#teardown(); return }
      await this.#mountItems(found.sigs, found.locationSig, getResource)
    } finally {
      this.#reconciling = false
    }
  }

  /** The cell's study items live in its first-class `tutor` slot — a flat
   *  array of content-addressed item signatures. Returns that sig array plus
   *  the location signature (used as the participant-local progress key).
   *  ViewBee owns toggle presence from this same slot, so there's no
   *  decoration to consult. */
  async #findItems(segments: readonly string[]): Promise<{ sigs: string[]; locationSig: string } | null> {
    const ioc = (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc
    const history = ioc?.get<{
      sign: (l: { explorerSegments?: () => readonly string[] }) => Promise<string>
      currentLayerAt: (sig: string) => Promise<Record<string, unknown> | null>
    }>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null
    try {
      const locationSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locationSig)
      if (!layer) return null
      const slot = layer[TUTOR_SLOT]
      const sigs = Array.isArray(slot) ? slot.map(s => String(s)).filter(s => SIG.test(s)) : []
      return sigs.length ? { sigs, locationSig } : null
    } catch {
      return null // cold read — caller tears down, retries on next reconcile
    }
  }

  /** Resolve each slot signature to a StudyItem and mount the shell. A slot
   *  sig that resolves to a legacy single-deck blob ({ items: [...] }) is
   *  expanded; a per-item resource ({ prompt, answer }) is used directly. */
  async #mountItems(
    sigs: readonly string[],
    locationSig: string,
    getResource: (sig: string) => Promise<Blob | null>,
  ): Promise<void> {
    const key = sigs.join(',')
    if (this.#mount && this.#mount.itemsKey === key) return // already studying this exact set

    const items: StudyItem[] = []
    for (const sig of sigs) {
      const blob = await getResource(sig)
      if (!blob) continue
      try {
        const parsed = JSON.parse(await blob.text()) as Record<string, unknown>
        const inner = (parsed as { items?: unknown }).items
        if (Array.isArray(inner)) {
          // Legacy single-deck blob — expand its inline items.
          for (const it of inner) if (it && typeof (it as StudyItem).prompt === 'string') items.push(it as StudyItem)
        } else if (typeof parsed['prompt'] === 'string' && typeof parsed['answer'] === 'string') {
          // First-class per-item resource.
          items.push(parsed as unknown as StudyItem)
        }
      } catch { /* malformed — skip */ }
    }
    if (!items.length) { this.#teardown(); return }

    this.#teardown()

    const host = document.createElement('div')
    host.id = 'hc-tutor-view-host'
    host.style.cssText = 'position:fixed;inset:0;z-index:59988;overflow:hidden;background:#05040f;'
    // Opt out of the always-on hex wheel-zoom handler — the shell owns its
    // own surface; without this the zoom handler preventDefaults wheel events.
    host.setAttribute('data-consumes-wheel', '')
    document.body.appendChild(host)

    const shell = new TutorShell(items, locationSig, () => this.#vm()?.setMode('hexagons'))
    shell.mount(host)

    this.#mount = { host, itemsKey: key, shell }
    this.#setViewActive(true)
  }

  #teardown(): void {
    if (this.#mount) {
      try { this.#mount.shell.unmount() } catch { /* noop */ }
      this.#mount.host.remove()
      this.#mount = null
    }
    if (this.#viewActive) this.#setViewActive(false)
  }

  #setViewActive(active: boolean): void {
    if (this.#viewActive === active) return
    this.#viewActive = active
    this.emitEffect<{ active: boolean }>('view:active', { active })
  }
}

const _tutorView = new TutorViewDrone()
window.ioc.register('@diamondcoreprocessor.com/TutorViewDrone', _tutorView)
