import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { protectOriginStorage, STORAGE_PERSISTENCE_STATUS_KEY } from './storage-persistence'

class FakeEvents {
  readonly listeners = new Map<string, Set<EventListener>>()
  readonly reports: Event[] = []

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatchEvent(event: Event): boolean {
    this.reports.push(event)
    return true
  }

  interact(type: 'pointerdown' | 'keydown', trusted = true): void {
    const event = { isTrusted: trusted } as Event
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }
}

describe('protectOriginStorage', () => {
  it('reports an existing persistent grant without adding interaction listeners', async () => {
    const events = new FakeEvents()
    const statuses: string[] = []

    const result = await protectOriginStorage({
      storage: {
        persisted: async () => true,
        persist: async () => true,
      },
      events,
      statusStore: {
        setItem: (key, value) => {
          assert.equal(key, STORAGE_PERSISTENCE_STATUS_KEY)
          statuses.push(JSON.parse(value).state)
        },
      },
      now: () => new Date('2026-07-29T12:00:00.000Z'),
    })

    assert.equal(result, 'persistent')
    assert.deepEqual(statuses, ['persistent'])
    assert.equal(events.listeners.size, 0)
  })

  it('requests persistence once, inside the first trusted interaction', async () => {
    const events = new FakeEvents()
    const statuses: string[] = []
    let requests = 0

    const result = await protectOriginStorage({
      storage: {
        persisted: async () => false,
        persist: async () => {
          requests++
          return true
        },
      },
      events,
      statusStore: {
        setItem: (_key, value) => statuses.push(JSON.parse(value).state),
      },
      now: () => new Date('2026-07-29T12:00:00.000Z'),
    })

    assert.equal(result, 'best-effort')
    assert.equal(requests, 0)

    events.interact('pointerdown', false)
    assert.equal(requests, 0)

    events.interact('pointerdown')
    await Promise.resolve()
    events.interact('keydown')

    assert.equal(requests, 1)
    assert.deepEqual(statuses, ['best-effort', 'persistent'])
    assert.equal(events.listeners.get('pointerdown')?.size, 0)
    assert.equal(events.listeners.get('keydown')?.size, 0)
  })

  it('records a denial as best-effort without repeatedly prompting', async () => {
    const events = new FakeEvents()
    const statuses: string[] = []
    let requests = 0

    await protectOriginStorage({
      storage: {
        persisted: async () => false,
        persist: async () => {
          requests++
          return false
        },
      },
      events,
      statusStore: {
        setItem: (_key, value) => statuses.push(JSON.parse(value).state),
      },
      warn: () => {},
    })

    events.interact('keydown')
    await Promise.resolve()
    events.interact('pointerdown')

    assert.equal(requests, 1)
    assert.deepEqual(statuses, ['best-effort', 'best-effort'])
  })
})
