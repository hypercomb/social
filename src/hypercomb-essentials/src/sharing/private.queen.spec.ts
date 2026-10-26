// private.queen.spec.ts — the word reads keys, refuses what is not one, and asks before it seals.

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { ioc: unknown }).ioc = { register: () => {}, get: () => undefined, whenReady: () => {} }
})

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { npubEncode } from 'nostr-tools/nip19'
import { memberKey, parsePrivateWord } from './private.queen.js'

const key = getPublicKey(generateSecretKey())

describe('private — reading the line', () => {
  it('reads a hex key as it is, and an npub as the hex it stands for', async () => {
    expect(await memberKey(key)).toBe(key)
    expect(await memberKey(key.toUpperCase())).toBe(key)
    expect(await memberKey(npubEncode(key))).toBe(key)
  })

  it('does not read anything else as a key', async () => {
    expect(await memberKey('alice')).toBeNull()
    expect(await memberKey('npub1notreal')).toBeNull()
    expect(await memberKey(key.slice(1))).toBeNull()
  })

  it('shows with nothing, turns off with off, and seals to every key it can read, naming the ones it cannot', async () => {
    expect(await parsePrivateWord('')).toEqual({ form: 'show' })
    expect(await parsePrivateWord('off')).toEqual({ form: 'off' })
    expect(await parsePrivateWord(`${key} ${npubEncode(key)} alice`)).toEqual({ form: 'seal', members: [key], unknown: ['alice'] })
  })
})
