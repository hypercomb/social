// @vitest-environment-options {"url": "https://swarm.hypercomb.com/"}
//
// swarm-door.spec.ts — the swarm door predicate. This file's page IS a swarm
// door (the environment URL above), so `isSwarmDoor()` answers for a real
// location — and it is NOT a sandbox door: it signs, it holds keys.

import { describe, expect, it } from 'vitest'
import { isSandboxDoor, isSwarmDoor, packageDoorOf, swarmDoorOf } from './sandbox-door.js'

describe('swarmDoorOf', () => {
  it('reads swarm.<zone>, port ignored, *.localhost counted', () => {
    expect(swarmDoorOf('swarm.hypercomb.com')).toEqual({ label: 'swarm', zone: 'hypercomb.com' })
    expect(swarmDoorOf('Swarm.Jwize.com:443')).toEqual({ label: 'swarm', zone: 'jwize.com' })
    expect(swarmDoorOf('swarm.localhost:4251')).toEqual({ label: 'swarm', zone: 'localhost' })
  })

  it('is no other name', () => {
    for (const host of ['hypercomb.com', 'swarm', 'swarms.hypercomb.com', 'my-swarm.hypercomb.com', 'try-swarm.hypercomb.com', 'x.swarm.hypercomb.com']) {
      expect(swarmDoorOf(host)).toBeNull()
    }
  })
})

describe('packageDoorOf', () => {
  it('names both kinds of door, and nothing else', () => {
    expect(packageDoorOf('try-fix.hypercomb.com')).toEqual({ label: 'try-fix', zone: 'hypercomb.com', kind: 'sandbox' })
    expect(packageDoorOf('swarm.hypercomb.com')).toEqual({ label: 'swarm', zone: 'hypercomb.com', kind: 'swarm' })
    expect(packageDoorOf('hypercomb.com')).toBeNull()
    expect(packageDoorOf('cigars.jwize.com')).toBeNull()
  })
})

describe('on a swarm door', () => {
  it('this page is a swarm door and not a sandbox', () => {
    expect(isSwarmDoor()).toBe(true)
    expect(isSandboxDoor()).toBe(false)
  })
})
