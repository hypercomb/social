import { describe, expect, it } from 'vitest'
import { batchOrder } from './publish-batch.js'

const row = (path: string, segments = path.split('/').filter(Boolean)) => ({ key: segments.join('/') || path, path, segments })

describe('publishing the selected, one at a time', () => {
  it('runs each named row once, deepest first, ancestors last', () => {
    const rows = [row('/revolucion'), row('/revolucion/meetup'), row('/hosting'), row('/revolucion/meetup/night-1'), row('/meetups')]
    expect(batchOrder(rows, ['revolucion', 'revolucion/meetup/night-1', 'hosting', 'revolucion/meetup', 'hosting']).map(r => r.path))
      .toEqual(['/revolucion/meetup/night-1', '/revolucion/meetup', '/hosting', '/revolucion'])
  })

  it('never names a row it was not given, nor one this hive cannot seal', () => {
    const elsewhere = { key: 'elsewhere', path: 'elsewhere', segments: [] as string[] }
    expect(batchOrder([row('/a'), elsewhere], ['elsewhere', 'missing'])).toEqual([])
    expect(batchOrder([row('/a'), row('/b')], ['b']).map(r => r.key)).toEqual(['b'])
  })
})

import { driftedElsewhere, driftedRows, mayPublishOver, sealedHere } from './publish-batch.js'

describe('driftedRows — only what was published and has moved on', () => {
  // By default the live head is one this hive published (its ledger names it).
  const row = (key: string, state: string, live: string | null, here: string | null, segments: string[] = [key], versions = live ? [{ sig: live }] : []) =>
    ({ key, path: '/' + segments.join('/'), segments, state, live, here, versions })

  it('picks a row whose verified index names a head and whose head here differs', () => {
    const rows = [row('a', 'drift', 'x'.repeat(64), 'y'.repeat(64)), row('b', 'live', 'x'.repeat(64), 'x'.repeat(64))]
    expect(driftedRows(rows).map(r => r.key)).toEqual(['a'])
  })

  it('never picks something never published, unreadable, withdrawn, or already live', () => {
    const rows = [
      row('never', 'unpublished', null, 'y'.repeat(64)), row('cold', 'unknown', 'x'.repeat(64), null),
      row('gone', 'gone', 'x'.repeat(64), 'y'.repeat(64)), row('pending', 'pending', 'x'.repeat(64), 'y'.repeat(64)),
      row('same', 'drift', 'x'.repeat(64), 'x'.repeat(64)), row('root', 'drift', 'x'.repeat(64), 'y'.repeat(64), []),
    ]
    expect(driftedRows(rows)).toEqual([])
  })

  it('never republishes a head another device put there — the older card would go back over it', () => {
    const mine = 'a'.repeat(64), theirs = 'b'.repeat(64), here = 'c'.repeat(64)
    const moved = row('card', 'drift', theirs, here, ['card'], [{ sig: mine }])
    const ours = row('notes', 'drift', mine, here, ['notes'], [{ sig: here }, { sig: mine }])
    const unknown = row('lost', 'drift', theirs, here, ['lost'], [])
    expect(driftedRows([moved, ours, unknown]).map(r => r.key)).toEqual(['notes'])
    expect(driftedElsewhere([moved, ours, unknown]).map(r => r.key)).toEqual(['card', 'lost'])
  })

  it('a head this hive took is its own past: once the branch moves on here, it is republished, never offered to take again', () => {
    const taken = 'b'.repeat(64), here = 'c'.repeat(64)
    const row2 = { ...row('card', 'drift', taken, here, ['card'], []), taken }
    expect(driftedRows([row2]).map(r => r.key)).toEqual(['card'])
    expect(driftedElsewhere([row2])).toEqual([])
    // A receipt naming another head says nothing about this one.
    expect(driftedElsewhere([{ ...row2, taken: 'd'.repeat(64) }]).map(r => r.key)).toEqual(['card'])
  })

  it('a head this hive sealed under another key is still its own: two branches that seal alike share one ledger record', () => {
    const same = 'a'.repeat(64), here = 'c'.repeat(64)
    // The ledger's one record for `same` names the second branch's key, not this one's.
    const ledger = [{ sealed: same, record: { pubkey: 'p'.repeat(64), lineageKey: 'second/card' } }, { sealed: 'd'.repeat(64), record: { pubkey: 'q'.repeat(64), lineageKey: 'first/card' } }]
    const mine = sealedHere(ledger, 'p'.repeat(64))
    expect([...mine]).toEqual([same])
    const first = { ...row('first/card', 'drift', same, here, ['first', 'card'], []), sealedHere: mine.has(same) }
    expect(driftedRows([first]).map(r => r.key)).toEqual(['first/card'])
    expect(driftedElsewhere([first])).toEqual([])
    // Another publisher's record never makes a head this hive's own.
    expect(sealedHere(ledger, 'q'.repeat(64)).has(same)).toBe(false)
  })
})

describe('a head published elsewhere is never pushed back over by one row', () => {
  it('the single-row run (publish:run, the door switch, Make live) refuses a row driftedElsewhere names unless a hand says yes, before anything seals', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const drone = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing', 'publish-status.drone.ts'), 'utf8')
    const start = drone.indexOf('  async #run(key: string')
    expect(start).toBeGreaterThan(-1)
    const run = drone.slice(start, drone.indexOf('\n  }\n', start))
    // A batched run never asks (it is the bulk path, which leaves such rows out); one row asks a hand.
    expect(run).toContain('const over = batched ? driftedElsewhere([row]).length === 0 : await mayPublishOver(row,')
    const guard = run.indexOf('if (!over) {')
    expect(guard).toBeGreaterThan(-1)
    expect(run.slice(guard, run.indexOf('\n    }\n', guard))).toMatch(/\n      return null$/)
    // Before the row is staged, sealed or its index re-signed.
    for (const later of ["row.busyPhase = 'staging'", 'publishBranch(']) {
      expect(run.indexOf(later), later).toBeGreaterThan(guard)
    }
  })
})

describe('mayPublishOver — one row published elsewhere is never locked out', () => {
  const live = 'x'.repeat(64), here = 'y'.repeat(64)
  const row = (versions: { sig: string }[], taken: string | null = null) =>
    ({ key: 'card', path: '/card', segments: ['card'], state: 'drift', live, here, versions, taken })

  it('publishes a row this hive put out without asking', async () => {
    let asked = 0
    expect(await mayPublishOver(row([{ sig: live }]), async () => { asked++; return false })).toBe(true)
    expect(asked).toBe(0)
  })

  it('asks a hand for a row published elsewhere, every time, and goes only on a yes', async () => {
    let asked = 0
    const away = row([])
    expect(await mayPublishOver(away, async () => { asked++; return true })).toBe(true)
    expect(await mayPublishOver(away, async () => { asked++; return false })).toBe(false)
    expect(await mayPublishOver(away, async () => { asked++; throw new Error('closed') })).toBe(false)
    expect(asked).toBe(3)
    // Still left out of every bulk run.
    expect(driftedRows([away])).toEqual([])
  })
})
