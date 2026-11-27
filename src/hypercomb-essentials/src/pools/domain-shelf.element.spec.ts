// @vitest-environment jsdom
// pools/domain-shelf.element.spec.ts : the node shelf as it is RENDERED and
// as it SPEAKS. The services it works through are stood in for through its
// seams, so every case reads what a person would see on the strip and what a
// reader of the bus would be told, never a private field.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, I18N_IOC_KEY } from '@hypercomb/core'
import {
  DOMAIN_SHELF_WANTED,
  LIGHTS_MODE,
  SOURCES_CHANGED,
  SOURCES_COUNTED,
  SOURCES_NODES,
  SOURCES_QUERY,
  type SourcesState,
} from './lights-contract.js'
import { poolNodeKey, type PoolNode } from './pool-node.js'
import { DOMAIN_SHELF_SURFACE, DomainShelfElement, defineDomainShelf } from './domain-shelf.element.js'

const MINE = 'mine.example'
const BAKERY = 'bakery.example'
const KITCHEN = 'my-kitchen.org'
const HOSTS = [MINE, BAKERY, KITCHEN]

const ANA: PoolNode = { kind: 'participant', id: 'e3'.repeat(32), name: 'Ana Maria Lopez' }
const BEN: PoolNode = { kind: 'participant', id: 'f4'.repeat(32), name: 'Ben Okri' }
const ME: PoolNode = { kind: 'participant', id: '9a'.repeat(32), name: 'Jaime', you: true }
const NAMELESS: PoolNode = { kind: 'participant', id: '3d6d3327'.repeat(8) }

/** Every microtask a read runs through, and one turn of the timers behind them. */
const settle = (): Promise<void> => new Promise(done => setTimeout(done, 0))
const frame = (): Promise<void> => new Promise(done => requestAnimationFrame(() => done()))
const wait = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms))

type Fixture = { all?: string[]; own?: string; off?: string[]; writes?: boolean }

/** A strip on the page with its services stood in for, and a record of what it said and kept. */
const mount = async (fixture: Fixture = {}) => {
  const world = { all: fixture.all ?? HOSTS, off: fixture.off ?? [] }
  const said: SourcesState[] = []
  const kept: string[][] = []
  const shelf = document.createElement(DOMAIN_SHELF_SURFACE) as DomainShelfElement
  shelf.seams = {
    followedZones: async () => world.all,
    ownZone: async () => fixture.own ?? MINE,
    readSourcesOff: async () => world.off,
    writeSourcesOff: async (off) => {
      kept.push([...off])
      if (fixture.writes === false) return false
      world.off = [...off]
      return true
    },
    say: (state) => { said.push(state) },
  }
  document.body.appendChild(shelf)
  await settle()
  return { shelf, said, kept, world }
}

/** A followed host as the node the shelf announces. */
const place = (zone: string): PoolNode => ({ kind: 'domain', id: zone, ...(zone === MINE ? { you: true } : {}) })

/** What the shelf says: the domains as they always were, and every node beside them. */
const drawn = (zones: string[], more: { all?: string[]; query?: string; people?: PoolNode[]; everyone?: PoolNode[] } = {}): SourcesState => {
  const all = more.all ?? HOSTS
  const people = more.people ?? []
  return {
    zones,
    all,
    query: more.query ?? '',
    nodes: [...zones.map(place), ...people],
    allNodes: [...all.map(place), ...(more.everyone ?? people)],
  }
}

const want = (owner: string, wanted = true): void => { EffectBus.emitTransient(DOMAIN_SHELF_WANTED, { owner, wanted }) }
const room = (nodes: readonly unknown[]): void => { EffectBus.emit(SOURCES_NODES, { nodes }) }
const strip = (shelf: DomainShelfElement): HTMLElement | null => shelf.shadowRoot?.querySelector<HTMLElement>('.strip') ?? null
const chips = (shelf: DomainShelfElement): HTMLButtonElement[] => [...(shelf.shadowRoot?.querySelectorAll<HTMLButtonElement>('.chip') ?? [])]
const names = (shelf: DomainShelfElement): string[] => chips(shelf).map(chip => chip.title)
const initials = (shelf: DomainShelfElement): string[] => chips(shelf).map(chip => chip.querySelector('.initials')?.textContent ?? '')
const pressed = (shelf: DomainShelfElement): boolean[] => chips(shelf).map(chip => chip.getAttribute('aria-pressed') === 'true')
const chipOf = (shelf: DomainShelfElement, name: string): HTMLButtonElement => chips(shelf).find(chip => chip.title === name)!
const count = (shelf: DomainShelfElement): string | null | undefined => shelf.shadowRoot?.querySelector('.count')?.textContent
const field = (shelf: DomainShelfElement): HTMLInputElement => shelf.shadowRoot!.querySelector<HTMLInputElement>('.query')!
const type = (shelf: DomainShelfElement, words: string): void => {
  field(shelf).value = words
  field(shelf).dispatchEvent(new Event('input', { bubbles: true }))
}

/** Every band the strip asked the canvas for, in order. */
const bands = (): number[] => {
  const sizes: number[] = []
  EffectBus.on<{ owner?: string; size?: number }>('viewport:inset', (p) => {
    if (p?.owner === 'domain-shelf') sizes.push(p.size ?? 0)
  })
  return sizes
}

beforeAll(() => { defineDomainShelf() })

beforeEach(() => {
  EffectBus.clear()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { ioc?: unknown }).ioc
})

describe('the strip is in view only while somebody wants it', () => {
  it('shows nothing and holds no band with no owner', async () => {
    const sizes = bands()
    const { shelf } = await mount()
    await frame()
    expect(strip(shelf)).toBeNull()
    expect(shelf.shadowRoot?.childNodes.length).toBe(0)
    expect(sizes.at(-1)).toBe(0)
  })

  it('comes up for its first owner and leaves with its last', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    expect(strip(shelf)).not.toBeNull()
    want('recipe-picker')
    want('pools-mode', false)
    expect(strip(shelf)).not.toBeNull()
    want('recipe-picker', false)
    expect(strip(shelf)).toBeNull()
    expect(shelf.wanted).toBe(false)
  })

  it('is a toolbar with a label, and takes the wheel for its chips', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    const bar = strip(shelf)!
    expect(bar.getAttribute('role')).toBe('toolbar')
    expect(bar.getAttribute('aria-label')).toBe('Domains and people you draw pools from')
    expect(bar.hasAttribute('data-consumes-wheel')).toBe(true)
    const wheel = new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true })
    bar.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
  })

  it('an owner with no name is nobody', async () => {
    const { shelf } = await mount()
    EffectBus.emitTransient(DOMAIN_SHELF_WANTED, { wanted: true })
    expect(strip(shelf)).toBeNull()
  })
})

describe('pools mode, read from its last value', () => {
  it('shows the strip though pools mode was entered before the strip mounted', async () => {
    EffectBus.emit(LIGHTS_MODE, { active: true })
    const { shelf } = await mount()
    expect(strip(shelf)).not.toBeNull()
    expect(shelf.wanted).toBe(true)
  })

  it('comes up when pools mode turns on and leaves when it turns off', async () => {
    const { shelf } = await mount()
    expect(strip(shelf)).toBeNull()
    EffectBus.emit(LIGHTS_MODE, { active: true })
    expect(strip(shelf)).not.toBeNull()
    EffectBus.emit(LIGHTS_MODE, { active: false })
    expect(strip(shelf)).toBeNull()
  })

  it('is the same owner the pools mode drone asks as, so neither holds the strip after the other let go', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    EffectBus.emit(LIGHTS_MODE, { active: true })
    EffectBus.emit(LIGHTS_MODE, { active: false })
    expect(strip(shelf)).toBeNull()
  })

  it('leaves another owner its strip when pools mode goes', async () => {
    const { shelf } = await mount()
    EffectBus.emit(LIGHTS_MODE, { active: true })
    want('recipe-picker')
    EffectBus.emit(LIGHTS_MODE, { active: false })
    expect(strip(shelf)).not.toBeNull()
  })

  it('takes a value that says neither as no word at all', async () => {
    const { shelf } = await mount()
    EffectBus.emit(LIGHTS_MODE, { active: true })
    EffectBus.emit(LIGHTS_MODE, {})
    expect(strip(shelf)).not.toBeNull()
  })
})

describe('a chip', () => {
  it('shows two initials, and carries the whole domain on hover and to a screen reader', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    expect(initials(shelf)).toEqual(['MI', 'BA', 'MK'])
    expect(names(shelf)).toEqual([`${MINE} (you)`, BAKERY, KITCHEN])
    expect(chips(shelf).map(chip => chip.getAttribute('aria-label'))).toEqual([`${MINE} (you)`, BAKERY, KITCHEN])
    // Nothing else is written on a chip: the name is never spelled out beside the plate.
    expect(chips(shelf).map(chip => chip.textContent)).toEqual(['MI', 'BA', 'MK'])
  })

  it('shows a participant by the initials of their name, and says the full name', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    room([ANA, BEN])
    expect(initials(shelf).slice(3)).toEqual(['AL', 'BO'])
    expect(names(shelf).slice(3)).toEqual(['Ana Maria Lopez', 'Ben Okri'])
    expect(chipOf(shelf, 'Ana Maria Lopez').getAttribute('aria-label')).toBe('Ana Maria Lopez')
  })

  it('shows a participant with no name by the start of their key, and a short key on hover', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    room([NAMELESS])
    const chip = chips(shelf)[3]
    expect(chip.querySelector('.initials')?.textContent).toBe('3D')
    expect(chip.title).toBe('3d6d3327…')
    expect(chip.getAttribute('aria-label')).toBe('3d6d3327…')
  })

  it('is a square plate for a domain and a round one for a participant', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    room([ANA])
    expect(chips(shelf).map(chip => chip.classList.contains('person'))).toEqual([false, false, false, true])
    expect(chips(shelf).map(chip => chip.classList.contains('place'))).toEqual([true, true, true, false])
    const style = shelf.shadowRoot?.querySelector('style')?.textContent ?? ''
    expect(style).toMatch(/\.chip\.person\{border-radius:50%;\}/)
  })

  it('tells two people with the same initials apart by their names', async () => {
    const { shelf } = await mount({ all: [], own: '' })
    want('pools-mode')
    room([{ kind: 'participant', id: 'a1'.repeat(32), name: 'Jaime' }, { kind: 'participant', id: 'b2'.repeat(32), name: 'Jane Adams' }])
    expect(initials(shelf)).toEqual(['JA', 'JA'])
    expect(names(shelf)).toEqual(['Jaime', 'Jane Adams'])
  })

  it('puts a name or a zone on the page as text, never as markup', async () => {
    const hostile = '<img src=x onerror="window.hacked=1"><b>bold</b>'
    const { shelf } = await mount({ all: [hostile, BAKERY], own: '' })
    want('pools-mode')
    room([{ kind: 'participant', id: 'c5'.repeat(32), name: '<script>window.hacked=2</script><i>Mallory</i>' }])
    expect(names(shelf)).toEqual([hostile, BAKERY, '<script>window.hacked=2</script><i>Mallory</i>'])
    expect(shelf.shadowRoot?.querySelector('img, b, i, script')).toBeNull()
    expect(chips(shelf)[0].getAttribute('aria-label')).toBe(hostile)
    expect((window as { hacked?: number }).hacked).toBeUndefined()
  })
})

describe('the two groups', () => {
  it('are the domains alone while nobody is known in the room', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    const root = shelf.shadowRoot!
    expect(root.querySelectorAll('.group')).toHaveLength(1)
    expect(root.querySelector('.group.places')?.getAttribute('aria-label')).toBe('Domains')
    expect(root.querySelector('.divider')).toBeNull()
    expect(root.querySelector('.group.people')).toBeNull()
  })

  it('are the domains, a divider, then the participants', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    room([ANA, BEN])
    const row = [...shelf.shadowRoot!.querySelector('.chips')!.children]
    expect(row.map(part => part.className)).toEqual(['group places', 'divider', 'group people'])
    expect(row[1].getAttribute('role')).toBe('separator')
    expect(row[2].getAttribute('role')).toBe('group')
    expect(row[2].getAttribute('aria-label')).toBe('People in the room')
    expect([...row[0].querySelectorAll<HTMLElement>('.chip')].map(chip => chip.title)).toEqual([`${MINE} (you)`, BAKERY, KITCHEN])
    expect([...row[2].querySelectorAll<HTMLElement>('.chip')].map(chip => chip.title)).toEqual(['Ana Maria Lopez', 'Ben Okri'])
  })

  it('are the participants alone, with no divider, in a hive that follows no host', async () => {
    const { shelf } = await mount({ all: [], own: '' })
    want('pools-mode')
    room([ANA])
    const row = [...shelf.shadowRoot!.querySelector('.chips')!.children]
    expect(row.map(part => part.className)).toEqual(['group people'])
  })

  it('put your own node first in its group, and its hover says it is you', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    room([ANA, ME, BEN])
    expect(names(shelf)).toEqual([`${MINE} (you)`, BAKERY, KITCHEN, 'Jaime (you)', 'Ana Maria Lopez', 'Ben Okri'])
    expect(chips(shelf).map(chip => chip.classList.contains('you'))).toEqual([true, false, false, true, false, false])
  })

  it('count every node in the legend, which reads From', async () => {
    const { shelf } = await mount({ off: [BAKERY] })
    want('pools-mode')
    expect(shelf.shadowRoot?.querySelector('.word')?.textContent).toBe('From')
    expect(count(shelf)).toBe('2 of 3')
    room([ANA, BEN])
    expect(count(shelf)).toBe('4 of 5')
    chipOf(shelf, 'Ben Okri').click()
    expect(count(shelf)).toBe('3 of 5')
  })
})

describe('the room\'s participants', () => {
  it('get chips when a surface announces them, and lose them when it leaves', async () => {
    const { shelf, said } = await mount()
    want('pools-mode')
    expect(chips(shelf)).toHaveLength(3)
    room([ANA])
    expect(names(shelf)).toEqual([`${MINE} (you)`, BAKERY, KITCHEN, 'Ana Maria Lopez'])
    room([ANA, BEN])
    expect(names(shelf).slice(3)).toEqual(['Ana Maria Lopez', 'Ben Okri'])
    expect(said.at(-1)).toEqual(drawn(HOSTS, { people: [ANA, BEN] }))
    room([])
    expect(chips(shelf)).toHaveLength(3)
    expect(shelf.shadowRoot?.querySelector('.divider')).toBeNull()
    expect(said.at(-1)).toEqual(drawn(HOSTS))
  })

  it('are there for a strip that mounts after they were announced', async () => {
    room([ANA])
    const { shelf, said } = await mount()
    want('pools-mode')
    expect(names(shelf).at(-1)).toBe('Ana Maria Lopez')
    expect(said).toEqual([drawn(HOSTS, { people: [ANA] })])
  })

  it('are participants only, each once, and never something that is not a node', async () => {
    const { shelf, said } = await mount()
    want('pools-mode')
    room([
      { kind: 'domain', id: 'intruder.example' },
      { kind: 'participant', id: ANA.id },
      ANA,
      null,
      'ana',
      { kind: 'participant', id: '' },
      { kind: 'participant', id: 'has a space' },
      { kind: 'participant' },
    ])
    expect(names(shelf)).toEqual([`${MINE} (you)`, BAKERY, KITCHEN, 'Ana Maria Lopez'])
    expect(said.at(-1)?.allNodes).toEqual([...HOSTS.map(place), ANA])
    EffectBus.emit(SOURCES_NODES, { nodes: 'everybody' })
    expect(chips(shelf)).toHaveLength(3)
  })

  it('show forty-eight, then a press that shows the rest and is not a switch', async () => {
    const crowd: PoolNode[] = Array.from({ length: 53 }, (_, at) => ({
      kind: 'participant', id: at.toString(16).padStart(64, '0'), name: `Guest ${at}`,
    }))
    const { shelf, said } = await mount()
    want('pools-mode')
    room(crowd)
    expect(shelf.shadowRoot?.querySelectorAll('.chip.person')).toHaveLength(48)
    const more = shelf.shadowRoot!.querySelector<HTMLElement>('.more')!
    expect(more.textContent).toBe('+5')
    expect(more.title).toBe('And 5 more in the room, all drawn from')
    expect(more.tagName).toBe('BUTTON')
    expect(more.hasAttribute('aria-pressed')).toBe(false)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.parentElement?.classList.contains('people')).toBe(true)
    // The people past the last chip stay drawn from, shown or not.
    expect(said.at(-1)?.nodes).toHaveLength(3 + 53)
    expect(count(shelf)).toBe('56 of 56')
    more.click()
    expect(said.at(-1)?.nodes).toHaveLength(3 + 53)
    expect(shelf.shadowRoot?.querySelectorAll('.chip.person')).toHaveLength(53)
    const fewer = shelf.shadowRoot!.querySelector<HTMLElement>('.more')!
    expect(fewer.textContent).toBe('Fewer')
    expect(fewer.getAttribute('aria-expanded')).toBe('true')
    fewer.click()
    expect(shelf.shadowRoot?.querySelectorAll('.chip.person')).toHaveLength(48)
    expect(shelf.shadowRoot!.querySelector<HTMLElement>('.more')?.textContent).toBe('+5')
  })

  it('show no such chip for exactly forty-eight', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    room(Array.from({ length: 48 }, (_, at) => ({ kind: 'participant', id: at.toString(16).padStart(64, '0') })))
    expect(shelf.shadowRoot?.querySelectorAll('.chip.person')).toHaveLength(48)
    expect(shelf.shadowRoot?.querySelector('.more')).toBeNull()
  })
})

describe('switching', () => {
  it('shows every followed host on unless it was switched off', async () => {
    const { shelf } = await mount({ off: [BAKERY] })
    want('pools-mode')
    expect(pressed(shelf)).toEqual([true, false, true])
    expect(count(shelf)).toBe('2 of 3')
  })

  it('a press switches a domain, keeps the list and says what is drawn from now', async () => {
    const { shelf, said, kept } = await mount()
    want('pools-mode')
    expect(said).toEqual([drawn(HOSTS)])
    chips(shelf)[1].click()
    await settle()
    expect(pressed(shelf)).toEqual([true, false, true])
    expect(kept).toEqual([[BAKERY]])
    expect(said.at(-1)).toEqual(drawn([MINE, KITCHEN]))
    chips(shelf)[1].click()
    await settle()
    expect(pressed(shelf)).toEqual([true, true, true])
    expect(kept.at(-1)).toEqual([])
    expect(said.at(-1)).toEqual(drawn(HOSTS))
    expect(said).toHaveLength(3)
  })

  it('a press switches a participant for the session, and writes nothing to the store', async () => {
    const { shelf, said, kept } = await mount()
    want('pools-mode')
    room([ANA, BEN])
    chipOf(shelf, 'Ana Maria Lopez').click()
    await settle()
    expect(pressed(shelf)).toEqual([true, true, true, false, true])
    expect(kept).toEqual([])
    expect(said.at(-1)).toEqual(drawn(HOSTS, { people: [BEN], everyone: [ANA, BEN] }))
    chipOf(shelf, 'Ana Maria Lopez').click()
    await settle()
    expect(pressed(shelf)).toEqual([true, true, true, true, true])
    expect(kept).toEqual([])
    expect(said.at(-1)).toEqual(drawn(HOSTS, { people: [ANA, BEN] }))
  })

  it('keeps zones alone when a domain is switched while a participant is off', async () => {
    const { shelf, kept } = await mount()
    want('pools-mode')
    room([ANA])
    chipOf(shelf, 'Ana Maria Lopez').click()
    chipOf(shelf, KITCHEN).click()
    await settle()
    expect(kept).toEqual([[KITCHEN]])
    expect(pressed(shelf)).toEqual([true, true, false, false])
  })

  it('holds a participant off through the session: a new list of the room, a read of the hosts, the strip going and coming', async () => {
    const { shelf, said } = await mount()
    want('pools-mode')
    room([ANA, BEN])
    chipOf(shelf, 'Ben Okri').click()
    room([BEN, ANA, NAMELESS])
    expect(chipOf(shelf, 'Ben Okri').getAttribute('aria-pressed')).toBe('false')
    EffectBus.emit('hosts:render', { open: false })
    await settle()
    expect(chipOf(shelf, 'Ben Okri').getAttribute('aria-pressed')).toBe('false')
    want('pools-mode', false)
    want('pools-mode')
    expect(chipOf(shelf, 'Ben Okri').getAttribute('aria-pressed')).toBe('false')
    expect(said.at(-1)?.nodes?.map(poolNodeKey)).toEqual([...HOSTS.map(zone => `domain:${zone}`), `participant:${ANA.id}`, `participant:${NAMELESS.id}`])
  })

  it('a domain press that could not be kept still holds for the session', async () => {
    const { shelf, said } = await mount({ writes: false })
    want('pools-mode')
    chips(shelf)[2].click()
    await settle()
    EffectBus.emit('hosts:render', { open: false })
    await settle()
    expect(pressed(shelf)).toEqual([true, true, false])
    expect(said.at(-1)?.zones).toEqual([MINE, BAKERY])
  })

  it('follows the hosts window: a host followed later gets a chip', async () => {
    const { shelf, said, world } = await mount()
    want('pools-mode')
    world.all = [...HOSTS, 'c.example']
    EffectBus.emit('hosts:render', { open: true })
    await settle()
    expect(names(shelf)).toEqual([`${MINE} (you)`, BAKERY, KITCHEN, 'c.example'])
    expect(said.at(-1)?.all).toEqual([...HOSTS, 'c.example'])
  })
})

describe('the counts', () => {
  const badges = (shelf: DomainShelfElement): (string | null)[] => chips(shelf).map((chip) => {
    const badge = chip.querySelector<HTMLElement>('.badge')!
    return badge.hidden ? null : badge.textContent
  })

  it('say how many each host offers once somebody counted', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    expect(badges(shelf)).toEqual([null, null, null])
    EffectBus.emit(SOURCES_COUNTED, { meaning: 'recipe:template', counts: { [MINE]: 3, [KITCHEN]: 0 } })
    expect(badges(shelf)).toEqual(['3', null, '0'])
    expect(chips(shelf)[0].querySelector<HTMLElement>('.badge')?.title).toBe(`${MINE} offers 3`)
    expect(chips(shelf)[0].getAttribute('aria-description')).toBe(`${MINE} offers 3`)
    expect(chips(shelf)[1].hasAttribute('aria-description')).toBe(false)
    // The count never takes the place of the name.
    expect(chips(shelf)[0].title).toBe(`${MINE} (you)`)
  })

  it('say it for a participant too, counted by node key or by bare key', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    room([ANA, BEN])
    EffectBus.emit(SOURCES_COUNTED, { meaning: 'recipe:entry', counts: { [poolNodeKey(ANA)]: 2, [BEN.id]: 5 } })
    expect(badges(shelf)).toEqual([null, null, null, '2', '5'])
    expect(chipOf(shelf, 'Ana Maria Lopez').querySelector<HTMLElement>('.badge')?.title).toBe('Ana Maria Lopez offers 2')
  })
})

describe('the keyboard', () => {
  const press = (shelf: DomainShelfElement, key: string): void => {
    shelf.shadowRoot!.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }))
  }

  it('has one Tab stop, and the arrows move along the row', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    expect(chips(shelf).map(chip => chip.tabIndex)).toEqual([0, -1, -1])
    chips(shelf)[0].focus()
    press(shelf, 'ArrowRight')
    expect(shelf.shadowRoot?.activeElement).toBe(chips(shelf)[1])
    expect(chips(shelf).map(chip => chip.tabIndex)).toEqual([-1, 0, -1])
    press(shelf, 'End')
    expect(shelf.shadowRoot?.activeElement).toBe(chips(shelf)[2])
    press(shelf, 'ArrowRight')
    expect(shelf.shadowRoot?.activeElement).toBe(chips(shelf)[2])
    press(shelf, 'Home')
    expect(shelf.shadowRoot?.activeElement).toBe(chips(shelf)[0])
  })

  it('walks from the domains into the participants as one row', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    room([ANA, BEN])
    chips(shelf)[2].focus()
    press(shelf, 'ArrowRight')
    expect(shelf.shadowRoot?.activeElement).toBe(chipOf(shelf, 'Ana Maria Lopez'))
    press(shelf, 'End')
    expect(shelf.shadowRoot?.activeElement).toBe(chipOf(shelf, 'Ben Okri'))
    press(shelf, 'ArrowLeft')
    press(shelf, 'ArrowLeft')
    expect(shelf.shadowRoot?.activeElement).toBe(chips(shelf)[2])
    expect(chips(shelf).filter(chip => chip.tabIndex === 0)).toHaveLength(1)
  })

  /** Answer the one question the strip asks of a focused chip: did a key bring the focus here. */
  const focusByKey = (byKey: boolean): void => {
    const matches = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' ? byKey : matches.call(this, selector)
    })
  }

  it('says the name of the chip in hand under the strip, since a key brings no hover', async () => {
    focusByKey(true)
    const { shelf } = await mount()
    want('pools-mode')
    room([ANA])
    const tip = shelf.shadowRoot!.querySelector<HTMLElement>('.tip')!
    expect(tip.hidden).toBe(true)
    expect(tip.getAttribute('aria-hidden')).toBe('true')
    chips(shelf)[0].focus()
    expect(tip.hidden).toBe(false)
    expect(tip.textContent).toBe(`${MINE} (you)`)
    press(shelf, 'End')
    expect(tip.textContent).toBe('Ana Maria Lopez')
    ;(shelf.shadowRoot!.activeElement as HTMLElement).blur()
    expect(tip.hidden).toBe(true)
  })

  it('says nothing under a chip a pointer took: the hover already says it', async () => {
    focusByKey(false)
    const { shelf } = await mount()
    want('pools-mode')
    chips(shelf)[1].focus()
    expect(shelf.shadowRoot!.querySelector<HTMLElement>('.tip')!.hidden).toBe(true)
  })

  it('says a name as text', async () => {
    focusByKey(true)
    const { shelf } = await mount({ all: [], own: '' })
    want('pools-mode')
    room([{ kind: 'participant', id: 'c5'.repeat(32), name: '<b>Mallory</b>' }])
    chips(shelf)[0].focus()
    const tip = shelf.shadowRoot!.querySelector<HTMLElement>('.tip')!
    expect(tip.textContent).toBe('<b>Mallory</b>')
    expect(tip.children).toHaveLength(0)
  })

  it('keeps the chip in hand through a press', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    chips(shelf)[1].focus()
    chips(shelf)[1].click()
    expect(shelf.shadowRoot?.activeElement).toBe(chips(shelf)[1])
  })

  it('keeps the chip in hand when the room changes around it', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    room([ANA])
    chipOf(shelf, 'Ana Maria Lopez').focus()
    room([ANA, BEN])
    expect(shelf.shadowRoot?.activeElement).toBe(chipOf(shelf, 'Ana Maria Lopez'))
    room([])
    expect(shelf.shadowRoot?.activeElement).toBe(chips(shelf)[0])
  })

  it('never lets the keys that work the row reach the hive', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    const heard: string[] = []
    const hear = (e: KeyboardEvent): void => { heard.push(e.key) }
    document.addEventListener('keydown', hear)
    for (const key of [' ', 'Enter', 'ArrowRight', 'x']) {
      chips(shelf)[0].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }))
    }
    document.removeEventListener('keydown', hear)
    expect(heard).toEqual(['x'])
  })
})

describe('the shortcuts of the hive', () => {
  /** Every word said to the keymap, in order: it reads keys off the window, where the strip cannot stop them. */
  const keymap = (): string[] => {
    const heard: string[] = []
    for (const word of ['keymap:suppress', 'keymap:unsuppress']) {
      EffectBus.on<{ reason?: string }>(word, (p) => { heard.push(`${word} ${p?.reason}`) })
    }
    return heard
  }

  it('stand down while the field holds the focus, so a word typed there stays a word', async () => {
    const heard = keymap()
    const { shelf } = await mount()
    want('pools-mode')
    expect(heard).toEqual([])
    field(shelf).focus()
    expect(heard).toEqual(['keymap:suppress domain-shelf'])
    field(shelf).blur()
    expect(heard).toEqual(['keymap:suppress domain-shelf', 'keymap:unsuppress domain-shelf'])
  })

  it('stand down while a chip holds the focus, so an arrow along the row stays on the row', async () => {
    const heard = keymap()
    const { shelf } = await mount()
    want('pools-mode')
    chips(shelf)[0].focus()
    chips(shelf)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true, cancelable: true }))
    field(shelf).focus()
    expect(heard.at(-1)).toBe('keymap:suppress domain-shelf')
    expect(heard.filter(word => word.startsWith('keymap:suppress'))).toHaveLength(heard.filter(word => word.startsWith('keymap:unsuppress')).length + 1)
    field(shelf).blur()
    expect(heard.at(-1)).toBe('keymap:unsuppress domain-shelf')
  })

  it('never take an Escape meant for the strip: the strip says it answers Escape itself', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    // The escape cascade asks the focused element, which outside the shadow root is the strip's own element.
    field(shelf).focus()
    expect(document.activeElement).toBe(shelf)
    expect(document.activeElement?.closest('[data-escape-local]')).toBe(shelf)
  })

  it('let go of the row on Escape, and keep that press from the hive', async () => {
    const { shelf } = await mount()
    want('pools-mode')
    const heard: string[] = []
    const hear = (e: KeyboardEvent): void => { heard.push(e.key) }
    document.addEventListener('keydown', hear)
    chips(shelf)[1].focus()
    chips(shelf)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }))
    document.removeEventListener('keydown', hear)
    expect(shelf.shadowRoot?.activeElement).toBeNull()
    expect(heard).toEqual([])
    expect(pressed(shelf)).toEqual([true, true, true])
  })

  it('come back when the strip is taken away while it held the focus', async () => {
    const heard = keymap()
    const { shelf } = await mount()
    want('pools-mode')
    field(shelf).focus()
    want('pools-mode', false)
    expect(heard.at(-1)).toBe('keymap:unsuppress domain-shelf')
    want('pools-mode')
    chips(shelf)[0].focus()
    shelf.remove()
    expect(heard.at(-1)).toBe('keymap:unsuppress domain-shelf')
    expect(heard.filter(word => word.startsWith('keymap:suppress'))).toHaveLength(2)
    expect(heard.filter(word => word.startsWith('keymap:unsuppress'))).toHaveLength(2)
  })
})

describe('with nobody to draw from', () => {
  it('says in words how a node appears, and offers nothing to press', async () => {
    const { shelf, said } = await mount({ all: [], own: '' })
    want('pools-mode')
    expect(chips(shelf)).toEqual([])
    const words = shelf.shadowRoot?.querySelector('.empty')?.textContent
    expect(words).toMatch(/Follow a host/)
    expect(words).toMatch(/join a room/)
    expect(shelf.shadowRoot?.querySelector('.chips button, .chips a')).toBeNull()
    expect(shelf.shadowRoot?.querySelector<HTMLElement>('.count')?.hidden).toBe(true)
    expect(said).toEqual([{ zones: [], all: [], query: '', nodes: [], allNodes: [] }])
  })

  it('gives way to the chips once somebody is in the room, and comes back when they go', async () => {
    const { shelf } = await mount({ all: [], own: '' })
    want('pools-mode')
    room([ANA])
    expect(shelf.shadowRoot?.querySelector('.empty')).toBeNull()
    expect(names(shelf)).toEqual(['Ana Maria Lopez'])
    room([])
    expect(shelf.shadowRoot?.querySelector('.empty')).not.toBeNull()
  })
})

describe('the search', () => {
  it('is said trimmed and lower-cased, once the typing rests', async () => {
    const { shelf, said } = await mount()
    want('pools-mode')
    expect(field(shelf).placeholder).toBe('search what they offer')
    type(shelf, '  Sour')
    type(shelf, '  SourDough  ')
    await wait(40)
    expect(said).toHaveLength(1)
    await wait(200)
    expect(said).toHaveLength(2)
    expect(said.at(-1)).toEqual(drawn(HOSTS, { query: 'sourdough' }))
  })

  it('keeps its keys from the hive, and Escape clears before it leaves', async () => {
    const { shelf, said } = await mount()
    want('pools-mode')
    const heard: string[] = []
    const hear = (e: KeyboardEvent): void => { heard.push(e.key) }
    document.addEventListener('keydown', hear)
    const input = field(shelf)
    const key = (name: string): void => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, cancelable: true }))
    }
    input.focus()
    type(shelf, 'rye')
    key('r')
    key('Escape')
    expect(input.value).toBe('')
    expect(shelf.shadowRoot?.activeElement).toBe(input)
    expect(said.at(-1)?.query).toBe('')
    key('Escape')
    expect(shelf.shadowRoot?.activeElement).toBeNull()
    document.removeEventListener('keydown', hear)
    expect(heard).toEqual([])
  })

  it('takes words from elsewhere without taking the focus, and says them at once', async () => {
    const { shelf, said } = await mount()
    want('pools-mode')
    EffectBus.emitTransient(SOURCES_QUERY, { query: ' Weeknight ' })
    expect(field(shelf).value).toBe('Weeknight')
    expect(shelf.shadowRoot?.activeElement).toBeNull()
    expect(said.at(-1)).toEqual(drawn(HOSTS, { query: 'weeknight' }))
  })

  it('holds words sent while it was out of view, and shows them when it comes up', async () => {
    const { shelf, said } = await mount()
    EffectBus.emitTransient(SOURCES_QUERY, { query: 'tasting' })
    expect(said.at(-1)?.query).toBe('tasting')
    want('recipe-picker')
    expect(field(shelf).value).toBe('tasting')
  })

  it('lets the words go with its last owner, so the next surface opens on an empty search', async () => {
    const { shelf, said } = await mount()
    want('recipe-catalogue')
    EffectBus.emitTransient(SOURCES_QUERY, { query: 'lasagne' })
    expect(said.at(-1)?.query).toBe('lasagne')
    want('recipe-catalogue', false)
    // Said at once: the state is a last value, and a surface that opens later is handed it.
    expect(said.at(-1)).toEqual(drawn(HOSTS))
    want('recipe-picker')
    expect(field(shelf).value).toBe('')
    expect(shelf.state.query).toBe('')
  })

  it('drops words still being typed when its last owner leaves, and never says them', async () => {
    const { shelf, said } = await mount()
    want('recipe-catalogue')
    type(shelf, 'lasag')
    want('recipe-catalogue', false)
    await wait(220)
    expect(said.map(state => state.query)).toEqual([''])
    want('recipe-picker')
    expect(field(shelf).value).toBe('')
  })

  it('keeps the words while another owner still holds the strip', async () => {
    const { shelf, said } = await mount()
    want('pools-mode')
    want('recipe-catalogue')
    EffectBus.emitTransient(SOURCES_QUERY, { query: 'lasagne' })
    want('recipe-catalogue', false)
    expect(field(shelf).value).toBe('lasagne')
    expect(said.at(-1)?.query).toBe('lasagne')
  })
})

describe('what it announces', () => {
  it('is said once at the start on the bus, so a reader that comes later has it', async () => {
    const shelf = document.createElement(DOMAIN_SHELF_SURFACE) as DomainShelfElement
    shelf.seams = {
      followedZones: async () => HOSTS,
      ownZone: async () => MINE,
      readSourcesOff: async () => [KITCHEN],
      writeSourcesOff: async () => true,
    }
    document.body.appendChild(shelf)
    await settle()
    let heard: SourcesState | undefined
    EffectBus.on<SourcesState>(SOURCES_CHANGED, (state) => { heard = state })
    expect(heard).toEqual(drawn([MINE, BAKERY]))
  })

  it('tells a reader that only knows domains exactly what it always did, and every node beside it', async () => {
    const { shelf, said } = await mount({ off: [BAKERY] })
    want('pools-mode')
    room([ME, ANA, BEN])
    chipOf(shelf, 'Ben Okri').click()
    const state = said.at(-1)!
    expect(state.zones).toEqual([MINE, KITCHEN])
    expect(state.all).toEqual(HOSTS)
    expect(state.query).toBe('')
    expect(state.nodes).toEqual([
      { kind: 'domain', id: MINE, you: true },
      { kind: 'domain', id: KITCHEN },
      ME,
      ANA,
    ])
    expect(state.allNodes).toEqual([
      { kind: 'domain', id: MINE, you: true },
      { kind: 'domain', id: BAKERY },
      { kind: 'domain', id: KITCHEN },
      ME,
      ANA,
      BEN,
    ])
    expect(shelf.state).toEqual(state)
  })

  it('does not depend on being in view', async () => {
    const { shelf, said } = await mount()
    room([ANA])
    expect(strip(shelf)).toBeNull()
    expect(said.at(-1)).toEqual(drawn(HOSTS, { people: [ANA] }))
  })

  it('is not said again when nothing changed', async () => {
    const { said } = await mount()
    EffectBus.emit('hosts:render', { open: true })
    await settle()
    EffectBus.emit('hosts:render', { open: false })
    await settle()
    room([])
    expect(said).toHaveLength(1)
  })
})

describe('where it stands', () => {
  /** A shelf on the page whose strip ends at `bottom`, and every box measured as the browser would. */
  const shelfAbove = (bottom: number, picks = false): HTMLElement => {
    const tray = document.createElement('hc-quick-tray')
    tray.attachShadow({ mode: 'open' }).innerHTML = `<section class="shelf${picks ? ' picks' : ''}"></section>`
    document.body.prepend(tray)
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const below = this.classList.contains('shelf') ? bottom : this.classList.contains('strip') ? bottom + 50 : 0
      return { bottom: below, top: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
    return tray
  }

  it('takes the shelf\'s place when the shelf is away, and holds its band', async () => {
    const sizes = bands()
    const { shelf } = await mount()
    want('pools-mode')
    await frame()
    expect(shelf.style.getPropertyValue('--domains-top')).toBe('')
    expect(sizes.at(-1)).toBe(6)
  })

  it('stands under the shelf when the shelf is showing', async () => {
    const sizes = bands()
    shelfAbove(100)
    const { shelf } = await mount()
    want('pools-mode')
    await frame()
    expect(shelf.style.getPropertyValue('--domains-top')).toBe('106px')
    expect(sizes.at(-1)).toBe(156)
  })

  it('moves up when the shelf goes, though the shelf said nothing on the bus', async () => {
    const tray = shelfAbove(100)
    const { shelf } = await mount()
    want('pools-mode')
    await frame()
    tray.shadowRoot!.innerHTML = ''
    await settle()
    await frame()
    expect(shelf.style.getPropertyValue('--domains-top')).toBe('')
  })

  it('never moves the canvas for the selection shelf: it stands under it and the band stays', async () => {
    const sizes = bands()
    const tray = shelfAbove(100)
    const { shelf } = await mount()
    want('pools-mode')
    await frame()
    expect(sizes.at(-1)).toBe(156)
    vi.restoreAllMocks()
    tray.remove()
    shelfAbove(300, true)
    EffectBus.emit('shelf:changed', { entries: [], folded: false })
    await frame()
    expect(shelf.style.getPropertyValue('--domains-top')).toBe('306px')
    expect(sizes.at(-1)).toBe(156)
  })

  it('answers a canvas that asks for every reservation again', async () => {
    await mount()
    want('pools-mode')
    await frame()
    const sizes = bands()
    sizes.length = 0
    EffectBus.emitTransient('viewport:inset-poll', {})
    await frame()
    expect(sizes).toEqual([6])
  })

  it('gives the band back when it leaves the page or goes out of view', async () => {
    const sizes = bands()
    const { shelf } = await mount()
    want('pools-mode')
    await frame()
    want('pools-mode', false)
    await frame()
    expect(sizes.at(-1)).toBe(0)
    want('pools-mode')
    await frame()
    expect(sizes.at(-1)).toBe(6)
    shelf.remove()
    expect(sizes.at(-1)).toBe(0)
  })
})

describe('the words', () => {
  it('come from the catalog where it has them, and from here where a key is echoed back', async () => {
    (globalThis as { ioc?: unknown }).ioc = {
      get: (key: string) => key === I18N_IOC_KEY
        ? {
            t: (name: string) => name === 'pools.domains.from' ? 'De'
              : name === 'pools.domains.count' ? '{on} de {all}'
              : name === 'pools.domains.yours' ? '{name} (tú)'
              : name,
          }
        : undefined,
    }
    const { shelf } = await mount()
    want('pools-mode')
    expect(shelf.shadowRoot?.querySelector('.word')?.textContent).toBe('De')
    expect(count(shelf)).toBe('3 de 3')
    expect(chips(shelf)[0].title).toBe(`${MINE} (tú)`)
    expect(field(shelf).placeholder).toBe('search what they offer')
  })
})
