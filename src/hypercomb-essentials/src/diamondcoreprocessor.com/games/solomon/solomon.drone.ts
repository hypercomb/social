// diamondcoreprocessor.com/games/solomon/solomon.drone.ts
//
// SolomonDrone — owns the Solomon's Key game overlay's on/off lifecycle.
//
// The game is a self-contained mini-app (see overlay.ts): a full-screen canvas
// that mounts above the hive and tears itself fully down on close. It never
// touches the hex grid or Pixi. This drone is the bridge to the shell: it
// surfaces the header toggle, opens/closes the overlay, and broadcasts its
// availability + active state so the command-line's header icon can reflect on
// / off.
//
// Wiring contract (EffectBus, late-subscriber replay):
//   emits  `solomon:state`  { available: true, active: boolean }
//   listens `solomon:toggle`                  ← header icon click
//   listens `keymap:invoke` { cmd:'solomon.toggle' } ← optional shortcut
//
// Open state is session-only (NOT persisted): a game overlay re-opening on
// every reload would be hostile. The toggle drives it explicitly.

import { Drone, EffectBus } from '@hypercomb/core'
import { SolomonOverlay } from './overlay.js'

export class SolomonDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'game'

  // Launch descriptor — read by the games launch-group aggregator (which
  // discovers games by enumerating `genotype:'game'` bees in IoC, no roster).
  // gameId is the `<id>:toggle` effect prefix; gameIcon is a Material glyph.
  readonly gameId = 'solomon'
  readonly gameLabel = "Solomon's Key"
  readonly gameIcon = 'castle'

  public override description =
    "Solomon's Key — a block-conjuring puzzle-platformer with a built-in level designer. Toggle from the header icon or /solomon."

  protected override listens = ['solomon:toggle', 'keymap:invoke']
  protected override emits = ['solomon:state']

  #overlay: SolomonOverlay | null = null
  #wired = false
  #unsubs: (() => void)[] = []

  constructor() {
    super()
    // Wire at construction so the header icon announces itself the moment the
    // module loads — independent of the first processor pulse. Idempotent with
    // the heartbeat re-wire below.
    this.#wire()
  }

  protected override sense = (): boolean => true

  protected override heartbeat = async (): Promise<void> => {
    this.#wire()
  }

  #wire(): void {
    if (this.#wired) return
    this.#wired = true

    this.#unsubs.push(
      EffectBus.on('solomon:toggle', () => this.toggle()),
      EffectBus.on<{ cmd?: string }>('keymap:invoke', ({ cmd }) => {
        if (cmd === 'solomon.toggle') this.toggle()
      }),
    )
    // Announce availability so the header icon appears (replayed to late subs).
    this.#emitState()
    ;(window as unknown as { __solomon?: SolomonDrone }).__solomon = this
  }

  // ── public API ───────────────────────────────────────────

  public isActive(): boolean { return !!this.#overlay?.isMounted() }

  public toggle(): boolean {
    return this.isActive() ? (this.close(), false) : (this.open(), true)
  }

  public open(): void {
    if (this.isActive()) return
    this.#overlay = new SolomonOverlay(() => this.close())
    this.#overlay.mount()
    // Tell overlays/screensaver the hive is covered (suspends the idle saver).
    window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'solomon' } }))
    this.#emitState()
  }

  /** Open the overlay straight into the level designer. */
  public openDesigner(): void {
    this.open()
    this.#overlay?.showDesigner()
  }

  public close(): void {
    if (!this.#overlay) { this.#emitState(); return }
    this.#overlay.unmount()
    this.#overlay = null
    window.dispatchEvent(new CustomEvent('portal:closed', { detail: { target: 'solomon' } }))
    this.#emitState()
  }

  #emitState(): void {
    EffectBus.emit('solomon:state', { available: true, active: this.isActive() })
  }

  protected override dispose = (): void => {
    this.close()
    for (const u of this.#unsubs) { try { u() } catch { /* ignore */ } }
    this.#unsubs = []
  }
}

const _solomon = new SolomonDrone()
window.ioc.register('@diamondcoreprocessor.com/SolomonDrone', _solomon)
