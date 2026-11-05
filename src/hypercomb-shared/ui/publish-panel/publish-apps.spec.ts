import { describe, expect, it } from 'vitest'
import { appsOn, hasChanges, matchesQuery, opensOn, scopeState, shownAt, wantAfterPress, zonesToMove, type AppRow } from './publish-apps'

const row = (path: string, patch: Partial<AppRow> = {}): AppRow => {
  const segments = path.split('/').filter(Boolean)
  return {
    key: segments.join('/'), path, segments, state: 'live', live: 'a'.repeat(64), doors: null,
    urls: { 'hypercomb.com': `https://${segments[0]}.hypercomb.com`, 'jwize.com': `https://${segments[0]}.jwize.com` },
    ...patch,
  }
}

describe('what each domain hosts', () => {
  const rows = [
    row('/meetups'),
    row('/hosting', { doors: ['hypercomb.com'] }),
    row('/revolucion', { doors: ['jwize.com'] }),
    row('/drafts', { live: null, state: 'unpublished' }),
    // Published from another device: no path here, its address is the bare domain.
    { ...row('/x'), key: 'elsewhere', path: 'elsewhere', segments: [], urls: { 'hypercomb.com': 'https://hypercomb.com' } },
  ]

  it('lists what is published there, once each, by path — never a row this hive cannot act on', () => {
    expect(appsOn(rows, 'hypercomb.com').map(r => r.path)).toEqual(['/hosting', '/meetups'])
    expect(appsOn(rows, 'jwize.com').map(r => r.path)).toEqual(['/meetups', '/revolucion'])
    expect(appsOn([...rows, rows[0]], 'hypercomb.com').map(r => r.path)).toEqual(['/hosting', '/meetups'])
  })

  it('no app address is ever the bare domain it sits under', () => {
    for (const zone of ['hypercomb.com', 'jwize.com']) {
      for (const app of appsOn(rows, zone)) expect(shownAt(app, zone)).not.toBe(zone)
    }
    expect(shownAt(rows[0], 'hypercomb.com')).toBe('meetups.hypercomb.com')
  })

  it('an app at the front page reads as the domain itself — the caller words it', () => {
    const front = row('/card', { urls: { 'hypercomb.com': 'https://hypercomb.com' } })
    expect(shownAt(front, 'hypercomb.com')).toBe('hypercomb.com')
  })

  it('a door list opens only where it names; no doors opens everywhere; unpublished opens nowhere', () => {
    expect(opensOn(rows[1], 'jwize.com')).toBe(false)
    expect(opensOn(rows[0], 'anything.example')).toBe(true)
    expect(opensOn(rows[3], 'hypercomb.com')).toBe(false)
  })
})

describe('what is a change', () => {
  it('only drift and gone — a row nothing could prove is not', () => {
    expect(['drift', 'gone', 'live', 'unknown', 'cannot-compare', 'comparing'].map(state => hasChanges(row('/a', { state }))))
      .toEqual([true, true, false, false, false, false])
  })
})

describe('a creation across a set of domains', () => {
  const on = (...zones: string[]) => (zone: string): boolean => zones.includes(zone)
  const set = ['hypercomb.com', 'jwize.com', 'revolucionstyle.com']

  it('is on when it is on every domain, off when on none, and mixed when on some', () => {
    expect(scopeState(set, on(...set))).toBe('on')
    expect(scopeState(set, on())).toBe('off')
    expect(scopeState(set, on('jwize.com'))).toBe('mixed')
    expect(scopeState(set, on('hypercomb.com', 'jwize.com'))).toBe('mixed')
    // domains outside the set do not count
    expect(scopeState(['jwize.com'], on('hypercomb.com'))).toBe('off')
  })

  it('a set that holds nothing holds nothing: off', () => {
    expect(scopeState([], () => true)).toBe('off')
  })

  it('a switch moves only the domains not already where it is going', () => {
    expect(zonesToMove(set, on('jwize.com'), true)).toEqual(['hypercomb.com', 'revolucionstyle.com'])
    expect(zonesToMove(set, on('jwize.com'), false)).toEqual(['jwize.com'])
    expect(zonesToMove(set, on(...set), true)).toEqual([])
    expect(zonesToMove(set, on(), false)).toEqual([])
  })

  it('a press turns an off one on, an on one off, and syncs a mix to on', () => {
    expect(wantAfterPress('off')).toBe(true)
    expect(wantAfterPress('on')).toBe(false)
    expect(wantAfterPress('mixed')).toBe(true)
  })
})

describe('the search at the top', () => {
  it('an empty query holds everything; every word must be found, in any order', () => {
    expect(matchesQuery('', 'meetups')).toBe(true)
    expect(matchesQuery('   ', 'meetups')).toBe(true)
    expect(matchesQuery('meet hyper', 'meetups', 'meetups.hypercomb.com')).toBe(true)
    expect(matchesQuery('hyper meet', 'meetups', 'meetups.hypercomb.com')).toBe(true)
    expect(matchesQuery('meet jwize', 'meetups', 'meetups.hypercomb.com')).toBe(false)
  })

  it('case and accents do not matter', () => {
    expect(matchesQuery('REVOLUCION', 'revolución')).toBe(true)
    expect(matchesQuery('café', 'Cafe Menu')).toBe(true)
  })
})
