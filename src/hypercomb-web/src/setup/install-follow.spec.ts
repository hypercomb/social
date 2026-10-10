// install-follow.spec.ts — whom a shell with nothing installed follows.
//
// The cold shell carries its own copy of the publisher record; the update
// scout reads the package's. They must be the SAME record or a fresh install
// and its first update check follow two different publishers. stamp-install-
// channel.ts writes both; this fails the suite the moment they differ.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import SHIPPED from './install-publisher.json'
import { shellInstallFollow, verifyIndexEvent } from './install-follow'

const here = dirname(fileURLToPath(import.meta.url))
const SHELL_COPY = resolve(here, 'install-publisher.json')
const PACKAGE_RECORD = resolve(here, '..', '..', '..', 'hypercomb-essentials', 'src', 'sharing', 'install-publisher.json')

beforeEach(() => { localStorage.clear() })

describe('the shell\'s publisher record', () => {
  it('is byte-identical to the one the update scout ships with', () => {
    expect(readFileSync(SHELL_COPY, 'utf8')).toBe(readFileSync(PACKAGE_RECORD, 'utf8'))
  })

  it('follows the shipped publisher at the public install host when nothing is recorded', () => {
    expect(shellInstallFollow()).toEqual({ pubkey: SHIPPED.pubkey, hosts: ['hypercomb.com'], channel: 'essentials' })
  })

  it("follows nobody when the participant said 'off'", () => {
    localStorage.setItem('hc:install-follow', 'off')
    expect(shellInstallFollow()).toBeNull()
  })
})

describe('verifyIndexEvent', () => {
  it('accepts a real signature and refuses a tampered event', async () => {
    // As it arrives: parsed off the wire. (A signed object carries nostr-tools'
    // own "already verified" mark, which a spread would copy onto a forgery.)
    const wire = (): Record<string, unknown> => JSON.parse(JSON.stringify(
      finalizeEvent({ kind: 30564, created_at: 1, tags: [], content: '{"v":1,"roots":{}}' }, generateSecretKey())))
    expect(await verifyIndexEvent(wire())).toBe(true)
    expect(await verifyIndexEvent({ ...wire(), content: '{"v":1,"roots":{"install:essentials":"x"}}' })).toBe(false)
  })
})
