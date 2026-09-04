// sharing/offers.spec.ts — the offers window places only on a press.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

import { EffectBus } from '@hypercomb/core'
import { OffersQueenBee } from './offers.queen.js'
import {
  OFFERS_OFFERED, OFFERS_OPEN, OffersElement, PANEL_EMPTY, groupOffers, offerLabel, type OffersIo,
} from './offers.view.js'
import type { PublishedOffer } from './published-pools.js'

const SIG = 'a'.repeat(64)
const offer = (origin: string, meaning: string, record: unknown, sig = SIG): PublishedOffer =>
  ({ origin, meaning, sig, record })

describe('/offers — the handle', () => {
  let emitted: { effect: string; payload: unknown }[] = []
  let spy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    emitted = []
    spy = vi.spyOn(EffectBus, 'emit').mockImplementation((effect: string, payload: unknown) => {
      emitted.push({ effect, payload })
    })
  })
  afterEach(() => { spy.mockRestore() })

  it('emits ONE open request and carries no host, no meaning, no confirmation', async () => {
    await new OffersQueenBee().invoke('example.com llm:providers')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.effect).toBe(OFFERS_OPEN)
    expect(Object.keys(emitted[0]?.payload as object)).toEqual(['at'])
  })

  it('carries NO machine grammar and NO alias', () => {
    const queen = new OffersQueenBee()
    expect(queen.machine).toBeUndefined()
    expect(queen.aliases).toEqual([])
    expect(queen.slashComplete('ex')).toEqual([])
  })

  it('the queen module never imports the placing door', () => {
    const src = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing', 'offers.queen.ts'), 'utf8')
    const code = src.split(/\r?\n/).filter(line => !line.trimStart().startsWith('//')).join('\n')
    expect(code.includes('placeOffers')).toBe(false)
    expect(code.includes('published-pools')).toBe(false)
  })
})

describe('the words', () => {
  it('labels a record by its own id or name, else by its signature — never the whole record', () => {
    expect(offerLabel(offer('h', 'm', { id: 'claude-cli' }))).toBe('claude-cli')
    expect(offerLabel(offer('h', 'm', { name: 'Upscale' }))).toBe('Upscale')
    expect(offerLabel(offer('h', 'm', { secret: 'x' }))).toBe('aaaaaaaa…')
    expect(offerLabel(offer('h', 'm', null))).toBe('aaaaaaaa…')
  })

  it('groups by host then meaning, sorted, so two reads draw the same window', () => {
    const groups = groupOffers([
      offer('b.example', 'x:one', { id: 1 }),
      offer('a.example', 'x:two', { id: 2 }),
      offer('a.example', 'x:one', { id: 3 }),
      offer('a.example', 'x:one', { id: 4 }),
    ])
    expect(groups.map(g => `${g.origin}::${g.meaning}=${g.offers.length}`))
      .toEqual(['a.example::x:one=2', 'a.example::x:two=1', 'b.example::x:one=1'])
  })
})

describe('the window', () => {
  const fakeIo = (offers: PublishedOffer[]) => {
    const log: string[] = []
    let held = [...offers]
    const io: OffersIo = {
      offered: () => held,
      place: async (origin, meaning) => {
        log.push(`place ${origin} ${meaning}`)
        const placed = held.filter(o => o.origin === origin && o.meaning === meaning)
        held = held.filter(o => !(o.origin === origin && o.meaning === meaning))
        return placed.map(o => String((o.record as { id: string }).id))
      },
      dismiss: (origin, meaning) => {
        log.push(`dismiss ${origin} ${meaning}`)
        held = held.filter(o => !(o.origin === origin && o.meaning === meaning))
      },
    }
    return { io, log }
  }

  const mount = (offers: PublishedOffer[]) => {
    if (!customElements.get('hc-offers-test')) customElements.define('hc-offers-test', OffersElement)
    const el = document.createElement('hc-offers-test') as OffersElement
    const fake = fakeIo(offers)
    el.io = fake.io
    document.body.appendChild(el)
    return { el, ...fake }
  }

  afterEach(() => { document.body.replaceChildren(); EffectBus.clear() })

  it('opening reads and draws, and places NOTHING', () => {
    const { el, log } = mount([offer('example.com', 'llm:providers', { id: 'claude-cli' })])
    el.open()
    expect(el.open$).toBe(true)
    expect(log).toEqual([])
    expect(el.textContent).toContain('example.com')
    expect(el.textContent).toContain('claude-cli')
    expect(el.querySelectorAll('button[data-verb="place"]')).toHaveLength(1)
  })

  it('an empty world says so, and offers no button', () => {
    const { el } = mount([])
    el.open()
    expect(el.textContent).toContain(PANEL_EMPTY)
    expect(el.querySelectorAll('button[data-verb]')).toHaveLength(0)
  })

  it('PLACE places exactly that host-and-meaning, and the row leaves the window', async () => {
    const { el, log } = mount([
      offer('example.com', 'llm:providers', { id: 'claude-cli' }),
      offer('other.example', 'llm:providers', { id: 'ollama' }, 'b'.repeat(64)),
    ])
    el.open()
    const kept = await el.act('place', 'example.com', 'llm:providers')
    expect(kept).toEqual(['claude-cli'])
    expect(log).toEqual(['place example.com llm:providers'])
    const rows = [...el.querySelectorAll('.hc-offers-row')].map(r => r.textContent)
    expect(rows).toEqual(['ollama'])
    expect(el.textContent).toContain('Placed 1')
  })

  it('NOT NOW drops without placing, and says the host will offer again', async () => {
    const { el, log } = mount([offer('example.com', 'llm:providers', { id: 'claude-cli' })])
    el.open()
    await el.act('dismiss', 'example.com', 'llm:providers')
    expect(log).toEqual(['dismiss example.com llm:providers'])
    expect(el.textContent).toContain('will offer it again')
    expect(el.textContent).not.toContain('claude-cli')
  })

  it('a new offer while closed raises ONE quiet notice per host-and-meaning, and never opens the window', () => {
    const { el } = mount([])
    const toasts: unknown[] = []
    EffectBus.on('toast:show', p => { toasts.push(p) })
    EffectBus.emit(OFFERS_OFFERED, { origin: 'example.com', meaning: 'llm:providers', count: 2 })
    EffectBus.emit(OFFERS_OFFERED, { origin: 'example.com', meaning: 'llm:providers', count: 2 })
    expect(toasts).toHaveLength(1)
    expect(el.open$).toBe(false)
  })

  it('a stale open request is ignored — a replayed last value is not a press', () => {
    const { el } = mount([])
    EffectBus.emit(OFFERS_OPEN, { at: Date.now() - 60_000 })
    expect(el.open$).toBe(false)
    EffectBus.emit(OFFERS_OPEN, { at: Date.now() })
    expect(el.open$).toBe(true)
  })
})
