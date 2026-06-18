// diamondcoreprocessor.com/games/arkanoid/arkanoid.drone.ts
//
// ArkanoidDrone — owns the Arkanoid game overlay's on/off lifecycle. The game
// is a self-contained mini-app (see overlay.ts): a full-screen canvas that
// mounts above the hive and tears itself fully down on close. It never touches
// the hex grid or Pixi. This drone is the bridge to the shell: it surfaces the
// header toggle, opens/closes the overlay, and broadcasts availability + active
// state so the command-line's header icon can reflect on/off. Sibling in shape
// to BubbleDrone / SolomonDrone.
//
// Wiring contract (EffectBus, late-subscriber replay):
//   emits  `arkanoid:state`  { available: true, active: boolean }
//   listens `arkanoid:toggle`                  ← header icon click
//   listens `keymap:invoke` { cmd:'arkanoid.toggle' } ← optional shortcut
//
// Open state is session-only (NOT persisted): a game overlay re-opening on
// every reload would be hostile. The toggle drives it explicitly.

import { Drone, EffectBus } from '@hypercomb/core'
import { ArkanoidOverlay } from './overlay.js'

export class ArkanoidDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'game'

  public override description =
    'Arkanoid — bounce the ball off the paddle to break every brick. Toggle from the header icon or /arkanoid.'

  protected override listens = ['arkanoid:toggle', 'keymap:invoke']
  protected override emits = ['arkanoid:state']

  #overlay: ArkanoidOverlay | null = null
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
      EffectBus.on('arkanoid:toggle', () => this.toggle()),
      EffectBus.on<{ cmd?: string }>('keymap:invoke', ({ cmd }) => {
        if (cmd === 'arkanoid.toggle') this.toggle()
      }),
    )
    this.#emitState()
    ;(window as unknown as { __arkanoid?: ArkanoidDrone }).__arkanoid = this
  }

  // ── public API ───────────────────────────────────────────
  public isActive(): boolean { return !!this.#overlay?.isMounted() }

  public toggle(): boolean {
    return this.isActive() ? (this.close(), false) : (this.open(), true)
  }

  public open(): void {
    if (this.isActive()) return
    this.#overlay = new ArkanoidOverlay(() => this.close())
    this.#overlay.mount()
    window.dispatchEvent(new CustomEvent('portal:open', { detail: { target: 'arkanoid' } }))
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
    window.dispatchEvent(new CustomEvent('portal:closed', { detail: { target: 'arkanoid' } }))
    this.#emitState()
  }

  #emitState(): void {
    EffectBus.emit('arkanoid:state', { available: true, active: this.isActive() })
  }

  protected override dispose = (): void => {
    this.close()
    for (const u of this.#unsubs) { try { u() } catch { /* ignore */ } }
    this.#unsubs = []
  }
}

const _arkanoid = new ArkanoidDrone()
window.ioc.register('@diamondcoreprocessor.com/ArkanoidDrone', _arkanoid)
