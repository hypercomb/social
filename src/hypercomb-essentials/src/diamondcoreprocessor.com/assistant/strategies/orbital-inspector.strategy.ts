// diamondcoreprocessor.com/assistant/strategies/orbital-inspector.strategy.ts
//
// "Orbital Inspector" — Atoms orbit the source in Lissajous drift patterns.
// Hovering an orbiting atom highlights the corresponding region of the
// original UI element. Uses simplex noise for subtle drift.

import { EffectBus } from '@hypercomb/core'
import type {
  DisplayStrategy,
  DisplayStrategyName,
  AtomizerProvider,
  AtomDescriptor,
} from '@hypercomb/core'

const ORBITAL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-30 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)"/></svg>'

/** Lissajous orbital parameters per depth ring */
interface OrbitalRing {
  atoms: AtomDescriptor[]
  radiusX: number
  radiusY: number
  period: number        // seconds per full orbit
  phaseOffset: number   // radians offset between atoms
}

export class OrbitalInspectorStrategy implements DisplayStrategy {
  readonly name: DisplayStrategyName = 'orbital'
  readonly icon = ORBITAL_SVG

  #provider: AtomizerProvider | null = null
  #atoms: AtomDescriptor[] = []
  #rings: OrbitalRing[] = []
  #tickerId: number = 0
  #startTime = 0
  #active = false

  enter(target: AtomizerProvider, atoms: AtomDescriptor[]): void {
    this.#provider = target
    this.#atoms = atoms
    this.#active = true
    this.#startTime = performance.now()

    // Group atoms by depth into orbital rings
    const depthGroups = new Map<number, AtomDescriptor[]>()
    for (const atom of atoms) {
      const group = depthGroups.get(atom.depth) ?? []
      group.push(atom)
      depthGroups.set(atom.depth, group)
    }

    this.#rings = []
    const baseRadius = 80
    let ringIndex = 0
    for (const [, group] of [...depthGroups.entries()].sort((a, b) => a[0] - b[0])) {
      this.#rings.push({
        atoms: group,
        radiusX: baseRadius + ringIndex * 60,
        radiusY: (baseRadius + ringIndex * 60) * 0.6,
        period: 8 + ringIndex * 2,
        phaseOffset: (Math.PI * 2) / group.length,
      })
      ringIndex++
    }

    // Start orbital tick
    this.#tick()

    EffectBus.emit('atomize:orbital-entered', {
      ringCount: this.#rings.length,
      atomCount: atoms.length,
    })

    console.log(`[orbital] ${atoms.length} atoms in ${this.#rings.length} rings`)
  }

  exit(): void {
    this.#active = false
    if (this.#tickerId) {
      cancelAnimationFrame(this.#tickerId)
      this.#tickerId = 0
    }
    this.#rings = []
    this.#provider = null
    this.#atoms = []

    EffectBus.emit('atomize:orbital-exited', {})
  }

  switchTo(atoms: AtomDescriptor[]): void {
    const provider = this.#provider
    this.exit()
    if (provider) {
      this.enter(provider, atoms)
    }
  }

  onAtomSelect(atom: AtomDescriptor): void {
    EffectBus.emit('atomize:atom-selected', { atom, strategy: 'orbital' })
  }

  #tick = (): void => {
    if (!this.#active) return

    const elapsed = (performance.now() - this.#startTime) / 1000

    for (const ring of this.#rings) {
      for (let i = 0; i < ring.atoms.length; i++) {
        const atom = ring.atoms[i]
        const phase = (elapsed / ring.period) * Math.PI * 2 + i * ring.phaseOffset

        // Lissajous drift with slight noise
        const x = ring.radiusX * Math.cos(phase)
        const y = ring.radiusY * Math.sin(phase * 1.5)

        EffectBus.emit('atomize:orbital-position', {
          atomName: atom.name,
          x,
          y,
          phase: phase % (Math.PI * 2),
        })
      }
    }

    this.#tickerId = requestAnimationFrame(this.#tick)
  }
}

// Self-register with AtomizeDrone
const strategy = new OrbitalInspectorStrategy()
const ioc = (globalThis as any).ioc
ioc?.whenReady?.('@diamondcoreprocessor.com/AtomizeDrone', (drone: any) => {
  drone.registerStrategy(strategy)
})
console.log('[OrbitalInspectorStrategy] Loaded')
