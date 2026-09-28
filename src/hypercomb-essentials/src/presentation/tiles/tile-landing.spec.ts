// tile-landing.spec.ts — THE WRITE LANDS, THE PAINT WAITS, on its own. Inside
// the producer's window a render is held and counted; the badge shows WRITES,
// not paints; the chain of consequences after the window stays held until it
// has been quiet for a beat; walking somewhere else always paints; the tap
// releases only what was actually held; and a paint that is not a render
// request can ask whether it would be held without being counted.
import { describe, expect, it } from 'vitest'

import { QuietLanding, type LandingHost } from './tile-landing.js'

const hostAt = (where: string) => {
  const here = { where }
  const pending: { count: number; where: string }[] = []
  const host: LandingHost & { here: typeof here; pending: typeof pending } = {
    here, pending,
    where: () => here.where,
    emit: (_effect, payload) => { pending.push(payload as { count: number; where: string }) },
  }
  return host
}

describe('quiet landing', () => {
  it('runs every render while nothing is landing', () => {
    const host = hostAt('/home')
    const landing = new QuietLanding(host)
    expect(landing.admit(1000)).toBe('run')
    expect(landing.holding).toBe(false)
    expect(host.pending).toEqual([])
  })

  it('holds inside the window and shows the producer\'s WRITES, not the paints', () => {
    const host = hostAt('/home')
    const landing = new QuietLanding(host)
    landing.quiet(true, 12)
    expect(landing.admit(1000)).toBe('hold')
    expect(landing.admit(1010)).toBe('hold')
    expect(host.pending.at(-1)).toEqual({ count: 12, where: '/home' })
    expect(landing.holding).toBe(true)
    // Without a tally, the held paints are the best count there is.
    const bareHost = hostAt('/home')
    const bare = new QuietLanding(bareHost)
    bare.quiet(true, 0)
    bare.admit(1); bare.admit(2)
    expect(bareHost.pending.at(-1)).toEqual({ count: 2, where: '/home' })
  })

  it('keeps holding the chain after the window, then spends once it has been quiet', () => {
    const host = hostAt('/home')
    const landing = new QuietLanding(host)
    landing.quiet(true, 3)
    landing.admit(1000)
    // The close reports zero writes: the badge still owed is kept.
    landing.quiet(false, 0)
    expect(landing.admit(1500)).toBe('hold')
    expect(host.pending.at(-1)).toEqual({ count: 3, where: '/home' })
    expect(landing.admit(1500 + 1600)).toBe('spend')
    expect(host.pending.at(-1)).toEqual({ count: 0, where: '/home' })
    expect(landing.admit(1500 + 1700)).toBe('run')
  })

  it('walking somewhere else always paints, and spends the badge', () => {
    const host = hostAt('/home')
    const landing = new QuietLanding(host)
    landing.quiet(true, 1)
    landing.admit(1000)
    landing.quiet(false, 0)
    host.here.where = '/garden'
    expect(landing.admit(1100)).toBe('spend')
  })

  it('answers whether a paint would be held without counting it', () => {
    const host = hostAt('/home')
    const landing = new QuietLanding(host)
    expect(landing.wouldHold(1000)).toBe(false)
    landing.quiet(true, 1)
    expect(landing.wouldHold(1000)).toBe(true)
    expect(host.pending).toEqual([])
    expect(landing.holding).toBe(false)
    // The chain after the window: held while cascading at the same place only.
    landing.admit(1000)
    landing.quiet(false, 0)
    expect(landing.wouldHold(1500)).toBe(true)
    host.here.where = '/garden'
    expect(landing.wouldHold(1500)).toBe(false)
    host.here.where = '/home'
    expect(landing.wouldHold(1000 + 1600)).toBe(false)
    expect(host.pending).toHaveLength(1)
  })

  it('the tap releases only what was held', () => {
    const landing = new QuietLanding(hostAt('/home'))
    expect(landing.apply()).toBe(false)
    landing.quiet(true, 2)
    landing.admit(1000)
    expect(landing.apply()).toBe(true)
    // The window is closed by the tap; once the chain has been quiet the pass runs and spends.
    expect(landing.admit(1000 + 2000)).toBe('spend')
  })
})
