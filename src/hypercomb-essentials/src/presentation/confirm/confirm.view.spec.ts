// confirm.view.spec.ts — the question before a delete, rendered on the base
// layer. One question at a time; every way of closing it answers the asker.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: () => { /* noop */ },
  }
})

const { EffectBus, requestConfirm, toolWindows } = await import('@hypercomb/core')
const { ConfirmElement, CONFIRM_REQUEST, CONFIRM_RESPONSE, CONFIRM_SURFACE, say } = await import('./confirm.view.js')

if (!customElements.get(CONFIRM_SURFACE)) customElements.define(CONFIRM_SURFACE, ConfirmElement)

let element: InstanceType<typeof ConfirmElement>
const answers: Array<{ id: string; confirmed: boolean }> = []
let offAnswers: () => void = () => {}

const text = (selector: string): string => element.querySelector(selector)?.textContent?.trim() ?? ''
const click = (selector: string): void => element.querySelector<HTMLButtonElement>(selector)!.click()

beforeEach(() => {
  EffectBus.clear()
  answers.length = 0
  offAnswers = EffectBus.on<{ id: string; confirmed: boolean }>(CONFIRM_RESPONSE, answer => { answers.push(answer) })
  element = document.createElement(CONFIRM_SURFACE) as InstanceType<typeof ConfirmElement>
  document.body.appendChild(element)
})

afterEach(() => {
  offAnswers()
  element.remove()
})

describe('the confirm dialog', () => {
  it('shows the question with its words, and the act answers yes', async () => {
    const asked = requestConfirm({ title: 'confirm.delete-title', message: 'confirm.delete-message', messageParams: { name: 'garden' }, danger: true })
    expect(element.open$).toBe(true)
    expect(text('.hc-tw-title')).toBe('Confirm Delete')
    expect(text('.hc-confirm-message')).toBe('Are you sure you want to delete "garden"?')
    expect(element.querySelector('.hc-confirm-warning')).toBeNull()
    expect(text('.hc-confirm-act')).toBe('Delete')
    expect(element.querySelector('.hc-confirm-act')!.classList.contains('is-danger')).toBe(true)
    expect(element.querySelector('.hc-tw')!.getAttribute('role')).toBe('alertdialog')
    expect(document.activeElement).toBe(element.querySelector('.hc-confirm-cancel'))
    click('.hc-confirm-act')
    await expect(asked).resolves.toBe(true)
    expect(element.open$).toBe(false)
    expect(element.querySelector('.hc-confirm-backdrop')).toBeNull()
  })

  it('says the warning, and the plural forms on count, when no catalog is here', () => {
    EffectBus.emit(CONFIRM_REQUEST, { id: 'q1', title: 'confirm.delete-title', message: 'confirm.remove-message', messageParams: { name: 'garden', count: 1 },
      warning: 'confirm.remove-children', warningParams: { count: 3 } })
    expect(text('.hc-confirm-message')).toBe('Delete "garden" and the tiles nested inside it?')
    expect(text('.hc-confirm-warning')).toBe('Plus 3 tiles nested beneath — explore removed tiles any time in history.')
    expect(say('confirm.remove-message', { name: 'x', count: 2 })).toBe('Delete 2 selected tiles and the tiles nested inside them?')
    // Words a bee already translated for its domain pass through as they are.
    expect(say('Keep it')).toBe('Keep it')
    click('.hc-confirm-cancel')
    expect(answers).toEqual([{ id: 'q1', confirmed: false }])
  })

  it('the cancel, the ×, the backdrop and the escape policy all answer no — never nothing', () => {
    const ways: Array<[string, () => void]> = [
      ['the cancel', () => click('.hc-confirm-cancel')],
      ['the ×', () => click('.hc-tw-close')],
      ['the backdrop', () => element.querySelector<HTMLElement>('.hc-confirm-backdrop')!.click()],
      ['escape inside', () => { expect(toolWindows.dismissFocused()).toBe(true) }],
      ['the sweep', () => { expect(toolWindows.putAwayAll()).not.toBeNull() }],
    ]
    ways.forEach(([way, close], i) => {
      EffectBus.emit(CONFIRM_REQUEST, { id: `q${i}`, title: 't', message: 'm', danger: false })
      expect(element.open$, way).toBe(true)
      expect(element.querySelector('.hc-confirm-act')!.classList.contains('is-danger'), way).toBe(false)
      close()
      expect(answers.at(-1), way).toEqual({ id: `q${i}`, confirmed: false })
      expect(element.open$, way).toBe(false)
    })
  })

  it('asks one question at a time; the rest wait their turn, and a question asked twice is asked once', () => {
    EffectBus.emit(CONFIRM_REQUEST, { id: 'a', title: 'first', message: 'm' })
    EffectBus.emit(CONFIRM_REQUEST, { id: 'b', title: 'second', message: 'm' })
    EffectBus.emit(CONFIRM_REQUEST, { id: 'a', title: 'first', message: 'm' })
    expect(text('.hc-tw-title')).toBe('first')
    click('.hc-confirm-act')
    expect(answers).toEqual([{ id: 'a', confirmed: true }])
    expect(element.open$).toBe(true)
    expect(text('.hc-tw-title')).toBe('second')
    click('.hc-confirm-cancel')
    expect(answers).toEqual([{ id: 'a', confirmed: true }, { id: 'b', confirmed: false }])
    expect(element.open$).toBe(false)
    // Answered once: the bus's replay of a settled question asks nothing.
    element.ask({ id: 'a', title: 'first', message: 'm' })
    expect(element.open$).toBe(false)
  })

  it('answers every open question no when it leaves the page', () => {
    EffectBus.emit(CONFIRM_REQUEST, { id: 'x', title: 't', message: 'm' })
    EffectBus.emit(CONFIRM_REQUEST, { id: 'y', title: 't', message: 'm' })
    element.remove()
    expect(answers).toEqual([{ id: 'x', confirmed: false }, { id: 'y', confirmed: false }])
  })
})
