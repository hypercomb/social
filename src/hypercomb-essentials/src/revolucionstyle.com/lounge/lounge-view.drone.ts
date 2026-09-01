// THE ROOM, BY ITSELF — the lounge view.
//
// This is the frame that gives the room the whole screen and almost nothing
// else: the artifact on its own, which is the state you want to be able to
// get to from anywhere. No site chrome, no reading column, no concierge — a
// way in, a way out, and the camera chips, because a room you cannot look
// around is a picture of a room.
//
// It mounts from the CELL'S OWN RECORD (`visual:lounge:room`), never from a
// page. That is the whole difference from what came before: the lounge used
// to exist only as HTML inside the Revolución site, so the only door was the
// site, and walking to the lounge meant walking the website to a page about
// the lounge. Now the tile carries the room, this frame opens it, and the
// site page is one doorway among however many the room ends up having.
//
// NEVER TRAPS: a cell with no room record (or a hidden one) drops straight
// back to the hexagons instead of holding an empty surface — the same rule
// every view here follows.

import { Drone } from '@hypercomb/core'
import { isFeatureHidden } from '../../sharing/feature-hidden.js'
import { titleForLabel } from '../../commands/decoration-kind-index.js'
import type { BackGesture } from '../../navigation/back-gesture.service.js'
import {
  LOUNGE_KIND, LOUNGE_VIEW, loungeRoomAt, loungeViews, mountLoungeRoom,
  type LoungeRoomPayload, type MountedRoom,
} from './lounge-room.js'

/** The surface a view falls back to. */
const HEXAGONS = 'hexagons'

type ViewModeShape = EventTarget & { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }
type ModeRegistryShape = { enter(mode: string, owner: string): void; exit(mode: string, owner: string): void }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

export class LoungeViewDrone extends Drone {
  readonly namespace = 'revolucionstyle.com'
  override genotype = 'presentation'
  override description =
    'Lounge renderer — mounts the cell\'s own room bundle full-viewport as the tile\'s presence; Escape returns to the hexagons.'

  #host: HTMLElement | null = null
  #room: MountedRoom | null = null
  #targetSegments: string[] | null = null
  /** The cell the mounted room belongs to — a navigation that lands on the
   *  same cell must not tear a live WebGL context down and build it again. */
  #mountedKey = ''
  #bound = false
  #active = false
  /** Re-entrancy generation — a reconcile bails after any await once a newer
   *  one has started, so the latest always wins. */
  #gen = 0
  #backOff: (() => void) | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#bound) {
      this.#vm()?.addEventListener('change', this.#change)
      window.addEventListener('keydown', this.#key, true)
      this.onEffect<{ view?: string; segments?: string[] }>('view:open-for-tile', payload => {
        if (payload?.view !== LOUNGE_VIEW) return
        this.#targetSegments = (payload.segments ?? []).map(String).filter(Boolean)
        this.#vm()?.setMode(LOUNGE_VIEW)
        void this.#reconcile()
      })
      // Follow the lineage like every renderer — walking somewhere else while
      // the room is up re-mounts it there, or drops to hexagons.
      get<EventTarget>('@hypercomb.social/Lineage')?.addEventListener?.('change', this.#lineageChange)
      // A room record arriving (adoption, undo, a build writing it) while we
      // stand on the cell should be able to open it.
      this.onEffect('decorations:changed', this.#change)
      this.onEffect('feature:hidden', this.#change)
      this.onEffect('feature:restored', this.#change)
      // Right-click comes back out of the room the same way Escape does.
      this.#backOff = get<BackGesture>('@diamondcoreprocessor.com/BackGesture')
        ?.register({ owner: LOUNGE_VIEW, back: () => this.#leave() }) ?? null
      this.#bound = true
    }
    await this.#reconcile()
  }

  protected override dispose(): void {
    this.#vm()?.removeEventListener('change', this.#change)
    get<EventTarget>('@hypercomb.social/Lineage')?.removeEventListener?.('change', this.#lineageChange)
    window.removeEventListener('keydown', this.#key, true)
    this.#backOff?.()
    this.#backOff = null
    this.#teardown()
  }

  readonly #change = (): void => { void this.#reconcile() }
  readonly #lineageChange = (): void => {
    this.#targetSegments = null
    void this.#reconcile()
  }
  readonly #key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.#vm()?.mode !== LOUNGE_VIEW) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#leave()
  }

  #vm(): ViewModeShape | undefined {
    return get<ViewModeShape>('@hypercomb.social/ViewMode')
  }

  /** Out of the room, onto the hexagons where the tile stands. The arrival
   *  latch is already set for this cell, so leaving sticks — it does not get
   *  re-opened by the layer's own default a tick later. */
  #leave(): void {
    this.#vm()?.setMode(HEXAGONS)
  }

  async #reconcile(): Promise<void> {
    const gen = ++this.#gen
    if (this.#vm()?.mode !== LOUNGE_VIEW) {
      this.#targetSegments = null
      this.#teardown()
      return
    }
    await this.#mount(gen)
  }

  async #mount(gen: number): Promise<void> {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    const segments = this.#targetSegments ?? [...(lineage?.explorerSegments?.() ?? [])]
    this.#targetSegments = segments
    const key = segments.join('/')

    // Already standing in this room — leave the live scene alone. Without
    // this, every reconcile trigger (decoration writes, mode churn, a
    // synchronize) would drop a WebGL context and build a new one.
    if (this.#host && this.#mountedKey === key) return

    const hidden = await isFeatureHidden(segments, LOUNGE_KIND).catch(() => false)
    const payload = hidden ? null : await loungeRoomAt(segments)
    if (gen !== this.#gen || this.#vm()?.mode !== LOUNGE_VIEW) return

    if (!payload) {
      // No room here. Never hold a surface with nothing on it.
      this.#targetSegments = null
      this.#teardown()
      this.#vm()?.setMode(HEXAGONS)
      return
    }

    this.#teardown()
    this.#build(segments, payload)
    this.#mountedKey = key
  }

  #build(segments: readonly string[], payload: LoungeRoomPayload): void {
    const host = document.createElement('div')
    host.id = 'hc-lounge-view-host'
    host.style.cssText =
      'position:fixed;top:0;bottom:0;' +
      'left:var(--hc-inset-left,0px);right:var(--hc-inset-right,0px);' +
      'z-index:150;overflow:hidden;background:#0c0805'

    const chrome = document.createElement('style')
    chrome.textContent = LOUNGE_CHROME_CSS
    host.appendChild(chrome)

    // IN THE DOCUMENT FIRST, then the room. The bundle finds its stage with
    // `document.querySelector` on an idle callback — a stage that is still
    // in a detached host when that callback fires is a stage the room cannot
    // find, and the failure would look like "no WebGL" rather than a race.
    document.body.appendChild(host)
    this.#room = mountLoungeRoom(host, payload)

    // ── the only chrome: a way out, and the camera ──────────────────────
    const label = segments.at(-1) ?? ''
    const title = payload.label || titleForLabel(label, navigator.language) || label

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'hc-lounge-close'
    close.textContent = '×'
    close.title = title ? `Leave ${title}` : 'Leave the room'
    close.setAttribute('aria-label', close.title)
    close.onclick = () => this.#leave()

    const rail = document.createElement('div')
    rail.className = 'hc-lounge-rail'
    rail.setAttribute('role', 'group')
    rail.setAttribute('aria-label', 'Where to look')
    for (const view of loungeViews(payload)) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'hc-lounge-chip'
      chip.textContent = view
      chip.onclick = () => { void this.#room?.ready().then(api => api?.view(view)) }
      rail.appendChild(chip)
    }

    host.append(close, rail)
    this.#host = host
    this.#setActive(true)
  }

  #teardown(): void {
    this.#room?.teardown()
    this.#room = null
    this.#host?.remove()
    this.#host = null
    this.#mountedKey = ''
    this.#setActive(false)
  }

  #setActive(active: boolean): void {
    if (this.#active === active) return
    this.#active = active
    const modes = get<ModeRegistryShape>('@diamondcoreprocessor.com/ModeRegistry')
    if (active) modes?.enter('view:active', LOUNGE_VIEW)
    else modes?.exit('view:active', LOUNGE_VIEW)
  }
}

/** Brass-on-espresso, the room's own palette. Dimmed at rest so the chrome
 *  recedes while you are looking around, and unmistakably there when looked
 *  for — the same manners the site's exit button has always had. */
const LOUNGE_CHROME_CSS = `
#hc-lounge-view-host .hc-lounge-close{position:absolute;z-index:5;top:calc(.75rem + env(safe-area-inset-top,0px));right:calc(.75rem + env(safe-area-inset-right,0px));width:2.25rem;height:2.25rem;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(20,12,7,.82);border:1px solid rgba(212,175,55,.45);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#e8d9ae;cursor:pointer;padding:0;font:1.3rem/1 serif;opacity:.55;transition:opacity .16s ease}
#hc-lounge-view-host .hc-lounge-close:hover,#hc-lounge-view-host .hc-lounge-close:focus-visible{opacity:1}
#hc-lounge-view-host .hc-lounge-rail{position:absolute;z-index:5;left:50%;transform:translateX(-50%);bottom:calc(1rem + env(safe-area-inset-bottom,0px));display:flex;flex-wrap:wrap;justify-content:center;gap:.4rem;max-width:min(92vw,44rem);padding:0 .5rem}
#hc-lounge-view-host .hc-lounge-chip{background:rgba(20,12,7,.72);border:1px solid rgba(212,175,55,.34);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#e8d9ae;border-radius:999px;padding:.3rem .8rem;cursor:pointer;font:.78rem/1.4 Georgia,"Times New Roman",serif;letter-spacing:.04em;opacity:.62;transition:opacity .16s ease,border-color .16s ease}
#hc-lounge-view-host .hc-lounge-chip:hover,#hc-lounge-view-host .hc-lounge-chip:focus-visible{opacity:1;border-color:rgba(212,175,55,.7)}
`

const _loungeView = new LoungeViewDrone()
window.ioc.register('@revolucionstyle.com/LoungeViewDrone', _loungeView)
