// @vitest-environment jsdom
// typing-focus.spec.ts — a key pressed while a text field has focus is the
// field's. The case that broke: a field inside a shadow root, where the
// document's active element and an event's target are the host, not the field.

import { afterEach, describe, expect, it } from 'vitest'
import { deepActiveElement, isTyping } from './typing-focus'

afterEach(() => { document.body.innerHTML = '' })

const shadowField = (): { host: HTMLElement; field: HTMLInputElement } => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })
  const field = document.createElement('input')
  root.appendChild(field)
  return { host, field }
}

describe('isTyping', () => {
  it('is false with nothing focused', () => {
    expect(isTyping()).toBe(false)
  })

  it('sees a plain text field', () => {
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()
    expect(isTyping()).toBe(true)
  })

  it('sees a field inside a shadow root, where the active element is the host', () => {
    const { host, field } = shadowField()
    field.focus()
    expect(document.activeElement).toBe(host)
    expect(deepActiveElement()).toBe(field)
    expect(isTyping()).toBe(true)
  })

  it('reads the real origin of a key event retargeted to the host', () => {
    const { host, field } = shadowField()
    let typing: boolean | null = null
    let target: EventTarget | null = null
    const hear = (e: KeyboardEvent): void => { typing = isTyping(e); target = e.target }
    window.addEventListener('keydown', hear)
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true, composed: true }))
    window.removeEventListener('keydown', hear)
    expect(target).toBe(host)
    expect(typing).toBe(true)
  })

  it('does not count a checkbox, a button or a slider', () => {
    for (const type of ['checkbox', 'button', 'range']) {
      document.body.innerHTML = ''
      const el = document.createElement('input')
      el.type = type
      document.body.appendChild(el)
      el.focus()
      expect(isTyping(), type).toBe(false)
    }
  })

  it('counts a textarea, a select and an editable region', () => {
    const area = document.createElement('textarea')
    document.body.appendChild(area)
    area.focus()
    expect(isTyping()).toBe(true)
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    editable.tabIndex = 0
    document.body.appendChild(editable)
    editable.focus()
    expect(isTyping()).toBe(true)
  })
})
