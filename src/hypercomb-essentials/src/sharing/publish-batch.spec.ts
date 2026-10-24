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
