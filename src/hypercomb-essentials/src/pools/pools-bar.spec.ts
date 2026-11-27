// pools/pools-bar.spec.ts : the pools bar's words and its presses, with fake
// words and fake callbacks. Nothing is published and no hive is needed.

import { describe, expect, it, vi } from 'vitest'
import type { LightsPublished } from './lights-contract.js'
import {
  poolsBar, poolsBarCounts, poolsBarOutcome, poolsFrame,
  type PoolsBarOptions, type PoolsBarPool, type PoolsBarSay, type PoolsBarState,
} from './pools-bar.js'

/** The English beside each key, with its holes filled: what a catalog without the key gives. */
const say: PoolsBarSay = (_key, fallback, params) =>
  params ? fallback.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : fallback

const recipes: PoolsBarPool['label'] = { key: 'recipe.pool', one: '{count} recipe template', other: '{count} recipe templates' }
const mail: PoolsBarPool['label'] = { key: 'mail.pool', one: '{count} mail template', other: '{count} mail templates' }
const labelOf = (meaning: string): PoolsBarPool['label'] | undefined =>
  meaning === 'recipe:template' ? recipes : meaning === 'mail:template' ? mail : undefined

const state = (over: Partial<PoolsBarState> = {}): PoolsBarState => ({
  here: 0, total: 0, pools: [], busy: false, outcome: null, canOn: true, canOff: true, touch: false, ...over,
})

const published = (over: Partial<LightsPublished> = {}): LightsPublished => ({
  at: 1, ok: true, host: 'example.com', pools: [], ...over,
})

const built = () => {
  const options: PoolsBarOptions = {
    say, onPublish: vi.fn(), onJoin: vi.fn(), onClose: vi.fn(), onAllOn: vi.fn(), onAllOff: vi.fn(),
  }
  const bar = poolsBar(options)
  const press = (name: string): void => { (bar.element.querySelector(`button.${name}`) as HTMLButtonElement).click() }
  const text = (name: string): string => bar.element.querySelector(`.${name}`)?.textContent ?? ''
  return { bar, options, press, text }
}

describe('poolsBarCounts', () => {
  it('says nothing is on, and nothing to leave, when nothing is lit', () => {
    expect(poolsBarCounts(say, state())).toBe('0 on here · 0 on in all · nothing to leave in a pool yet')
  })

  it('names one member in the singular', () => {
    const pools = [{ meaning: 'recipe:template', count: 1, label: recipes }]
    expect(poolsBarCounts(say, state({ here: 1, total: 1, pools }))).toBe('1 on here · 1 on in all · leaves 1 recipe template')
  })

  it('counts many, and lists only the pools that would hold something', () => {
    const pools = [
      { meaning: 'recipe:template', count: 2, label: recipes },
      { meaning: 'mail:template', count: 0, label: mail },
    ]
    expect(poolsBarCounts(say, state({ here: 3, total: 12, pools }))).toBe('3 on here · 12 on in all · leaves 2 recipe templates')
    const both = [pools[0], { meaning: 'mail:template', count: 5, label: mail }]
    expect(poolsBarCounts(say, state({ here: 3, total: 12, pools: both }))).toBe('3 on here · 12 on in all · leaves 2 recipe templates, 5 mail templates')
  })

  it('never says fewer are on in all than are on here', () => {
    // The hive's count is read a moment after the page's, so it can be behind.
    expect(poolsBarCounts(say, state({ here: 5, total: 1 }))).toBe('5 on here · 5 on in all · nothing to leave in a pool yet')
    expect(poolsBarCounts(say, state({ here: 5, total: 0 }))).toBe('5 on here · 5 on in all · nothing to leave in a pool yet')
    expect(poolsBarCounts(say, state({ here: 5, total: 9 }))).toBe('5 on here · 9 on in all · nothing to leave in a pool yet')
  })

  it('says nothing to leave when tiles are on and no pool takes what they carry', () => {
    const pools = [{ meaning: 'recipe:template', count: 0, label: recipes }]
    expect(poolsBarCounts(say, state({ here: 2, total: 4, pools }))).toBe('2 on here · 4 on in all · nothing to leave in a pool yet')
  })
})

describe('poolsBarOutcome', () => {
  it('says what was left, in the pool\'s own words, and where', () => {
    const done = published({ pools: [{ meaning: 'recipe:template', count: 2 }] })
    expect(poolsBarOutcome(say, done, labelOf)).toBe('Left 2 recipe templates in your pool at example.com.')
  })

  it('says a pool that went to none was taken back, without a number', () => {
    const done = published({ pools: [{ meaning: 'recipe:template', count: 1 }, { meaning: 'mail:template', count: 0 }] })
    expect(poolsBarOutcome(say, done, labelOf))
      .toBe('Left 1 recipe template in your pool at example.com. Took your mail templates back from example.com.')
  })

  it('gives the reason when it did not happen, after whatever did', () => {
    const refused = published({ ok: false, host: '', reason: 'Name your home domain first, in the hosts window. That is where your pools are left.' })
    expect(poolsBarOutcome(say, refused, labelOf)).toBe('Name your home domain first, in the hosts window. That is where your pools are left.')
    const partly = published({ ok: false, pools: [{ meaning: 'recipe:template', count: 2 }], reason: 'example.com could not be reached' })
    expect(poolsBarOutcome(say, partly, labelOf)).toBe('Left 2 recipe templates in your pool at example.com. example.com could not be reached.')
    expect(poolsBarOutcome(say, published({ ok: false }), labelOf)).toBe('Publishing did not finish.')
  })

  it('says so when nothing that is on belongs in a pool', () => {
    expect(poolsBarOutcome(say, published(), labelOf)).toBe('Nothing that is on belongs in a pool yet, so nothing was left.')
  })

  it('names a pool nobody has words for by its meaning', () => {
    const done = published({ pools: [{ meaning: 'themes:card', count: 3 }, { meaning: 'themes:deck', count: 0 }] })
    expect(poolsBarOutcome(say, done, labelOf)).toBe('Left 3 themes:card in your pool at example.com. Took your themes:deck back from example.com.')
  })
})

describe('poolsBar', () => {
  it('hands each press to its callback', () => {
    const { bar, options, press } = built()
    bar.update(state({ here: 1, total: 1 }))
    press('hc-pools-publish')
    press('hc-pools-join')
    press('hc-pools-close')
    press('hc-pools-all-on')
    press('hc-pools-all-off')
    expect(options.onPublish).toHaveBeenCalledTimes(1)
    expect(options.onJoin).toHaveBeenCalledTimes(1)
    expect(options.onClose).toHaveBeenCalledTimes(1)
    expect(options.onAllOn).toHaveBeenCalledTimes(1)
    expect(options.onAllOff).toHaveBeenCalledTimes(1)
  })

  it('shows the lead, the live counts and the words on every control', () => {
    const { bar, text } = built()
    bar.update(state({ here: 3, total: 12, pools: [{ meaning: 'recipe:template', count: 2, label: recipes }] }))
    expect(text('hc-pools-title')).toBe('Pools')
    expect(text('hc-pools-say')).toBe('Click a tile to turn it on. What is on is yours to offer.')
    expect(text('hc-pools-counts')).toBe('3 on here · 12 on in all · leaves 2 recipe templates')
    expect(text('hc-pools-publish')).toBe('Publish')
    expect(text('hc-pools-join')).toBe('Join the swarm')
    expect(text('hc-pools-close')).toBe('Close')
    expect(text('hc-pools-all-on')).toBe('All on here')
    expect(text('hc-pools-all-off')).toBe('All off here')
    expect(text('hc-pools-hint')).toBe('Shift-tap: the whole branch')
  })

  it('names the hold, not Shift, and the tap, not the click, where a finger is the pointer', () => {
    const { bar, text } = built()
    bar.update(state({ touch: true }))
    expect(text('hc-pools-hint')).toBe('Hold a tile: the whole branch')
    expect(text('hc-pools-say')).toBe('Tap a tile to turn it on. What is on is yours to offer.')
  })

  it("paints from the shell's roles: the on green, a ring that shows on every press, and no border on a plain word", () => {
    const { bar } = built()
    const sheet = bar.element.querySelector('style')?.textContent ?? ''
    expect(sheet).not.toMatch(/#6fd39a(?!\))|#04180f|outline:none/)
    expect(sheet).toContain('var(--hc-pools-on,#6fd39a)')
    expect(sheet).toContain('.hc-pools-bar button:focus-visible{outline:2px solid var(--hc-focus,currentColor);outline-offset:2px;}')
    expect(sheet).toMatch(/\.hc-pools-bar button\{[^}]*border:0;/)
    expect(sheet).toContain('@media (pointer:coarse)')
    expect(sheet).not.toMatch(/opacity:/)
  })

  it('says it is publishing and takes no second press while busy, then publishes again', () => {
    const { bar, options, press, text } = built()
    bar.update(state({ busy: true }))
    const publish = bar.element.querySelector('button.hc-pools-publish') as HTMLButtonElement
    expect(publish.disabled).toBe(true)
    expect(text('hc-pools-publish')).toBe('Publishing...')
    expect(text('hc-pools-say')).toBe('Leaving what is on in your pools...')
    press('hc-pools-publish')
    expect(options.onPublish).not.toHaveBeenCalled()
    bar.update(state())
    expect(publish.disabled).toBe(false)
    press('hc-pools-publish')
    expect(options.onPublish).toHaveBeenCalledTimes(1)
  })

  it('leaves the page-wide buttons inert when there is nothing for them to do', () => {
    const { bar, options, press } = built()
    bar.update(state({ canOn: false, canOff: false }))
    press('hc-pools-all-on')
    press('hc-pools-all-off')
    expect(options.onAllOn).not.toHaveBeenCalled()
    expect(options.onAllOff).not.toHaveBeenCalled()
  })

  it('shows what a publish did in place of the lead, and marks a refusal', () => {
    const { bar, text } = built()
    const say_ = bar.element.querySelector('.hc-pools-say') as HTMLElement
    const mark = bar.element.querySelector('.hc-pools-refused') as HTMLElement
    bar.update(state({ outcome: { text: 'Left 2 recipe templates in your pool at example.com.', ok: true } }))
    expect(text('hc-pools-say')).toBe('Left 2 recipe templates in your pool at example.com.')
    expect(say_.dataset['tone']).toBeUndefined()
    expect(mark.hidden).toBe(true)
    bar.update(state({ outcome: { text: 'example.com could not be reached.', ok: false } }))
    expect(say_.dataset['tone']).toBe('refused')
    expect(mark.hidden).toBe(false)
    bar.update(state())
    expect(say_.dataset['tone']).toBeUndefined()
    expect(mark.hidden).toBe(true)
    expect(text('hc-pools-say')).toBe('Click a tile to turn it on. What is on is yours to offer.')
  })

  it('draws a refusal in the shell\'s own warning tone, with the window ink where a shell names none', () => {
    const { bar } = built()
    const sheet = bar.element.querySelector('style')?.textContent ?? ''
    // The theme's status tone is dark on a light ground and pale on a dark one: a fixed pale orange read on neither.
    expect(sheet).toContain('.hc-pools-say[data-tone="refused"]{color:var(--hc-status-warn,var(--hc-window-ink-loud,#eef2f5));')
    expect(sheet).not.toContain('#ffc46b')
  })

  it('puts a host\'s and a label\'s words on the page as text, never as markup', () => {
    const { bar, text } = built()
    const hostile = '<img src=x onerror=alert(1)>'
    const label = { key: 'x.pool', one: `{count} ${hostile}`, other: `{count} ${hostile}` }
    const done = published({ host: hostile, pools: [{ meaning: 'x:pool', count: 2 }] })
    const outcome = poolsBarOutcome(say, done, () => label)
    bar.update(state({ pools: [{ meaning: 'x:pool', count: 2, label }], outcome: { text: outcome, ok: true } }))
    expect(bar.element.querySelector('img')).toBeNull()
    expect(text('hc-pools-say')).toContain(hostile)
    expect(text('hc-pools-counts')).toContain(hostile)
  })

  it('is built once: an update keeps the same buttons under the pointer', () => {
    const { bar } = built()
    bar.update(state())
    const before = bar.element.querySelector('button.hc-pools-publish')
    bar.update(state({ here: 4, busy: true }))
    expect(bar.element.querySelector('button.hc-pools-publish')).toBe(before)
  })

  it('takes itself off the page on dispose', () => {
    const { bar } = built()
    document.body.append(bar.element)
    expect(document.getElementById('hc-pools-bar')).toBe(bar.element)
    bar.dispose()
    expect(document.getElementById('hc-pools-bar')).toBeNull()
  })
})

describe('poolsFrame', () => {
  it('frames the viewport and takes no pointer', () => {
    const frame = poolsFrame()
    expect(frame.style.pointerEvents).toBe('none')
    expect(frame.style.position).toBe('fixed')
    expect(frame.getAttribute('aria-hidden')).toBe('true')
  })
})
