import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'
import './edit-actions.element'

describe('hc-edit-actions', () => {
  beforeEach(() => {
    EffectBus.clear()
    localStorage.clear()
    document.body.replaceChildren()
  })

  afterEach(() => document.body.replaceChildren())

  const mount = (): HTMLElement => {
    const element = document.createElement('hc-edit-actions')
    document.body.appendChild(element)
    return element
  }

  const buttonFor = (element: HTMLElement, glyph: string): HTMLButtonElement | null =>
    [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.querySelector('.mat-sym')?.textContent === glyph) ?? null

  it('renders history state and reuses the keyboard command path', () => {
    const commands: string[] = []
    EffectBus.on<{ cmd?: string }>('keymap:invoke', ({ cmd }) => { if (cmd) commands.push(cmd) })
    const element = mount()
    expect(buttonFor(element, 'undo')?.disabled).toBe(true)
    expect(buttonFor(element, 'redo')).toBeNull()

    EffectBus.emit('history:cursor-changed', { position: 2, total: 4, rewound: true })
    expect(buttonFor(element, 'undo')?.disabled).toBe(false)
    expect(buttonFor(element, 'redo')).not.toBeNull()
    expect(element.querySelector('.ea-save')?.textContent).toBe('save')
    buttonFor(element, 'undo')!.click()
    buttonFor(element, 'redo')!.click()
    expect(commands).toEqual(['history.undo', 'history.redo'])
  })

  it('shows selection verbs only at head and emits their shared actions', () => {
    const actions: string[] = []
    EffectBus.on<{ action?: string }>('controls:action', ({ action }) => { if (action) actions.push(action) })
    const element = mount()
    EffectBus.emit('history:cursor-changed', { position: 3, total: 3 })
    EffectBus.emit('selection:changed', { selected: ['a', 'b'] })

    buttonFor(element, 'content_cut')!.click()
    buttonFor(element, 'content_copy')!.click()
    buttonFor(element, 'delete')!.click()
    expect(actions).toEqual(['cut', 'copy', 'remove'])

    EffectBus.emit('history:cursor-changed', { position: 2, total: 3 })
    expect(buttonFor(element, 'content_cut')).toBeNull()
    expect(element.querySelector('.ea-save')).not.toBeNull()
  })

  it('tracks orientation, feedback and full-view visibility from effects', () => {
    const element = mount()
    const feedback = buttonFor(element, 'forum')!
    expect(feedback.getAttribute('aria-pressed')).toBe('false')
    EffectBus.emit('feedback:panel-state', { open: true })
    expect(buttonFor(element, 'forum')?.getAttribute('aria-pressed')).toBe('true')

    EffectBus.emit('render:set-orientation', { flat: true })
    expect(buttonFor(element, 'crop_rotate')?.getAttribute('aria-label')).toContain('point')
    EffectBus.emit('view:active', { active: true })
    expect(element.querySelector<HTMLElement>('.edit-actions')?.style.display).toBe('none')
  })
})
