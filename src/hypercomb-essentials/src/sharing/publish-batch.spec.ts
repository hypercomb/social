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

import { driftedRows } from './publish-batch.js'

describe('driftedRows — only what was published and has moved on', () => {
  const row = (key: string, state: string, live: string | null, here: string | null, segments: string[] = [key]) =>
    ({ key, path: '/' + segments.join('/'), segments, state, live, here })

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
})
