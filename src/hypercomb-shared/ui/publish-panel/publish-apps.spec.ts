import { describe, expect, it } from 'vitest'
import { appsOn, communityEntries, communityNameKey, communityPress, hasChanges, lineageName, matchesQuery, opensOn, shownAt, type AppRow } from './publish-apps'

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

describe('your community, fed by every domain (jwize 2026-11-16)', () => {
  const me = 'a'.repeat(64)
  const them = 'b'.repeat(64)

  it('one entry per name; a version on several domains is one version naming them all', () => {
    const entries = communityEntries(me,
      [{ pubkey: me, lineage: 'meetups', hosts: ['jwize.com'] }],
      [{ pubkey: me, lineage: 'meetups', name: 'meetups', hosts: ['hypercomb.com'] }],
      [])
    expect(entries).toHaveLength(1)
    expect(entries[0].versions).toHaveLength(1)
    expect(entries[0].versions[0]).toMatchObject({ hosts: ['hypercomb.com', 'jwize.com'], own: true, live: false })
    expect(entries[0].live).toBe(false)
  })

  it('the same name from two publishers is two versions of one entry, to drill into', () => {
    const entries = communityEntries(me,
      [{ pubkey: me, lineage: 'games/arkanoid', hosts: ['jwize.com'] }],
      [{ pubkey: them, lineage: 'arkanoid', name: 'arkanoid', hosts: ['dylan.com'] }],
      [{ pubkey: them, lineage: 'arkanoid' }])
    expect(entries).toHaveLength(1)
    expect(entries[0].name.toLowerCase()).toBe('arkanoid')
    expect(entries[0].live).toBe(true)
    // the live one first
    expect(entries[0].versions.map(v => [v.pubkey === them, v.live, v.own])).toEqual([[true, true, false], [false, false, true]])
  })

  it('a live one nothing else knows is still listed, so it can be taken out', () => {
    const entries = communityEntries(me, [], [], [{ pubkey: me, lineage: 'old/thing' }])
    expect(entries.map(e => [e.name, e.live, e.versions[0].hosts])).toEqual([['thing', true, []]])
  })

  it('entries go by name', () => {
    const entries = communityEntries(me, [
      { pubkey: me, lineage: 'zeta', hosts: ['a.com'] },
      { pubkey: me, lineage: 'alpha', hosts: ['a.com'] },
    ], [], [])
    expect(entries.map(e => e.name)).toEqual(['alpha', 'zeta'])
  })

  it('a press publishes a gray one live and takes the other live versions of the name out; a live one only comes out', () => {
    const [entry] = communityEntries(me,
      [{ pubkey: me, lineage: 'games/arkanoid', hosts: ['jwize.com'] }],
      [{ pubkey: them, lineage: 'arkanoid', hosts: ['dylan.com'] }],
      [{ pubkey: them, lineage: 'arkanoid' }])
    const mine = entry.versions.find(v => v.own)!
    const theirs = entry.versions.find(v => !v.own)!
    expect(communityPress(entry, mine)).toEqual({ pubkey: me, lineage: 'games/arkanoid', on: true, others: [{ pubkey: them, lineage: 'arkanoid' }] })
    expect(communityPress(entry, theirs)).toEqual({ pubkey: them, lineage: 'arkanoid', on: false, others: [] })
  })

  it('one name however it is written: "Business Card" and business-card are one entry, its two versions inside (jwize 2026-11-16: "two business-card entries")', () => {
    const entries = communityEntries(me,
      [{ pubkey: me, lineage: 'business-card', name: 'Business Card', hosts: ['jwize.com'] }],
      [],
      [{ pubkey: them, lineage: 'business-card' }])
    expect(entries).toHaveLength(1)
    expect(entries[0].versions).toHaveLength(2)
    expect(entries[0].live).toBe(true)
    expect(entries[0].versions.map(v => [v.pubkey === them, v.live, v.own])).toEqual([[true, true, false], [false, false, true]])
    expect(communityNameKey('Business Card')).toBe(communityNameKey('business-card'))
  })

  it('a creation is known by the last label of its lineage', () => {
    expect(lineageName('work/meetings')).toBe('meetings')
    expect(lineageName('solo')).toBe('solo')
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
