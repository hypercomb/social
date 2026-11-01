// doctrine-window.view.spec.ts — the doctrine viewer, rendered. Any rule can be
// ticked or cleared in any combination; ground left out is flagged and never
// blocks; applying commits exactly the chosen set; the hive's own sections ride
// through untouched.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const doctrine = vi.hoisted(() => ({
  held: [] as string[],
  replaced: [] as string[][],
}))

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: () => { /* noop */ },
  }
})

const { EffectBus } = await import('@hypercomb/core')
const { ANATOMY_IOC_KEY } = await import('./anatomy/anatomy.service.js')
const { ANATOMY_SECTIONS } = await import('./anatomy/anatomy.generated.js')
const { DoctrineWindowView } = await import('./doctrine-window.view.js')

const MINE = '### My rule\n(source: hive)\n\nAlways say tiles.'

const install = (): void => {
  doctrine.held = [...ANATOMY_SECTIONS, MINE]
  doctrine.replaced = []
  const like = {
    doctrine: {
      ready: Promise.resolve(),
      texts: () => doctrine.held,
      replace: async (sections: readonly string[]) => {
        doctrine.replaced.push([...sections])
        doctrine.held = [...sections]
        return { ok: true as const, state: { sections, recordSig: '', marker: '', by: 'hive' as const, seedPending: false } }
      },
    },
  }
  ;(window as unknown as { ioc: { get: (key: string) => unknown } }).ioc.get = (key: string) => key === ANATOMY_IOC_KEY ? like : undefined
}

const panel = (): HTMLElement | null => document.querySelector('.hc-doctrine')
const tierHead = (title: string): HTMLElement =>
  [...document.querySelectorAll<HTMLElement>('.hc-doctrine-tierhead')].find(row => row.textContent?.startsWith(title))!
const word = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('.hc-doctrine-word')].find(button => button.textContent === label)!
const axiomRow = (id: string): HTMLLabelElement =>
  [...document.querySelectorAll<HTMLLabelElement>('.hc-doctrine-axiom')].find(row => row.querySelector('.hc-doctrine-id')?.textContent === id)!
const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await Promise.resolve() }

// One view for the file: the bus replays its last value to every new subscriber,
// so a view per test would open one panel per view.
const view = new DoctrineWindowView()

beforeEach(async () => {
  install()
  EffectBus.emit('doctrine:open', {})
  await flush()
})

afterEach(() => { view.close(); document.body.innerHTML = '' })

describe('the doctrine viewer', () => {
  it('opens on the doctrine the hive runs and counts it', () => {
    expect(panel()).not.toBeNull()
    expect(document.querySelector('.hc-doctrine-sum')?.textContent).toMatch(/\d+ of \d+ rules · about \d+ tokens/)
    expect(word('apply').disabled).toBe(true)
  })

  it('lists every tier, the builders\' too, and opens one at a time', async () => {
    expect(tierHead('Build')).toBeTruthy()
    tierHead('History').querySelector<HTMLButtonElement>('.hc-doctrine-tiername')!.click()
    expect(document.querySelectorAll('.hc-doctrine-axiom').length).toBeGreaterThan(3)
    tierHead('Pool').querySelector<HTMLButtonElement>('.hc-doctrine-tiername')!.click()
    expect(axiomRow('P1')).toBeTruthy()
    expect(document.querySelector('.hc-doctrine-axiom .hc-doctrine-id')?.textContent).toBe('P1')
  })

  it('lets one rule go without forcing the rest to follow, and flags what rested on it', () => {
    tierHead('History').querySelector<HTMLButtonElement>('.hc-doctrine-tiername')!.click()
    axiomRow('H1').querySelector('input')!.click()
    expect(word('apply').disabled).toBe(false)
    expect(document.querySelector('.hc-doctrine-warn')?.textContent).toMatch(/rest on rules you left out/)
    // H2 stays chosen: nothing was refused.
    expect(axiomRow('H2').querySelector('input')!.checked).toBe(true)
  })

  it('pulls ground back in on one word', () => {
    tierHead('History').querySelector<HTMLButtonElement>('.hc-doctrine-tiername')!.click()
    axiomRow('H1').querySelector('input')!.click()
    document.querySelector<HTMLButtonElement>('.hc-doctrine-warn')!.click()
    expect(document.querySelector('.hc-doctrine-warn')).toBeNull()
    expect(axiomRow('H1').querySelector('input')!.checked).toBe(true)
  })

  it('clears and sets a whole tier from its box', () => {
    const box = tierHead('Interest').querySelector<HTMLInputElement>('input')!
    box.click()
    expect(tierHead('Interest').querySelector<HTMLInputElement>('input')!.checked).toBe(false)
    expect(tierHead('Interest').textContent).toContain('0/3')
  })

  it('applies exactly the chosen set, keeping the hive\'s own section, and goes quiet', async () => {
    tierHead('Interest').querySelector<HTMLInputElement>('input')!.click()
    word('apply').click()
    await flush()
    expect(doctrine.replaced).toHaveLength(1)
    const sections = doctrine.replaced[0]!
    expect(sections.some(section => section.startsWith('### Interest'))).toBe(false)
    expect(sections.some(section => section.startsWith('### Identity'))).toBe(true)
    expect(sections.at(-1)).toBe(MINE)
    expect(word('apply').disabled).toBe(true)
  })

  it('chooses the builders\' tier too, and resets to the head', () => {
    word('all').click()
    expect(tierHead('Build').querySelector<HTMLInputElement>('input')!.checked).toBe(true)
    expect(word('reset').disabled).toBe(false)
    word('reset').click()
    expect(tierHead('Build').querySelector<HTMLInputElement>('input')!.checked).toBe(false)
    expect(word('apply').disabled).toBe(true)
  })

  it('closes on Escape', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(panel()).toBeNull()
  })
})
