import { describe, expect, it } from 'vitest'
import {
  GATHERS_KIND,
  buildGathersPayload,
  groupOfRecord,
  pageOfPoolRecord,
  readTargetState,
  withTarget,
} from './gather-link.js'

describe('gather link records', () => {
  it('carries only the group ROUTE — no 64-hex for a closure to mistake for bytes', () => {
    expect(buildGathersPayload([' people ', ''])).toEqual({ groupSegments: ['people'] })
    expect(JSON.stringify(buildGathersPayload(['people']))).not.toMatch(/[0-9a-f]{64}/)
  })

  it('reads a group back only from a well-formed gathers record', () => {
    expect(groupOfRecord({ kind: GATHERS_KIND, payload: { groupSegments: ['nest', 'people'] } })).toEqual(['nest', 'people'])
    expect(groupOfRecord({ kind: 'reference', payload: { groupSegments: ['people'] } })).toBeNull()
    expect(groupOfRecord({ kind: GATHERS_KIND, payload: { groupSegments: [] } })).toBeNull()
    // A peer's number must not become a group named "3".
    expect(groupOfRecord({ kind: GATHERS_KIND, payload: { groupSegments: [3] } })).toBeNull()
    expect(pageOfPoolRecord({ pageSegments: ['friends'] })).toEqual(['friends'])
    expect(pageOfPoolRecord({ pageSegments: [null] })).toBeNull()
  })
})

describe('target on/off state', () => {
  it('switches one target without touching the others, and forgets an all-off group', () => {
    let state = withTarget({}, 'g', 'friends', true)
    state = withTarget(state, 'g', 'family', true)
    expect(state).toEqual({ g: ['friends', 'family'] })
    state = withTarget(state, 'g', 'friends', false)
    expect(state).toEqual({ g: ['family'] })
    state = withTarget(state, 'g', 'family', false)
    expect(state).toEqual({})
  })

  it('reads stored state defensively', () => {
    expect(readTargetState(null)).toEqual({})
    expect(readTargetState('not json')).toEqual({})
    expect(readTargetState('[1,2]')).toEqual({})
    expect(readTargetState('{"g":["friends","friends",3,""],"h":"x"}')).toEqual({ g: ['friends'] })
  })
})

describe('what a page\'s own copy would lose', () => {
  it('lists only what the COPY holds that the group\'s tile does not, in words', async () => {
    const { differingSlots } = await import('./gather-link.js')
    expect(differingSlots({ name: 'susan' }, { name: 'susan', notes: ['n'] })).toEqual([])
    expect(differingSlots({ name: 'susan', notes: ['a'] }, { name: 'susan', notes: ['a'] })).toEqual([])
    expect(differingSlots({ name: 'susan', notes: ['a'], properties: ['p'] }, { name: 'susan', notes: ['b'] }))
      .toEqual(['notes', 'picture'])
    expect(differingSlots({ name: 'susan', children: ['c'], decorations: ['d'], odd: ['x'] }, null))
      .toEqual(['tiles', 'marks', 'other'])
    expect(differingSlots({ name: 'susan', notes: [] }, { name: 'susan' })).toEqual([])
  })
})
