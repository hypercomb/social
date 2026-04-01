// diamondcoreprocessor.com/assistant/input.atomizer.ts
//
// Input Atomizer — targets input controls. When dropped on an input element,
// exposes its configurable properties: placeholder, font, colors, borders,
// spacing, autocomplete behavior, etc. Community-sharable module.

import { EffectBus } from '@hypercomb/core'
import type { Atomizer, AtomizableTarget, AtomizerProperty } from '@hypercomb/core'
import { ATOMIZER_IOC_PREFIX } from '@hypercomb/core'

const INPUT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="10" x2="6" y2="14"/></svg>'

export class InputAtomizer implements Atomizer {
  readonly atomizerId = 'input-atomizer'
  readonly name = 'Input'
  readonly description = 'Break apart input controls — font, color, border, spacing, placeholder'
  readonly icon = INPUT_ICON
  readonly targetTypes = ['input', 'textarea'] as const

  discover(target: AtomizableTarget): AtomizerProperty[] {
    const el = target.element as HTMLInputElement | HTMLTextAreaElement
    const computed = window.getComputedStyle(el)

    const properties: AtomizerProperty[] = [
      // ── typography ──
      {
        key: 'font-size',
        label: 'font size',
        type: 'range',
        value: parseFloat(computed.fontSize) || 14,
        defaultValue: 14,
        min: 8,
        max: 48,
        step: 1,
        group: 'typography',
      },
      {
        key: 'font-family',
        label: 'font',
        type: 'select',
        value: computed.fontFamily.split(',')[0].trim().replace(/"/g, ''),
        defaultValue: 'monospace',
        options: [
          { label: 'Monospace', value: 'monospace' },
          { label: 'Sans-serif', value: 'sans-serif' },
          { label: 'Serif', value: 'serif' },
          { label: 'System UI', value: 'system-ui' },
        ],
        group: 'typography',
      },
      {
        key: 'font-weight',
        label: 'weight',
        type: 'select',
        value: computed.fontWeight,
        defaultValue: '400',
        options: [
          { label: 'Light', value: '300' },
          { label: 'Normal', value: '400' },
          { label: 'Medium', value: '500' },
          { label: 'Bold', value: '700' },
        ],
        group: 'typography',
      },
      {
        key: 'letter-spacing',
        label: 'tracking',
        type: 'range',
        value: parseFloat(computed.letterSpacing) || 0,
        defaultValue: 0,
        min: -2,
        max: 8,
        step: 0.5,
        group: 'typography',
      },

      // ── color ──
      {
        key: 'color',
        label: 'text color',
        type: 'color',
        value: this.#rgbToHex(computed.color),
        defaultValue: '#ffffff',
        group: 'color',
      },
      {
        key: 'background-color',
        label: 'background',
        type: 'color',
        value: this.#rgbToHex(computed.backgroundColor),
        defaultValue: '#000000',
        group: 'color',
      },
      {
        key: 'opacity',
        label: 'opacity',
        type: 'range',
        value: parseFloat(computed.opacity) * 100,
        defaultValue: 100,
        min: 0,
        max: 100,
        step: 5,
        group: 'color',
      },

      // ── border ──
      {
        key: 'border-color',
        label: 'border color',
        type: 'color',
        value: this.#rgbToHex(computed.borderColor),
        defaultValue: '#333333',
        group: 'border',
      },
      {
        key: 'border-width',
        label: 'border width',
        type: 'range',
        value: parseFloat(computed.borderWidth) || 0,
        defaultValue: 1,
        min: 0,
        max: 8,
        step: 0.5,
        group: 'border',
      },
      {
        key: 'border-radius',
        label: 'radius',
        type: 'range',
        value: parseFloat(computed.borderRadius) || 0,
        defaultValue: 4,
        min: 0,
        max: 24,
        step: 1,
        group: 'border',
      },

      // ── spacing ──
      {
        key: 'padding',
        label: 'padding',
        type: 'spacing',
        value: computed.padding,
        defaultValue: '4px 8px',
        group: 'spacing',
      },
      {
        key: 'height',
        label: 'height',
        type: 'range',
        value: parseFloat(computed.height) || 32,
        defaultValue: 32,
        min: 16,
        max: 80,
        step: 2,
        group: 'spacing',
      },

      // ── content ──
      {
        key: 'placeholder',
        label: 'placeholder',
        type: 'text',
        value: el.placeholder || '',
        defaultValue: '',
        group: 'content',
      },
      {
        key: 'autocomplete',
        label: 'autocomplete',
        type: 'boolean',
        value: el.autocomplete !== 'off',
        defaultValue: false,
        group: 'content',
      },
      {
        key: 'spellcheck',
        label: 'spellcheck',
        type: 'boolean',
        value: el.spellcheck,
        defaultValue: false,
        group: 'content',
      },
    ]

    return properties
  }

  apply(target: AtomizableTarget, key: string, value: string | number | boolean): void {
    const el = target.element as HTMLInputElement | HTMLTextAreaElement

    // Handle non-CSS properties
    if (key === 'placeholder') {
      el.placeholder = String(value)
      return
    }
    if (key === 'autocomplete') {
      el.autocomplete = value ? 'on' : 'off'
      return
    }
    if (key === 'spellcheck') {
      el.spellcheck = Boolean(value)
      return
    }
    if (key === 'opacity') {
      el.style.opacity = String(Number(value) / 100)
      return
    }

    // CSS properties — add units where needed
    const numericWithPx = ['font-size', 'border-width', 'border-radius', 'height', 'letter-spacing']
    if (numericWithPx.includes(key) && typeof value === 'number') {
      el.style.setProperty(key, `${value}px`)
      return
    }

    el.style.setProperty(key, String(value))
  }

  reset(target: AtomizableTarget): void {
    const el = target.element as HTMLInputElement | HTMLTextAreaElement
    // Clear all inline style overrides
    el.removeAttribute('style')
  }

  // ── helpers ──

  #rgbToHex(rgb: string): string {
    const match = rgb.match(/\d+/g)
    if (!match || match.length < 3) return '#000000'
    const [r, g, b] = match.map(Number)
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
  }
}

// Self-register
const _inputAtomizer = new InputAtomizer()
window.ioc.register(`${ATOMIZER_IOC_PREFIX}input-atomizer`, _inputAtomizer)

// Announce registration so the toolbar picks it up
EffectBus.emit('atomizer:registered', { atomizer: _inputAtomizer })
console.log('[InputAtomizer] Loaded')
