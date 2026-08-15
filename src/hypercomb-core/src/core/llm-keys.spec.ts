// llm-keys.spec.ts — the storage scheme, the legacy drain, and the roster.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  LEGACY_ANTHROPIC_KEY_STORAGE,
  LlmKeyStore,
  isLlmKeyStorageKey,
  llmKeyStorageKey,
  providerIdOfStorageKey,
} from './llm-keys.js'

describe('llm key storage scheme', () => {
  it('spells a provider key as hc:llm:<id>:key', () => {
    expect(llmKeyStorageKey('openai')).toBe('hc:llm:openai:key')
    expect(llmKeyStorageKey(' Anthropic ')).toBe('hc:llm:anthropic:key')
  })

  it('recognises its own keys and the legacy slot, and nothing else', () => {
    expect(isLlmKeyStorageKey('hc:llm:google:key')).toBe(true)
    expect(isLlmKeyStorageKey(LEGACY_ANTHROPIC_KEY_STORAGE)).toBe(true)
    expect(isLlmKeyStorageKey('hc:secret')).toBe(false)
    expect(isLlmKeyStorageKey('hc:llm:local:host')).toBe(false)
  })

  it('reads the provider back out of a storage key', () => {
    expect(providerIdOfStorageKey('hc:llm:xai:key')).toBe('xai')
    expect(providerIdOfStorageKey(LEGACY_ANTHROPIC_KEY_STORAGE)).toBe('anthropic')
    expect(providerIdOfStorageKey('hc:secret')).toBe('')
  })
})

describe('LlmKeyStore', () => {
  beforeEach(() => localStorage.clear())

  it('starts empty', () => {
    expect(new LlmKeyStore().configured()).toEqual([])
  })

  it('stores a key under the scheme and reports it configured', () => {
    const store = new LlmKeyStore()
    store.set('openai', 'sk-test-123')
    expect(store.get('openai')).toBe('sk-test-123')
    expect(store.has('openai')).toBe(true)
    expect(store.configured()).toEqual(['openai'])
    expect(localStorage.getItem('hc:llm:openai:key')).toBe('sk-test-123')
  })

  it('sorts the roster so indicators do not reshuffle', () => {
    const store = new LlmKeyStore()
    store.set('openai', 'a')
    store.set('anthropic', 'b')
    store.set('google', 'c')
    expect(store.configured()).toEqual(['anthropic', 'google', 'openai'])
  })

  it('reads the legacy anthropic key as if it were in the scheme', () => {
    localStorage.setItem(LEGACY_ANTHROPIC_KEY_STORAGE, 'sk-ant-legacy')
    const store = new LlmKeyStore()
    expect(store.get('anthropic')).toBe('sk-ant-legacy')
    expect(store.configured()).toEqual(['anthropic'])
  })

  it('never WRITES the legacy key — a set lands in the scheme', () => {
    localStorage.setItem(LEGACY_ANTHROPIC_KEY_STORAGE, 'sk-ant-legacy')
    const store = new LlmKeyStore()
    store.set('anthropic', 'sk-ant-new')
    expect(localStorage.getItem('hc:llm:anthropic:key')).toBe('sk-ant-new')
    expect(localStorage.getItem(LEGACY_ANTHROPIC_KEY_STORAGE)).toBe('sk-ant-legacy')
    expect(store.get('anthropic')).toBe('sk-ant-new')
  })

  it('prefers the scheme over the legacy slot on load', () => {
    localStorage.setItem(LEGACY_ANTHROPIC_KEY_STORAGE, 'sk-ant-legacy')
    localStorage.setItem('hc:llm:anthropic:key', 'sk-ant-new')
    expect(new LlmKeyStore().get('anthropic')).toBe('sk-ant-new')
  })

  it('clear drains the legacy slot too — a cleared key must not stay readable', () => {
    localStorage.setItem(LEGACY_ANTHROPIC_KEY_STORAGE, 'sk-ant-legacy')
    const store = new LlmKeyStore()
    store.set('anthropic', 'sk-ant-new')
    store.clear('anthropic')
    expect(store.get('anthropic')).toBe('')
    expect(store.configured()).toEqual([])
    expect(localStorage.getItem(LEGACY_ANTHROPIC_KEY_STORAGE)).toBeNull()
    expect(localStorage.getItem('hc:llm:anthropic:key')).toBeNull()
  })

  it('treats an empty set as a clear', () => {
    const store = new LlmKeyStore()
    store.set('google', 'AIza-test')
    store.set('google', '   ')
    expect(store.has('google')).toBe(false)
  })

  it('announces change without carrying the key in the event', () => {
    const store = new LlmKeyStore()
    const events: Event[] = []
    store.addEventListener('change', e => events.push(e))
    store.set('xai', 'xai-secret')
    expect(events).toHaveLength(1)
    expect((events[0] as CustomEvent).detail ?? null).toBeNull()
  })
})
