import { describe, expect, it } from 'vitest'
import { publishOwnedProjection } from './derived-projection-cache.js'

describe('publishOwnedProjection', () => {
  it('rejects an async result that finishes after navigation', async () => {
    const live = new Map<string, string | null>([['howard', 'good-image-sig']])
    let release!: () => void
    const delayed = new Promise<void>(resolve => { release = resolve })
    const late = (async () => {
      await delayed
      return publishOwnedProjection({
        owner: '/old-page',
        currentOwner: '/new-page',
        prepareOnly: false,
        source: new Map([['howard', null]]),
        target: live,
        labels: ['howard'],
        preserveResolvedOnNull: true,
      })
    })()

    release()
    expect(await late).toBe(false)
    expect(live.get('howard')).toBe('good-image-sig')
  })

  it('does not let a same-page transient miss erase a resolved signature', () => {
    const live = new Map<string, string | null>([['howard', 'good-image-sig']])
    publishOwnedProjection({
      owner: '/page', currentOwner: '/page', prepareOnly: false,
      source: new Map([['howard', null]]), target: live, labels: ['howard'],
      preserveResolvedOnNull: true,
    })
    expect(live.get('howard')).toBe('good-image-sig')
  })

  it('allows an explicit invalidation to settle as no image', () => {
    const live = new Map<string, string | null>([['howard', 'old-image-sig']])
    live.delete('howard')
    publishOwnedProjection({
      owner: '/page', currentOwner: '/page', prepareOnly: false,
      source: new Map([['howard', null]]), target: live, labels: ['howard'],
      preserveResolvedOnNull: true,
    })
    expect(live.get('howard')).toBeNull()
  })

  it('never publishes an off-screen preparation', () => {
    const live = new Map<string, string | null>([['howard', 'good-image-sig']])
    const committed = publishOwnedProjection({
      owner: '/page', currentOwner: '/page', prepareOnly: true,
      source: new Map([['howard', null]]), target: live, labels: ['howard'],
      preserveResolvedOnNull: true,
    })
    expect(committed).toBe(false)
    expect(live.get('howard')).toBe('good-image-sig')
  })
})
