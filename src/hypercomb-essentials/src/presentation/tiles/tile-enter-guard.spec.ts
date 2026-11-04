import { describe, expect, it } from 'vitest'
import { judgeEntry, pendingStillValid } from './tile-enter-guard.js'

describe('tile enter guard', () => {
  it('enters when the maps were painted for the live address', () => {
    expect(judgeEntry('/play/funding', '/play/funding')).toBe('enter')
    expect(judgeEntry('/', '/')).toBe('enter')
  })

  it('drops a press whose maps belong to the level being left', () => {
    // the reported corruption: /…/people → /…/people/people
    expect(judgeEntry('/misc', '/misc/people')).toBe('drop')
    expect(judgeEntry('/misc/people', '/misc')).toBe('drop')
    // the root must not vouch for a deeper level
    expect(judgeEntry('/', '/misc')).toBe('drop')
  })

  it('defers when the render could not say where it painted', () => {
    expect(judgeEntry(null, '/misc')).toBe('defer')
    expect(judgeEntry(null, '/')).toBe('defer')
  })

  it('has no opinion when no render has reported a location', () => {
    expect(judgeEntry(undefined, '/misc')).toBe('enter')
  })

  it('replays a queued press only where it was made', () => {
    const pending = { label: 'people', at: '/misc' }
    expect(pendingStillValid(pending, '/misc')).toBe(true)
    expect(pendingStillValid(pending, '/funding')).toBe(false)
  })
})
