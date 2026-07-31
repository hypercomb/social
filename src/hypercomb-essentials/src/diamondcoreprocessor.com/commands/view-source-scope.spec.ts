import { describe, expect, it } from 'vitest'
import { viewSourceScope, viewSourceScopeFromArgs } from './view-source-scope.js'

describe('view source scope', () => {
  it('keeps existing declarations current-layer by default', () => {
    expect(viewSourceScope(undefined)).toBe('layer')
    expect(viewSourceScope('unexpected')).toBe('layer')
  })

  it('accepts the participant-facing scope vocabulary', () => {
    expect(viewSourceScopeFromArgs('current-layer')).toBe('layer')
    expect(viewSourceScopeFromArgs('hierarchical')).toBe('hierarchy')
    expect(viewSourceScopeFromArgs('all')).toBe('hierarchy')
  })
})
