// diamondcoreprocessor.com/assistant/strategies/shatter-to-hex.strategy.ts
//
// "Shatter to Hex" — UI explodes onto the grid. Each atom becomes a hex tile
// arranged in a ring around a source tile. Reuses AxialService ring generation,
// seed:added effect, and ease-out cubic entry animation.

import { EffectBus } from '@hypercomb/core'
import type {
  DisplayStrategy,
  DisplayStrategyName,
  AtomizerProvider,
  AtomDescriptor,
} from '@hypercomb/core'

const SHATTER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'

/** Stagger delay per atom for the fly-out animation (ms) */
const STAGGER_MS = 180

/** Ease-out cubic: 1 - (1 - t)^3 */
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

export class ShatterToHexStrategy implements DisplayStrategy {
  readonly name: DisplayStrategyName = 'shatter'
  readonly icon = SHATTER_SVG

  #provider: AtomizerProvider | null = null
  #atoms: AtomDescriptor[] = []
  #addedSeeds: string[] = []
  #animationFrames: number[] = []

  enter(target: AtomizerProvider, atoms: AtomDescriptor[]): void {
    this.#provider = target
    this.#atoms = atoms
    this.#addedSeeds = []

    // Emit atoms as seeds onto the hex grid with staggered timing
    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i]
      const seed = `atom:${atom.name}`
      this.#addedSeeds.push(seed)

      const frame = window.setTimeout(() => {
        EffectBus.emit('seed:added', { seed })
        EffectBus.emit('atomize:atom-placed', {
          atom,
          index: i,
          total: atoms.length,
          seed,
        })
      }, i * STAGGER_MS)

      this.#animationFrames.push(frame)
    }

    console.log(`[shatter] Shattering ${atoms.length} atoms onto grid`)
  }

  exit(): void {
    // Cancel pending animations
    for (const frame of this.#animationFrames) {
      window.clearTimeout(frame)
    }
    this.#animationFrames = []

    // Remove the atom seeds from the grid
    for (const seed of this.#addedSeeds) {
      EffectBus.emit('seed:removed', { seed })
    }
    this.#addedSeeds = []
    this.#provider = null
    this.#atoms = []
  }

  switchTo(atoms: AtomDescriptor[]): void {
    this.exit()
    if (this.#provider) {
      this.enter(this.#provider, atoms)
    }
  }

  onAtomSelect(atom: AtomDescriptor): void {
    EffectBus.emit('atomize:atom-selected', { atom, strategy: 'shatter' })
  }
}

// Self-register with AtomizeDrone
const strategy = new ShatterToHexStrategy()
const ioc = (globalThis as any).ioc
ioc?.whenReady?.('@diamondcoreprocessor.com/AtomizeDrone', (drone: any) => {
  drone.registerStrategy(strategy)
})
console.log('[ShatterToHexStrategy] Loaded')
