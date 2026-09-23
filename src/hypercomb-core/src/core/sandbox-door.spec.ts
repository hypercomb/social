// @vitest-environment-options {"url": "https://try-fix-zoom.hypercomb.com/"}
//
// sandbox-door.spec.ts — the one door predicate, and what the key store does
// at a door. This file's page IS a door (the environment URL above), so
// `isSandboxDoor()` answers for a real location, not a stub.

import { beforeEach, describe, expect, it } from 'vitest'
import { isSandboxDoor, isSandboxLabel, sandboxDoorOf } from './sandbox-door.js'
import { LlmKeyStore } from './llm-keys.js'

describe('sandboxDoorOf', () => {
  it('reads the label and the zone of a door', () => {
    expect(sandboxDoorOf('try-fix-zoom.hypercomb.com')).toEqual({ label: 'try-fix-zoom', zone: 'hypercomb.com' })
    expect(sandboxDoorOf('TRY-Fix-Zoom.Hypercomb.com')).toEqual({ label: 'try-fix-zoom', zone: 'hypercomb.com' })
  })

  it('keeps the port out of the zone, and opens on *.localhost', () => {
    expect(sandboxDoorOf('try-x.localhost:4291')).toEqual({ label: 'try-x', zone: 'localhost' })
    expect(sandboxDoorOf('try-x.hive.localhost')).toEqual({ label: 'try-x', zone: 'hive.localhost' })
  })

  it('is not a door anywhere else', () => {
    for (const host of ['hypercomb.io', 'localhost', 'try-x', 'try-.hypercomb.com', 'try--x-.hypercomb.com', 'trying.hypercomb.com',
      'www.try-x.hypercomb.com', 'try_x.hypercomb.com', 'x-try-y.hypercomb.com', '']) {
      expect(sandboxDoorOf(host), host).toBeNull()
    }
  })

  it('holds the host\'s label rule: 1–57 characters after try-, alphanumeric at both ends', () => {
    expect(isSandboxLabel('try-a')).toBe(true)
    expect(isSandboxLabel(`try-${'a'.repeat(57)}`)).toBe(true)
    expect(isSandboxLabel(`try-${'a'.repeat(58)}`)).toBe(false)
    expect(isSandboxLabel('try-a-')).toBe(false)
    expect(isSandboxLabel('TRY-A')).toBe(false)
  })

  it('knows this page is a door', () => {
    expect(isSandboxDoor()).toBe(true)
  })
})

describe('LlmKeyStore at a door', () => {
  beforeEach(() => localStorage.clear())

  it('stores nothing typed here', () => {
    const store = new LlmKeyStore()
    store.set('openai', 'sk-typed-at-a-door')
    expect(localStorage.getItem('hc:llm:openai:key')).toBeNull()
    expect(store.get('openai')).toBe('')
  })

  it('reads back nothing already held here', () => {
    localStorage.setItem('hc:llm:anthropic:key', 'sk-held')
    const store = new LlmKeyStore()
    expect(store.get('anthropic')).toBe('')
    expect(store.has('anthropic')).toBe(false)
    expect(store.configured()).toEqual([])
  })
})
