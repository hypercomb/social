// diamondcoreprocessor.com/sharing/sample-swarm.drone.ts
//
// SAMPLING A SWARM — pick several of somebody else's tiles, then keep them.
//
// Browsing a swarm shows you other participants' tiles alongside your own. You
// do not hold them; you are looking. Sampling is the verb for turning some of
// what you are looking at into yours: arm it, tap the tiles you want, keep
// them. Nothing is written until you say keep — which is the whole point.
//
// SELECTION IS THE SUBSTRATE. This mints no picked-set of its own: it arms
// `sample:mode` (tile-overlay stops navigating and starts toggling) and the
// tiles land in the ordinary SelectionService, so they ring on the canvas with
// the selection visuals that already exist, and every other verb that reads a
// selection — marking with a pheromone, the command line's bracket form — sees
// the same set. The only thing this adds is a way for a FINGER to build one: a
// pointer says "pick this too" by holding ctrl, and a finger has no modifiers.
//
// It shows up only when there is something to sample (peer tiles on screen),
// so it costs no permanent chrome — the mobile control bar is deliberately
// capped at five.
//
// Keeping routes to the SAME bulk adopt the disambiguation panel uses
// (`adopt-selected`, `{label, pubkey}` pairs), so the fold, the consent gate
// for code, and the Beehaviors landing are all the paths that already existed.
// A name offered by SEVERAL publishers cannot be resolved from a canvas pick —
// the tile shows one hex but two people are behind it — so that case hands off
// to the panel, preselected, which is the surface built to ask.

// ON MOBILE THIS PILL STANDS DOWN. SelectModeDrone is the one picker on a
// phone — it is always up, and "keep" is simply the verb it offers once the
// picked set contains somebody else's tile, which it asks for here
// (`keepSelected`). Two pills on a phone claimed there were two selections,
// and the general picker used to disappear in a swarm — exactly where picking
// matters most. On a pointer this pill stays: there is no always-up picker
// there, because ctrl-click already is one.

import { Drone, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { MOBILE_MODE_EFFECT, MOBILE_MODE_IOC_KEY } from '../preferences/mobile-pheromones.js'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const SELECTION_KEY = '@diamondcoreprocessor.com/SelectionService'

const STEEL = 'rgba(126,182,214,0.92)'
/** Thumb-target floor — the same one the fullscreen tile view uses. */
const TAP = '2.9rem'

type PeerTile = { name?: unknown; peerPubkey?: unknown; layerSig?: unknown }
type SwarmShape = {
  peerTilesAtCurrentSig?(): readonly PeerTile[]
  subscribedTiles?(): readonly PeerTile[]
}
type SelectionShape = {
  selected: ReadonlySet<string>
  clear(): void
}
type MobileModeLike = { active?: boolean }

export class SampleSwarmDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Pick several peer tiles while browsing a swarm, then keep them.'

  protected override deps = {}
  protected override listens = ['render:cell-count', 'selection:changed', MOBILE_MODE_EFFECT]
  protected override emits = ['sample:mode', 'tile:action', 'swarm:adopt-panel:open']

  #registered = false
  #bound = false
  #host: HTMLDivElement | null = null
  /** Peer-published labels on screen right now — what there is to sample. */
  #external: string[] = []
  #selected: string[] = []
  #armed = false
  /** On a phone the general picker owns the pill; this one only lends it the
   *  keep verb. See the note at the top of the file. */
  #mobile = false

  protected override heartbeat = async (): Promise<void> => {
    if (!this.#registered) {
      window.ioc.register('@diamondcoreprocessor.com/SampleSwarmDrone', this)
      this.#registered = true
    }
    if (this.#bound) return
    this.#bound = true

    this.#mobile = !!(window.ioc?.get?.(MOBILE_MODE_IOC_KEY) as MobileModeLike | undefined)?.active
    this.onEffect<{ active?: boolean }>(MOBILE_MODE_EFFECT, payload => {
      this.#mobile = !!payload?.active
      this.#reconcile()
    })

    this.onEffect<{ externalLabels?: unknown }>('render:cell-count', payload => {
      const list = Array.isArray(payload?.externalLabels) ? payload.externalLabels : []
      this.#external = list.map(s => String(s)).filter(Boolean)
      this.#reconcile()
    })

    this.onEffect<{ selected?: unknown }>('selection:changed', payload => {
      const list = Array.isArray(payload?.selected) ? payload.selected : []
      this.#selected = list.map(s => String(s)).filter(Boolean)
      this.#reconcile()
    })

    // Leaving the page, the swarm, or the mode ends the sampling — a picked
    // set is only meaningful where it was picked (navigation clears the
    // selection anyway, and peer tiles are per-location).
    this.onEffect('navigation:guard-start', () => this.#disarm())
    this.onEffect('mesh:public-changed', () => this.#disarm())
    this.onEffect('adopt:done', () => this.#disarm())
  }

  #disarm(): void {
    if (!this.#armed) return
    this.#armed = false
    this.emitEffect('sample:mode', { active: false })
    this.#reconcile()
  }

  #arm(): void {
    if (this.#armed) return
    this.#armed = true
    this.emitEffect('sample:mode', { active: true })
    this.#reconcile()
  }

  /** How many of the picked tiles are actually somebody else's. Picking is not
   *  restricted to peer tiles — the selection is shared with every other verb —
   *  but only peer tiles can be KEPT, so the button counts those. */
  #keepable(): string[] {
    const peers = new Set(this.#external)
    return this.#selected.filter(label => peers.has(label))
  }

  #reconcile(): void {
    // On a phone the general picker is the pill; this drone keeps only its
    // keep verb (`keepSelected`), reached from that pill.
    if (this.#mobile) {
      if (this.#armed) this.#disarm()
      this.#teardown()
      return
    }
    // Nothing to sample here — no pill, and never a mode left armed over a
    // page that has no peer tiles on it.
    if (this.#external.length === 0) {
      if (this.#armed) {
        this.#armed = false
        this.emitEffect('sample:mode', { active: false })
      }
      this.#teardown()
      return
    }
    this.#render()
  }

  #teardown(): void {
    this.#host?.remove()
    this.#host = null
  }

  #render(): void {
    this.#teardown()

    const host = document.createElement('div')
    host.id = 'hc-sample-pill'
    // Above the mobile control bar, clear of the home indicator. Centred so it
    // reads as a statement about the page rather than another bar control.
    host.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);z-index:1400;' +
      'bottom:calc(6.2rem + env(safe-area-inset-bottom,0px));' +
      'display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.5rem;' +
      'border-radius:2rem;background:rgba(12,17,24,0.92);backdrop-filter:blur(10px);' +
      'border:1px solid rgba(126,182,214,0.35);box-shadow:0 10px 30px rgba(0,0,0,0.45);' +
      'font-family:inherit;pointer-events:auto;'

    if (!this.#armed) {
      host.appendChild(this.#button(
        this.#t('swarm.sample.start', 'Pick tiles'),
        'touch_app',
        false,
        () => this.#arm(),
      ))
    } else {
      const keepable = this.#keepable()
      const label = keepable.length === 0
        ? this.#t('swarm.sample.hint', 'Tap the tiles you want')
        : this.#t('swarm.sample.keep', `Keep ${keepable.length}`, { count: keepable.length })
      host.appendChild(this.#button(
        label,
        'download',
        keepable.length > 0,
        () => { if (keepable.length > 0) this.#keep(keepable) },
        keepable.length === 0,
      ))
      host.appendChild(this.#button(this.#t('swarm.sample.done', 'Done'), 'close', false, () => {
        this.#selectionService()?.clear()
        this.#disarm()
      }))
    }

    document.body.appendChild(host)
    this.#host = host
  }

  #button(text: string, glyph: string, accent: boolean, onTap: () => void, inert = false): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.style.cssText =
      `min-height:${TAP};padding:0 0.95rem;border-radius:2rem;cursor:pointer;` +
      'display:inline-flex;align-items:center;gap:0.45rem;font:inherit;font-size:0.92rem;font-weight:600;' +
      `background:${accent ? STEEL : 'transparent'};color:${accent ? '#04121b' : 'rgba(232,240,246,0.9)'};` +
      `border:1px solid ${accent ? 'transparent' : 'rgba(255,255,255,0.14)'};` +
      `opacity:${inert ? 0.55 : 1};`
    const icon = document.createElement('span')
    icon.textContent = glyph
    icon.style.cssText = "font-family:'Material Symbols Outlined';font-size:1.15rem;line-height:1;"
    btn.appendChild(icon)
    const span = document.createElement('span')
    span.textContent = text
    btn.appendChild(span)
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onTap() })
    return btn
  }

  /** Keep these peer tiles. The mobile picker's "Keep N" calls this: the
   *  selection was built there, but resolving a label to the participant who
   *  published it — and the disambiguation when two people publish the same
   *  name — is this drone's job and stays here. */
  public keepSelected(labels: readonly string[]): void {
    const peers = new Set(this.#external)
    const keepable = labels.map(l => String(l)).filter(l => peers.has(l))
    if (keepable.length > 0) this.#keep(keepable)
  }

  /** Keep the picked peer tiles. Resolves each label to the publisher offering
   *  it; a label offered by two or more hands off to the disambiguation panel
   *  (a canvas pick cannot say WHOSE copy — the tile is one hex). */
  #keep(labels: readonly string[]): void {
    const swarm = window.ioc?.get?.(SWARM_DRONE_KEY) as SwarmShape | undefined
    const entries = [
      ...(swarm?.peerTilesAtCurrentSig?.() ?? []),
      ...(swarm?.subscribedTiles?.() ?? []),
    ]

    const publishersFor = (label: string): string[] => {
      const keys = new Set<string>()
      for (const e of entries) {
        if (String(e?.name ?? '') !== label) continue
        const pk = String(e?.peerPubkey ?? '').trim().toLowerCase()
        if (pk) keys.add(pk)
      }
      return [...keys]
    }

    const selections: { label: string; pubkey?: string }[] = []
    const ambiguous: string[] = []
    for (const label of labels) {
      const publishers = publishersFor(label)
      if (publishers.length > 1) { ambiguous.push(label); continue }
      selections.push({ label, pubkey: publishers[0] })
    }

    // Clear before acting: the fold re-renders, and a stale ring over a tile
    // that is now yours reads as still-pending.
    this.#selectionService()?.clear()
    this.#disarm()

    if (ambiguous.length > 0) {
      // Several publishers offer at least one of these names — ask which,
      // rather than silently keeping whoever published most recently.
      this.emitEffect('swarm:adopt-panel:open', { preselect: [...ambiguous, ...selections.map(s => s.label)] })
      return
    }
    if (selections.length === 0) return
    this.emitEffect('tile:action', { action: 'adopt-selected', selections })
  }

  #selectionService(): SelectionShape | undefined {
    try { return window.ioc?.get?.(SELECTION_KEY) as SelectionShape | undefined } catch { return undefined }
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    try {
      const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
      const v = i18n?.t(key, params)
      return v && v !== key ? v : fallback
    } catch { return fallback }
  }
}

const _sampleSwarm = new SampleSwarmDrone()
window.ioc.register('@diamondcoreprocessor.com/SampleSwarmDrone', _sampleSwarm)
