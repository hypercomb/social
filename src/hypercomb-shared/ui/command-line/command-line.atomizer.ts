// hypercomb-shared/ui/command-line/command-line.atomizer.ts
//
// AtomizerProvider for the command line component. Discovers constituent
// atoms by inspecting the live DOM structure of the command shell.

import type { AtomizerProvider, AtomDescriptor } from '@hypercomb/core'
import { ATOMIZER_IOC_PREFIX } from '@hypercomb/core'

const get = (key: string) => (globalThis as any).ioc?.get(key)

export class CommandLineAtomizer implements AtomizerProvider {
  readonly atomizerId = 'command-line'

  /** Map of atom name → original inline style (for restore on reassemble) */
  #originalStyles = new Map<string, string>()

  discover(): AtomDescriptor[] {
    const atoms: AtomDescriptor[] = []
    const shell = document.querySelector('.command-bar')
    if (!shell) return atoms

    const shellRect = shell.getBoundingClientRect()

    // Root container
    atoms.push(this.#atom('command-bar', 'container', 0, shell))

    // Command shell wrapper
    const commandShell = shell.querySelector('.command-shell')
    if (commandShell) {
      atoms.push(this.#atom('command-shell', 'container', 1, commandShell))
    }

    // Input wrap
    const inputWrap = shell.querySelector('.input-wrap')
    if (inputWrap) {
      atoms.push(this.#atom('input-wrap', 'container', 2, inputWrap))
    }

    // Ghost text overlay
    const ghost = shell.querySelector('.ghost')
    if (ghost) {
      atoms.push(this.#atom('ghost-text', 'decorator', 3, ghost))
    }

    // The actual input element
    const input = shell.querySelector('.command-input')
    if (input) {
      atoms.push(this.#atom('command-input', 'control', 3, input))
    }

    // Suggestion dropdown
    const results = shell.querySelector('.command-results')
    if (results) {
      atoms.push(this.#atom('suggestion-dropdown', 'container', 2, results))

      // Individual suggestion items
      const items = results.querySelectorAll('li')
      items.forEach((li, i) => {
        atoms.push(this.#atom(`suggestion-${i}`, 'control', 3, li))
      })
    }

    // Mic button (if present)
    const mic = shell.querySelector('.mic-btn, .voice-btn')
    if (mic) {
      atoms.push(this.#atom('microphone-button', 'icon', 2, mic))
    }

    return atoms
  }

  applyStyle(atomName: string, styles: Record<string, string>): void {
    const element = this.#findElement(atomName)
    if (!element) return

    // Store original style for reassembly
    if (!this.#originalStyles.has(atomName)) {
      this.#originalStyles.set(atomName, (element as HTMLElement).style.cssText)
    }

    for (const [prop, value] of Object.entries(styles)) {
      ;(element as HTMLElement).style.setProperty(prop, value)
    }
  }

  reassemble(): void {
    for (const [atomName, originalStyle] of this.#originalStyles) {
      const element = this.#findElement(atomName)
      if (element) {
        ;(element as HTMLElement).style.cssText = originalStyle
      }
    }
    this.#originalStyles.clear()
  }

  #atom(name: string, type: AtomDescriptor['type'], depth: number, element: Element): AtomDescriptor {
    const bounds = element.getBoundingClientRect()
    const computed = window.getComputedStyle(element)

    const styles: Record<string, string> = {}
    const interestingProps = [
      'background', 'background-color', 'color', 'border', 'border-radius',
      'padding', 'margin', 'font-size', 'font-family', 'opacity',
      'box-shadow', 'backdrop-filter', 'gap',
    ]
    for (const prop of interestingProps) {
      const val = computed.getPropertyValue(prop)
      if (val && val !== 'none' && val !== 'normal' && val !== '0px') {
        styles[prop] = val
      }
    }

    return { name, type, depth, styles, bounds }
  }

  #findElement(atomName: string): Element | null {
    const selectorMap: Record<string, string> = {
      'command-bar': '.command-bar',
      'command-shell': '.command-shell',
      'input-wrap': '.input-wrap',
      'ghost-text': '.ghost',
      'command-input': '.command-input',
      'suggestion-dropdown': '.command-results',
      'microphone-button': '.mic-btn, .voice-btn',
    }

    // Handle suggestion-N pattern
    if (atomName.startsWith('suggestion-')) {
      const index = parseInt(atomName.split('-')[1], 10)
      const items = document.querySelectorAll('.command-results li')
      return items[index] ?? null
    }

    const selector = selectorMap[atomName]
    return selector ? document.querySelector(selector) : null
  }
}

// Self-register in IoC
const _commandLineAtomizer = new CommandLineAtomizer()
;(globalThis as any).ioc?.register(
  `${ATOMIZER_IOC_PREFIX}command-line`,
  _commandLineAtomizer,
)
