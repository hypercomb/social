// participant-features.spec.ts — the pool's members name features as their
// layers are named, and the published snapshot is the same bytes for the
// same set.

import { describe, expect, it } from 'vitest'
import { featureArtifactSig, featureName, featureRecord, participantSnapshot } from './participant-features'

describe('participant features', () => {
  it('names a feature as its layer is named, and refuses anything else', () => {
    expect(featureName(' Assistant ')).toBe('assistant')
    expect(featureName('revolucionstyle.com')).toBe('revolucionstyle.com')
    expect(featureName('../etc')).toBe('')
    expect(featureName('')).toBe('')
  })

  it('a member is an artifact named by its own content — the same feature, the same member', async () => {
    expect(featureRecord('editor')).toEqual({ kind: 'visual:feature:artifact', meaning: 'feature:editor', payload: { feature: 'editor' } })
    expect(await featureArtifactSig('editor')).toBe(await featureArtifactSig('editor'))
    expect(await featureArtifactSig('editor')).not.toBe(await featureArtifactSig('move'))
  })

  it('the snapshot is the sorted, unique set — order and repeats do not change it', async () => {
    const a = participantSnapshot(['move', 'assistant', 'move'])
    const b = participantSnapshot(['assistant', 'move'])
    expect(new TextDecoder().decode(a.bytes)).toBe('{"features":["assistant","move"]}')
    expect(await a.sigOf()).toBe(await b.sigOf())
  })
})
