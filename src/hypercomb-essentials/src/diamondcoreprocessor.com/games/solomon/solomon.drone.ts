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
//   emits  `solomon:state`  { available: boolean, active: boolean }
//   listens `solomon:toggle`                  ← header icon click
//   listens `keymap:invoke` { cmd:'solomon.toggle' } ← optional shortcut
//   listens `behavior:enablement-changed`     ← the Beehaviors roster
//
// A game is a BEHAVIOUR in the roster, switched by the kind `game:solomon`
// (games/game-enablement.ts). Off means gone: `available:false` takes the
// header icon away, `gameDormant` takes the launcher tile, and an overlay
// that happens to be open closes itself the moment the light goes out.
//
// Open state is session-only (NOT persisted): a game overlay re-opening on
// every reload would be hostile. The toggle drives it explicitly.

import { Drone, EffectBus } from '@hypercomb/core'
import { isGameDormant, onEnablementChanged } from '../game-enablement.js'
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
      // The roster flipped a light. Re-announce (the header icon leaves
      // when this game goes dormant) and close if it is open — a game
      // left running above the hive after being switched off is the
      // contradiction "one switch, one meaning" exists to forbid.
      onEnablementChanged(() => {
        if (this.gameDormant) this.close()
        else this.#emitState()
      }),
    )
    // Announce availability so the header icon appears (replayed to late subs).
    this.#emitState()
    ;(window as unknown as { __solomon?: SolomonDrone }).__solomon = this
  }

  // ── public API ───────────────────────────────────────────

  /** Switched off in the Beehaviors roster (kind `game:solomon`). Read by
   *  the shell's launch group off this bee, so the launcher tile leaves
   *  with the header icon — the shell never has to know the kind. */
  public get gameDormant(): boolean { return isGameDormant(this.gameId) }

  public isActive(): boolean { return !!this.#overlay?.isMounted() }

  public toggle(): boolean {
    if (this.isActive()) { this.close(); return false }
    this.open()
    // NOT an unconditional true: open() refuses while the light is out,
    // and every caller words its message from this answer.
    return this.isActive()
  }

  public open(): void {
    // The roster's light is the outer gate: dormant means this game is not
    // here at all — no header icon, no launcher tile, nothing to open.
    if (this.gameDormant || this.isActive()) return
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
    EffectBus.emit('solomon:state', { available: !this.gameDormant, active: this.isActive() })
  }

  protected override dispose = (): void => {
    this.close()
    for (const u of this.#unsubs) { try { u() } catch { /* ignore */ } }
    this.#unsubs = []
  }
}

const _solomon = new SolomonDrone()
window.ioc.register('@diamondcoreprocessor.com/SolomonDrone', _solomon)
