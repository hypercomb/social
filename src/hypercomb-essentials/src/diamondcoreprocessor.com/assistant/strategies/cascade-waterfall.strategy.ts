// diamondcoreprocessor.com/assistant/strategies/cascade-waterfall.strategy.ts
//
// "Cascade Waterfall" — A side panel slides in showing each atom as a card
// in a vertical stack. Each card is a mini-preview with editable style knobs.
// Follows the established mode pattern (browsing → clipboard → atomize).

import { EffectBus } from '@hypercomb/core'
import type {
  DisplayStrategy,
  DisplayStrategyName,
  AtomizerProvider,
  AtomDescriptor,
} from '@hypercomb/core'

const CASCADE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="6" rx="1"/><rect x="4" y="10" width="16" height="6" rx="1"/><rect x="4" y="18" width="16" height="4" rx="1"/></svg>'

/** Stagger delay per card entry animation (ms) */
const CARD_STAGGER_MS = 80

/** Card slide-in duration (ms) */
const SLIDE_DURATION_MS = 300

export class CascadeWaterfallStrategy implements DisplayStrategy {
  readonly name: DisplayStrategyName = 'cascade'
  readonly icon = CASCADE_SVG

  #provider: AtomizerProvider | null = null
  #atoms: AtomDescriptor[] = []
  #panelContainer: HTMLDivElement | null = null
  #animationFrames: number[] = []

  enter(target: AtomizerProvider, atoms: AtomDescriptor[]): void {
    this.#provider = target
    this.#atoms = atoms

    // Create side panel
    this.#panelContainer = document.createElement('div')
    this.#panelContainer.className = 'atomizer-cascade-panel'
    this.#panelContainer.style.cssText = `
      position: fixed;
      right: 0;
      top: 0;
      bottom: 0;
      width: 280px;
      background: rgba(10, 10, 18, 0.95);
      border-left: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(12px);
      overflow-y: auto;
      overflow-x: hidden;
      z-index: 50000;
      padding: 12px;
      transform: translateX(280px);
      transition: transform ${SLIDE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
    `
    document.body.appendChild(this.#panelContainer)

    // Panel header
    const header = document.createElement('div')
    header.style.cssText = `
      font-size: 11px;
      font-family: monospace;
      color: rgba(255, 255, 255, 0.5);
      padding: 4px 0 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      margin-bottom: 8px;
    `
    header.textContent = `${atoms.length} atoms`
    this.#panelContainer.appendChild(header)

    // Slide panel in
    requestAnimationFrame(() => {
      if (this.#panelContainer) {
        this.#panelContainer.style.transform = 'translateX(0)'
      }
    })

    // Create staggered atom cards
    this.#renderCards(atoms)

    console.log(`[cascade] Panel with ${atoms.length} atom cards`)
  }

  exit(): void {
    for (const frame of this.#animationFrames) {
      window.clearTimeout(frame)
    }
    this.#animationFrames = []

    if (this.#panelContainer) {
      this.#panelContainer.style.transform = 'translateX(280px)'
      // Remove after slide-out animation
      const panel = this.#panelContainer
      window.setTimeout(() => panel.remove(), SLIDE_DURATION_MS)
      this.#panelContainer = null
    }

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
    EffectBus.emit('atomize:atom-selected', { atom, strategy: 'cascade' })
  }

  #renderCards(atoms: AtomDescriptor[], indent = 0): void {
    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i]
      const delay = i * CARD_STAGGER_MS

      const frame = window.setTimeout(() => {
        this.#createCard(atom, indent)
      }, delay + SLIDE_DURATION_MS)

      this.#animationFrames.push(frame)

      // Recurse into children
      if (atom.children?.length) {
        this.#renderCards(atom.children, indent + 1)
      }
    }
  }

  #createCard(atom: AtomDescriptor, indent: number): void {
    if (!this.#panelContainer) return

    const card = document.createElement('div')
    card.className = 'atomizer-cascade-card'
    card.style.cssText = `
      margin: 4px 0 4px ${indent * 12}px;
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      cursor: pointer;
      opacity: 0;
      transform: translateX(20px);
      transition: opacity 0.2s ease, transform 0.2s ease, background 0.15s ease;
    `

    // Atom name
    const name = document.createElement('div')
    name.style.cssText = `
      font-size: 11px;
      font-family: monospace;
      color: rgba(255, 255, 255, 0.85);
      margin-bottom: 2px;
    `
    name.textContent = atom.name
    card.appendChild(name)

    // Atom type + depth
    const meta = document.createElement('div')
    meta.style.cssText = `
      font-size: 9px;
      font-family: monospace;
      color: rgba(255, 255, 255, 0.35);
    `
    meta.textContent = `${atom.type} · depth ${atom.depth}`
    card.appendChild(meta)

    // Style properties preview
    const styleKeys = Object.keys(atom.styles)
    if (styleKeys.length > 0) {
      const stylePreview = document.createElement('div')
      stylePreview.style.cssText = `
        margin-top: 6px;
        font-size: 9px;
        font-family: monospace;
        color: rgba(0, 255, 200, 0.5);
        max-height: 48px;
        overflow: hidden;
      `
      stylePreview.textContent = styleKeys.slice(0, 3).map(k => `${k}: ${atom.styles[k]}`).join('\n')
      card.appendChild(stylePreview)
    }

    // Hover + click
    card.addEventListener('mouseenter', () => {
      card.style.background = 'rgba(255, 255, 255, 0.06)'
      EffectBus.emit('atomize:atom-hover', { atom, strategy: 'cascade' })
    })
    card.addEventListener('mouseleave', () => {
      card.style.background = 'rgba(255, 255, 255, 0.03)'
    })
    card.addEventListener('click', () => this.onAtomSelect(atom))

    this.#panelContainer.appendChild(card)

    // Animate in
    requestAnimationFrame(() => {
      card.style.opacity = '1'
      card.style.transform = 'translateX(0)'
    })
  }
}

// Self-register with AtomizeDrone
const strategy = new CascadeWaterfallStrategy()
const ioc = (globalThis as any).ioc
ioc?.whenReady?.('@diamondcoreprocessor.com/AtomizeDrone', (drone: any) => {
  drone.registerStrategy(strategy)
})
console.log('[CascadeWaterfallStrategy] Loaded')
