// safety/brood.view.spec.ts
//
// The surface, rendered. A held row must READ as held — no clean audit and no
// community's vouch may dress it as approved — and pressing Accept must go
// through the same two warnings the word does, never straight to a ruling.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: () => { /* noop */ },
  }
})

const {
  EffectBus, acceptIntoHive, attachAudit, forgetInBrood, holdInBrood, setBroodRules, DEFAULT_BROOD_RULES,
} = await import('@hypercomb/core')
const { BroodElement, BROOD_SURFACE } = await import('./brood.view.js')

const sig = (c: string): string => c.repeat(64)

if (!customElements.get(BROOD_SURFACE)) customElements.define(BROOD_SURFACE, BroodElement)

const mount = async (): Promise<BroodElement> => {
  const element = document.createElement(BROOD_SURFACE) as BroodElement
  document.body.appendChild(element)
  element.open()
  await element.refresh()
  return element
}

const text = (element: HTMLElement): string => element.textContent ?? ''
const words = (element: HTMLElement): string[] =>
  [...element.querySelectorAll('.hc-brood-do')].map(word => (word.textContent ?? '').trim())

beforeEach(async () => {
  document.body.replaceChildren()
  await setBroodRules(DEFAULT_BROOD_RULES)
  for (const c of ['1', '2', '3', '4']) await forgetInBrood(sig(c))
})

describe('the brood surface', () => {
  it('says plainly when nothing is held', async () => {
    const element = await mount()
    expect(text(element)).toMatch(/nothing is held/i)
  })

  it('shows a held automaton, where it came from, and that it does not run', async () => {
    await holdInBrood(sig('1'), { zone: 'stranger.example', kind: 'stranger' }, 'stranger-bee')
    const element = await mount()
    expect(text(element)).toContain('stranger-bee')
    expect(text(element)).toContain('stranger.example')
    expect(text(element)).toMatch(/do not run|does not run|will not run/i)
    expect(words(element)).toEqual(['Read', 'Accept', 'Refuse'])
  })

  it('A CLEAN AUDIT DOES NOT DRESS THE ROW AS APPROVED', async () => {
    await holdInBrood(sig('2'), { zone: 'stranger.example', kind: 'stranger' }, 'clean-bee')
    await attachAudit(sig('2'), { by: 'jev', summary: 'Nothing untoward found.', recommends: 'accept' })
    const element = await mount()
    const row = element.querySelector('.hc-brood-row')!
    expect(text(element)).toContain('Nothing untoward found.')
    // The reading is shown; the standing is unchanged.
    expect(row.className).not.toContain('is-accepted')
    expect(text(element)).toMatch(/held\. it will not run/i)
    expect(words(element)).toContain('Accept')
  })

  it('pressing Accept asks the two warnings rather than ruling', async () => {
    await holdInBrood(sig('3'), { zone: 'stranger.example', kind: 'stranger' }, 'asked-bee')
    const element = await mount()
    const asked: string[] = []
    let live = false
    // EffectBus replays its last value synchronously on subscribe.
    const off = EffectBus.on<{ id: string; title: string }>('confirm:request', request => {
      if (!live) return
      asked.push(request.title)
      queueMicrotask(() => EffectBus.emit('confirm:response', { id: request.id, confirmed: false }))
    })
    live = true
    const accept = [...element.querySelectorAll('.hc-brood-do')]
      .find(word => (word.textContent ?? '').trim() === 'Accept') as HTMLButtonElement
    accept.click()
    await new Promise(resolve => setTimeout(resolve, 10))
    off()
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatch(/not trusted/i)
    await element.refresh()
    expect(text(element)).toMatch(/held\. it will not run/i)
  })

  it('only a ruling a person made reads as running', async () => {
    await holdInBrood(sig('4'), { zone: 'mine.example', kind: 'own' }, 'accepted-bee')
    await acceptIntoHive(sig('4'), ['not-safe', 'audit-is-not-approval'])
    const element = await mount()
    expect(element.querySelector('.hc-brood-row')!.className).toContain('is-accepted')
    expect(text(element)).toMatch(/you accepted this/i)
    expect(words(element)).not.toContain('Accept')
  })
})
