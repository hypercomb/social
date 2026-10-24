import { describe, expect, it } from 'vitest'
import { appsOn, groupPage, hasChanges, opensOn, othersOn, pruneSelection, selectedRows, shownAt, type AppRow } from './publish-apps'

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
