import { describe, expect, it } from 'vitest'
import { appsOn, groupCoverage, groupPage, hasChanges, inGroup, opensOn, othersOn, pickedAfterPress, pruneSelection, selectedRows, shownAt, type AppRow } from './publish-apps'

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

  it('what another device published there is counted apart — named by key, never listed with the rest', () => {
    expect(othersOn(rows, 'hypercomb.com').map(r => r.key)).toEqual(['elsewhere'])
    expect(appsOn(rows, 'hypercomb.com').some(r => r.key === 'elsewhere')).toBe(false)
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

describe('selecting apps to publish, or to make a group', () => {
  it('only drift and gone are changes — a row nothing could prove is not', () => {
    expect(['drift', 'gone', 'live', 'unknown', 'cannot-compare', 'comparing'].map(state => hasChanges(row('/a', { state }))))
      .toEqual([true, true, false, false, false, false])
  })

  it('a selection keeps only keys that still have a row, and is the same set when nothing dropped', () => {
    const rows = [row('/a'), row('/b')]
    const keys = new Set(['a', 'b'])
    expect(pruneSelection(rows, keys)).toBe(keys)
    expect([...pruneSelection([rows[0]], keys)]).toEqual(['a'])
    expect(selectedRows(rows, new Set(['b', 'gone'])).map(r => r.key)).toEqual(['b'])
  })

  it('a group is made only from apps on one page, named as that page lists them', () => {
    expect(groupPage([row('/meetups'), row('/hosting')])).toEqual({ segments: [], members: ['meetups', 'hosting'] })
    expect(groupPage([row('/revolucion/meetup'), row('/revolucion/agenda')])).toEqual({ segments: ['revolucion'], members: ['meetup', 'agenda'] })
    expect(groupPage([row('/meetups'), row('/revolucion/meetup')])).toBeNull()
    expect(groupPage([row('/a/x'), row('/b/x')])).toBeNull()
    expect(groupPage([])).toBeNull()
  })
})

describe('row select, and the list by group', () => {
  const keys = ['a', 'b', 'c', 'd']
  const set = (...k: string[]): ReadonlySet<string> => new Set(k)

  it('a press picks a row or lets it go — the rest stay as they were', () => {
    expect([...pickedAfterPress(set(), keys, 'b', null, false)]).toEqual(['b'])
    expect([...pickedAfterPress(set('a', 'b'), keys, 'b', 'a', false)]).toEqual(['a'])
  })

  it('Shift picks every row from the last one pressed, either way, and never lets one go', () => {
    expect([...pickedAfterPress(set('a'), keys, 'c', 'a', true)].sort()).toEqual(['a', 'b', 'c'])
    expect([...pickedAfterPress(set(), keys, 'b', 'd', true)].sort()).toEqual(['b', 'c', 'd'])
    expect([...pickedAfterPress(set('c'), keys, 'c', 'c', true)]).toEqual(['c'])
  })

  it('Shift with no anchor in the list is a plain press', () => {
    expect([...pickedAfterPress(set(), keys, 'b', null, true)]).toEqual(['b'])
    expect([...pickedAfterPress(set(), keys, 'b', 'gone', true)]).toEqual(['b'])
  })

  it('a group holds its page’s children by name — nothing deeper, nothing on another page', () => {
    const members = ['meetup', 'agenda']
    expect(inGroup(row('/revolucion/meetup'), ['revolucion'], members)).toBe(true)
    expect(inGroup(row('/revolucion/lounge'), ['revolucion'], members)).toBe(false)
    expect(inGroup(row('/revolucion/meetup/notes'), ['revolucion'], members)).toBe(false)
    expect(inGroup(row('/other/meetup'), ['revolucion'], members)).toBe(false)
    expect(inGroup(row('/meetup'), [], members)).toBe(true)
  })

  it('the picks are all in a group, some, or none — all means a press takes them out', () => {
    expect(groupCoverage(['a', 'b'], ['a', 'b', 'c'])).toBe('all')
    expect(groupCoverage(['a', 'x'], ['a', 'b'])).toBe('some')
    expect(groupCoverage(['x'], ['a'])).toBe('none')
    expect(groupCoverage([], ['a'])).toBe('none')
  })
})
