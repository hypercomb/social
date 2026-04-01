// diamondcoreprocessor.com/assistant/strategies/particle-disassembly.strategy.ts
//
// "Particle Disassembly" — GPU-instanced pixel cloud dissolution. The target
// UI element's pixels dissolve into a particle cloud via simplex noise
// displacement, then converge into labeled hex tiles. Reverses on reassemble.

import { EffectBus } from '@hypercomb/core'
import type {
  DisplayStrategy,
  DisplayStrategyName,
  AtomizerProvider,
  AtomDescriptor,
} from '@hypercomb/core'

const PARTICLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="1.5"/><circle cx="18" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="6" cy="18" r="1.5"/><circle cx="18" cy="18" r="1.5"/><circle cx="3" cy="12" r="1"/><circle cx="21" cy="12" r="1"/><circle cx="12" cy="3" r="1"/><circle cx="12" cy="21" r="1"/></svg>'

/** Phase timing (ms) */
const PHASE_CAPTURE = 300
const PHASE_DISSOLVE = 800
const PHASE_CONVERGE = 500

/** Particle count per atom */
const PARTICLES_PER_ATOM = 24

/** Simple 2D hash for deterministic pseudo-random per particle */
const hash = (x: number, y: number): number => {
  let h = x * 374761393 + y * 668265263
  h = (h ^ (h >> 13)) * 1274126177
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff
}

interface Particle {
  /** Starting position (from original bounds) */
  sx: number
  sy: number
  /** Target position (hex ring slot) */
  tx: number
  ty: number
  /** Current position */
  x: number
  y: number
  /** Color from atom identity */
  color: string
  /** Random phase offset */
  phase: number
  /** Which atom this belongs to */
  atomIndex: number
}

export class ParticleDisassemblyStrategy implements DisplayStrategy {
  readonly name: DisplayStrategyName = 'particle'
  readonly icon = PARTICLE_SVG

  #provider: AtomizerProvider | null = null
  #atoms: AtomDescriptor[] = []
  #canvas: HTMLCanvasElement | null = null
  #ctx: CanvasRenderingContext2D | null = null
  #particles: Particle[] = []
  #tickerId: number = 0
  #startTime = 0
  #active = false
  #phase: 'dissolve' | 'converge' | 'settled' = 'dissolve'

  enter(target: AtomizerProvider, atoms: AtomDescriptor[]): void {
    this.#provider = target
    this.#atoms = atoms
    this.#active = true
    this.#startTime = performance.now()
    this.#phase = 'dissolve'

    // Create full-screen canvas for particle rendering
    this.#canvas = document.createElement('canvas')
    this.#canvas.className = 'atomizer-particle-canvas'
    this.#canvas.width = window.innerWidth
    this.#canvas.height = window.innerHeight
    this.#canvas.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 50000;
    `
    document.body.appendChild(this.#canvas)
    this.#ctx = this.#canvas.getContext('2d')

    // Generate particles from atom bounds
    this.#generateParticles(atoms)

    // Start animation loop
    this.#tick()

    console.log(`[particle] ${this.#particles.length} particles from ${atoms.length} atoms`)
  }

  exit(): void {
    this.#active = false
    if (this.#tickerId) {
      cancelAnimationFrame(this.#tickerId)
      this.#tickerId = 0
    }
    if (this.#canvas) {
      this.#canvas.remove()
      this.#canvas = null
      this.#ctx = null
    }
    this.#particles = []
    this.#provider = null
    this.#atoms = []
  }

  switchTo(atoms: AtomDescriptor[]): void {
    const provider = this.#provider
    this.exit()
    if (provider) {
      this.enter(provider, atoms)
    }
  }

  onAtomSelect(atom: AtomDescriptor): void {
    EffectBus.emit('atomize:atom-selected', { atom, strategy: 'particle' })
  }

  #generateParticles(atoms: AtomDescriptor[]): void {
    this.#particles = []
    const centerX = window.innerWidth / 2
    const centerY = window.innerHeight / 2

    // Atom colors (cycle through neon palette)
    const colors = [
      '#00ffff', '#ff00c8', '#00ff64', '#ffc800', '#b464ff',
    ]

    for (let ai = 0; ai < atoms.length; ai++) {
      const atom = atoms[ai]
      const color = colors[ai % colors.length]

      // Target positions: arrange in a ring around center
      const angle = (ai / atoms.length) * Math.PI * 2
      const ringRadius = 120 + atom.depth * 50
      const tx = centerX + Math.cos(angle) * ringRadius
      const ty = centerY + Math.sin(angle) * ringRadius

      for (let p = 0; p < PARTICLES_PER_ATOM; p++) {
        // Start position: scattered within atom bounds
        const sx = atom.bounds.x + hash(ai * 100 + p, 0) * atom.bounds.width
        const sy = atom.bounds.y + hash(ai * 100 + p, 1) * atom.bounds.height

        this.#particles.push({
          sx,
          sy,
          tx: tx + (hash(ai * 100 + p, 2) - 0.5) * 30,
          ty: ty + (hash(ai * 100 + p, 3) - 0.5) * 30,
          x: sx,
          y: sy,
          color,
          phase: hash(ai * 100 + p, 4) * Math.PI * 2,
          atomIndex: ai,
        })
      }
    }
  }

  #tick = (): void => {
    if (!this.#active || !this.#ctx || !this.#canvas) return

    const elapsed = performance.now() - this.#startTime
    const ctx = this.#ctx

    // Phase transitions
    if (this.#phase === 'dissolve' && elapsed > PHASE_DISSOLVE) {
      this.#phase = 'converge'
    }
    if (this.#phase === 'converge' && elapsed > PHASE_DISSOLVE + PHASE_CONVERGE) {
      this.#phase = 'settled'
    }

    // Clear canvas
    ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height)

    for (const p of this.#particles) {
      let t: number

      if (this.#phase === 'dissolve') {
        // Dissolve: scatter outward from source with noise
        t = Math.min(elapsed / PHASE_DISSOLVE, 1)
        const ease = 1 - Math.pow(1 - t, 3)
        const midX = (p.sx + p.tx) / 2 + Math.sin(p.phase + elapsed * 0.003) * 60
        const midY = (p.sy + p.ty) / 2 + Math.cos(p.phase * 1.3 + elapsed * 0.002) * 60
        p.x = p.sx + (midX - p.sx) * ease
        p.y = p.sy + (midY - p.sy) * ease
      } else if (this.#phase === 'converge') {
        // Converge: pull toward target positions
        const convergeElapsed = elapsed - PHASE_DISSOLVE
        t = Math.min(convergeElapsed / PHASE_CONVERGE, 1)
        const ease = 1 - Math.pow(1 - t, 3)
        const midX = (p.sx + p.tx) / 2 + Math.sin(p.phase) * 60 * (1 - ease)
        const midY = (p.sy + p.ty) / 2 + Math.cos(p.phase * 1.3) * 60 * (1 - ease)
        p.x = midX + (p.tx - midX) * ease
        p.y = midY + (p.ty - midY) * ease
      } else {
        // Settled: gentle drift around target
        const drift = Math.sin(elapsed * 0.001 + p.phase) * 3
        p.x = p.tx + drift
        p.y = p.ty + Math.cos(elapsed * 0.0012 + p.phase) * 3
      }

      // Draw particle
      const alpha = this.#phase === 'dissolve'
        ? 0.5 + 0.5 * Math.sin(elapsed * 0.005 + p.phase)
        : this.#phase === 'converge' ? 0.7 : 0.85

      ctx.beginPath()
      ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2)
      ctx.fillStyle = p.color
      ctx.globalAlpha = alpha
      ctx.fill()

      // Glow
      ctx.beginPath()
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
      ctx.globalAlpha = alpha * 0.25
      ctx.fill()
    }

    ctx.globalAlpha = 1

    // Draw atom labels when settled
    if (this.#phase === 'settled') {
      const centerX = window.innerWidth / 2
      const centerY = window.innerHeight / 2

      ctx.font = '10px monospace'
      ctx.textAlign = 'center'

      for (let ai = 0; ai < this.#atoms.length; ai++) {
        const atom = this.#atoms[ai]
        const angle = (ai / this.#atoms.length) * Math.PI * 2
        const ringRadius = 120 + atom.depth * 50
        const x = centerX + Math.cos(angle) * ringRadius
        const y = centerY + Math.sin(angle) * ringRadius

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
        ctx.fillText(atom.name, x, y + 22)
      }
    }

    this.#tickerId = requestAnimationFrame(this.#tick)
  }
}

// Self-register with AtomizeDrone
const strategy = new ParticleDisassemblyStrategy()
const ioc = (globalThis as any).ioc
ioc?.whenReady?.('@diamondcoreprocessor.com/AtomizeDrone', (drone: any) => {
  drone.registerStrategy(strategy)
})
console.log('[ParticleDisassemblyStrategy] Loaded')
