// diamondcoreprocessor.com/games/roper/roper.drone.ts
//
// RoperDrone — owns the Roper game overlay's on/off lifecycle. The game is a
// self-contained mini-app (see overlay.ts): a full-screen canvas that mounts
// above the hive and tears itself fully down on close. It never touches the hex
// grid or Pixi. This drone is the bridge to the shell: it surfaces the header
// toggle, opens/closes the overlay, and broadcasts availability + active state
// so the command-line's header icon can reflect on/off. Sibling in shape to
// ArkanoidDrone / BubbleDrone / SolomonDrone.
//
// Wiring contract (EffectBus, late-subscriber replay):
//   emits  `roper:state`  { available: true, active: boolean }
//   listens `roper:toggle`                  ← header icon click
//   listens `keymap:invoke` { cmd:'roper.toggle' } ← optional shortcut
//
// Open state is session-only (NOT persisted): a game overlay re-opening on every
// reload would be hostile. The toggle drives it explicitly.

import { Drone, EffectBus } from '@hypercomb/core'
import { RoperOverlay } from './overlay.js'

export class RoperDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'game'

  // Launch descriptor — read by the games launch-group aggregator (which
  // discovers games by enumerating `genotype:'game'` bees in IoC, no roster).
  // gameId is the `<id>:toggle` effect prefix; gameIcon is a Material glyph.
  readonly gameId = 'roper'
  readonly gameLabel = 'Roper'
  readonly gameIcon = 'cable'

  public override description =
    'Roper — turn-based Worms-style artillery. Swing in on a ninja rope and lob a grenade or bomb. Toggle from the header icon or /roper.'

  protected override listens = ['roper:toggle', 'keymap:invoke']
  protected override emits = ['roper:state']

  #overlay: RoperOverlay | null = null
  #wired = false
  #unsubs: (() => void)[] = []

  constructor() {
    super()
    this.#wire()
  }

  protected override sense = (): boolean => true
  protected override heartbeat = async (): Promise<void> => { this.#wire() }

  #wire(): void {
    if (this.#wired) return
    this.#wired = true
    this.#unsubs.push(
      EffectBus.on('roper:toggle', () => this.toggle()),
      EffectBus.on<{ cmd?: string }>('keymap:invoke', ({ cmd }) => {
        if (cmd === 'roper.toggle') this.toggle()
      }),
    )
    this.#emitState()
    ;(window as unknown as { __roper?: RoperDrone }).__roper = this
  }

  // ── public API ───────────────────────────────────────────
  public isActive(): boolean { return !!this.#overlay?.isMounted() }

  public toggle(): boolean {
    return this.isActive() ? (this.close(), false) : (this.open(), true)
  }

  public open(): void {
    if (this.isActive()) return
    this.#overlay = new RoperOverlay(() => this.close())
    this.#overlay.mount()
    window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'roper' } }))
    this.#emitState()
  }

  public close(): void {
    if (!this.#overlay) { this.#emitState(); return }
    this.#overlay.unmount()
    this.#overlay = null
    window.dispatchEvent(new CustomEvent('portal:closed', { detail: { target: 'roper' } }))
    this.#emitState()
  }

  #emitState(): void {
    EffectBus.emit('roper:state', { available: true, active: this.isActive() })
  }

  protected override dispose = (): void => {
    this.close()
    for (const u of this.#unsubs) { try { u() } catch { /* ignore */ } }
    this.#unsubs = []
  }
}

const _roper = new RoperDrone()
window.ioc.register('@diamondcoreprocessor.com/RoperDrone', _roper)
