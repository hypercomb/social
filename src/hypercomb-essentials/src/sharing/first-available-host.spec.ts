import { describe, expect, it } from 'vitest'
import { firstAvailableHost } from './first-available-host.js'

describe('bounded host discovery', () => {
  it('keeps at most three probes active and advances after misses', async () => {
    let active = 0
    let peak = 0
    const called: string[] = []
    const result = await firstAvailableHost(['a', 'b', 'c', 'd', 'e'], async host => {
      active++
      peak = Math.max(peak, active)
      called.push(host)
      await Promise.resolve()
      active--
      return host === 'e' ? 'bytes' : null
    })
    expect(result).toBe('bytes')
    expect(peak).toBe(3)
    expect(called).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(active).toBe(0)
  })

  it('returns null for empty discovery and for exhausted or throwing hosts', async () => {
    expect(await firstAvailableHost([], async () => 'unused')).toBeNull()
    expect(await firstAvailableHost(['a', 'b'], async host => {
      if (host === 'a') throw new Error('offline')
      return null
    })).toBeNull()
  })
})
