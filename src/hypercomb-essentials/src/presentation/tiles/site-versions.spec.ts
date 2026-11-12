import { afterEach, describe, expect, it, vi } from 'vitest'
import { SiteVersions, mergeContributions } from './site-versions.js'
import type { PageContribution } from '../../sharing/page-contributions.js'

// THE VERSIONS OF ONE PAGE (documentation/page-contributions.md, step 4): the
// published page and every contribution, newest first; a words-only version can
// be shown here for this reader alone; one that changes more is compare-only;
// any two compare by their visible words.

const BASE = 'a'.repeat(64)
const BASE_HTML = '<html><body><h1>Hello</h1><p>Same line</p></body></html>'
const contribution = (over: Partial<PageContribution>): PageContribution => ({
  pubkey: 'c'.repeat(64), sig: 'b'.repeat(64), html: BASE_HTML.replace('Hello', 'Welcome'),
  at: 100, textOnly: true, host: 'example.com', ...over,
})

const t = (_key: string, fallback: string): string => fallback

afterEach(() => { document.body.replaceChildren() })

describe('mergeContributions', () => {
  it('keeps one row per signature across hosts, the newest sighting, newest first', () => {
    const merged = mergeContributions([
      [contribution({ sig: '1'.repeat(64), at: 100, host: 'one.example' })],
      [contribution({ sig: '1'.repeat(64), at: 300, host: 'two.example' }), contribution({ sig: '2'.repeat(64), at: 200 })],
    ])
    expect(merged.map(c => [c.sig[0], c.at, c.host])).toEqual([['1', 300, 'two.example'], ['2', 200, 'example.com']])
  })
})

describe('SiteVersions', () => {
  const open = (contributions: PageContribution[], show = vi.fn()) => {
    const versions = new SiteVersions({ base: BASE, baseHtml: BASE_HTML, contributions, me: 'c'.repeat(64), shown: BASE, show, t, bottom: '3.5rem' })
    const toggle = document.getElementById('hc-site-versions-toggle') as HTMLButtonElement
    toggle.click()
    const rows = [...document.querySelectorAll<HTMLElement>('.hc-sv-row')]
    return { versions, toggle, rows, show }
  }

  it('counts every version, the published one first, and says who and whether only words changed', () => {
    const { toggle, rows } = open([contribution({}), contribution({ sig: 'd'.repeat(64), pubkey: 'e'.repeat(64), textOnly: false })])
    expect(toggle.getAttribute('aria-label')).toBe('Versions of this page (3)')
    expect(rows.map(r => r.querySelector('.hc-sv-who')!.textContent)).toEqual([
      'Published',
      'Youwords only',
      'eeeeeeee…changes more than words — compare only',
    ])
    expect(rows[0].getAttribute('aria-current')).toBe('true')
  })

  it('shows a words-only version when its row is clicked, and never one that changes more', () => {
    const words = contribution({})
    const more = contribution({ sig: 'd'.repeat(64), textOnly: false })
    const { rows, show } = open([words, more])
    rows[2].click()
    expect(show).not.toHaveBeenCalled()
    expect(rows[2].getAttribute('aria-disabled')).toBe('true')
    rows[1].click()
    expect(show).toHaveBeenCalledWith(words)
  })

  it('compares any two ticked versions by their visible words', () => {
    const { rows } = open([contribution({})])
    const tick = (row: HTMLElement): void => {
      const box = row.querySelector('input')!
      box.checked = true
      box.dispatchEvent(new Event('change'))
    }
    expect(document.querySelector<HTMLElement>('.hc-sv-diff')!.hidden).toBe(true)
    tick(rows[0])
    tick(rows[1])
    const diff = document.querySelector<HTMLElement>('.hc-sv-diff')!
    expect(diff.hidden).toBe(false)
    expect(diff.querySelector('.remove')?.textContent).toBe('− Hello')
    expect(diff.querySelector('.add')?.textContent).toBe('+ Welcome')
  })

  it('takes its button and panel away when the page goes', () => {
    const { versions } = open([contribution({})])
    versions.dispose()
    expect(document.getElementById('hc-site-versions-toggle')).toBeNull()
    expect(document.querySelector('.hc-site-versions')).toBeNull()
  })
})

describe('SiteVersions — the key holder', () => {
  it('offers "Use for everyone" on every showable version but the one everyone sees, and marks the pick', async () => {
    const words = contribution({})
    const more = contribution({ sig: 'd'.repeat(64), textOnly: false })
    const other = contribution({ sig: 'e'.repeat(64) })
    const pick = vi.fn(async () => null)
    new SiteVersions({ base: BASE, baseHtml: BASE_HTML, contributions: [words, more, other], me: 'f'.repeat(64), shown: BASE, show: vi.fn(), picked: () => words.sig, pick, t, bottom: '3.5rem' })
    ;(document.getElementById('hc-site-versions-toggle') as HTMLButtonElement).click()
    const rows = [...document.querySelectorAll<HTMLElement>('.hc-sv-row')]
    // Published (a pick exists, so it can be chosen again), not the picked one,
    // not the one that changes more, and the other words-only one.
    expect(rows.map(r => !!r.querySelector('.hc-sv-pick'))).toEqual([true, false, false, true])
    expect(rows[1].querySelector('.hc-sv-tag.picked')?.textContent).toBe('everyone sees this')
    rows[3].querySelector<HTMLButtonElement>('.hc-sv-pick')!.click()
    expect(pick).toHaveBeenCalledWith(other)
    rows[0].querySelector<HTMLButtonElement>('.hc-sv-pick')!.click()
    expect(pick).toHaveBeenCalledWith(null)
  })

  it('offers nothing to pick to anyone without the key', () => {
    new SiteVersions({ base: BASE, baseHtml: BASE_HTML, contributions: [contribution({})], me: 'f'.repeat(64), shown: BASE, show: vi.fn(), t, bottom: '3.5rem' })
    ;(document.getElementById('hc-site-versions-toggle') as HTMLButtonElement).click()
    expect(document.querySelector('.hc-sv-pick')).toBeNull()
  })
})
