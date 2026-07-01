// diamondcoreprocessor.com/games/bubble/bubble.drone.ts
//
// BubbleDrone — owns the Bubble Bobble game overlay's on/off lifecycle.
//
// The game is a self-contained mini-app (see overlay.ts): a full-screen canvas
// that mounts above the hive and tears itself fully down on close. It never
// touches the hex grid or Pixi. This drone is the bridge to the shell: it
// surfaces the header toggle, opens/closes the overlay, and broadcasts its
// availability + active state so the command-line's header icon can reflect on
// / off. Sibling in shape to the SolomonDrone.
//
// Wiring contract (EffectBus, late-subscriber replay):
//   emits  `bubble:state`  { available: true, active: boolean }
//   listens `bubble:toggle`                  ← header icon click
//   listens `keymap:invoke` { cmd:'bubble.toggle' } ← optional shortcut
//
// Open state is session-only (NOT persisted): a game overlay re-opening on
// every reload would be hostile. The toggle drives it explicitly.

import { Drone, EffectBus } from '@hypercomb/core'
import { BubbleOverlay } from './overlay.js'

export class BubbleDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'game'

  // Launch descriptor — read by the games launch-group aggregator (which
  // discovers games by enumerating `genotype:'game'` bees in IoC, no roster).
  // gameId is the `<id>:toggle` effect prefix; gameIcon is a Material glyph.
  readonly gameId = 'bubble'
  readonly gameLabel = 'Bubble Bobble'
  readonly gameIcon = 'bubble_chart'

  public override description =
    'Bubble Bobble — blow bubbles to trap foes, pop them for fruit, clear the screen. Toggle from the header icon or /bubble.'

  protected override listens = ['bubble:toggle', 'keymap:invoke']
  protected override emits = ['bubble:state']

  #overlay: BubbleOverlay | null = null
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
      EffectBus.on('bubble:toggle', () => this.toggle()),
      EffectBus.on<{ cmd?: string }>('keymap:invoke', ({ cmd }) => {
        if (cmd === 'bubble.toggle') this.toggle()
      }),
    )
    // Announce availability so the header icon appears (replayed to late subs).
    this.#emitState()
    ;(window as unknown as { __bubble?: BubbleDrone }).__bubble = this
  }

  // ── public API ───────────────────────────────────────────

  public isActive(): boolean { return !!this.#overlay?.isMounted() }

  public toggle(): boolean {
    return this.isActive() ? (this.close(), false) : (this.open(), true)
  }

  public open(): void {
    if (this.isActive()) return
    this.#overlay = new BubbleOverlay(() => this.close())
    this.#overlay.mount()
    // Tell overlays/screensaver the hive is covered (suspends the idle saver).
    window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'bubble' } }))
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
    window.dispatchEvent(new CustomEvent('portal:closed', { detail: { target: 'bubble' } }))
    this.#emitState()
  }

  #emitState(): void {
    EffectBus.emit('bubble:state', { available: true, active: this.isActive() })
  }

  protected override dispose = (): void => {
    this.close()
    for (const u of this.#unsubs) { try { u() } catch { /* ignore */ } }
    this.#unsubs = []
  }
}

const _bubble = new BubbleDrone()
window.ioc.register('@diamondcoreprocessor.com/BubbleDrone', _bubble)
