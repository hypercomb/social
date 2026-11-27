// core/invite-capture.post.spec.ts — AN ENTRY POOL'S CODE IS ANNOUNCED AND
// LEFT IN THE ADDRESS BAR (documentation/open-entry-pools.md, "The page a
// phone sees", step 1). Its own file: the capture runs once at import and
// listens on this window once.

import { describe, expect, it } from 'vitest'
import { EffectBus, POST_CODE_EFFECT, type PostCode } from '@hypercomb/core'

const O = '3f'.repeat(32)
const NONCE = '0a'.repeat(16)
const CODE = `#post=${O}~${NONCE}`
const O2 = '7c'.repeat(32)
const NONCE2 = 'e1'.repeat(16)

;(window as unknown as { ioc: unknown }).ioc = { get: () => undefined }

// The phone opened the leader's page with the code: it is there before the shell boots.
window.history.replaceState(null, '', `/${CODE}`)
await import('./invite-capture')

const heard: PostCode[] = []
// Subscribed after boot, as the sleeping bee is: the stored announcement replays.
EffectBus.on<PostCode>(POST_CODE_EFFECT, code => { if (code) heard.push(code) })

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20))

describe('a code in the address bar', () => {
  it('is announced at boot, with its two parts, to a bee that wakes later', () => {
    expect(heard).toEqual([{ record: O, nonce: NONCE }])
  })

  it('stays in the address bar, so a reload comes back to the form', () => {
    expect(window.location.hash).toBe(CODE)
    expect(sessionStorage.length).toBe(0)
  })

  it('a code scanned in a tab already on the page is announced on the fragment change, and stays', async () => {
    window.location.hash = `#post=${O2}~${NONCE2}`
    await settle()
    expect(heard.at(-1)).toEqual({ record: O2, nonce: NONCE2 })
    expect(window.location.hash).toBe(`#post=${O2}~${NONCE2}`)
  })

  it('a fragment that is nearly a code is not announced and is left alone', async () => {
    const before = heard.length
    for (const fragment of [`#post=${O.toUpperCase()}~${NONCE}`, `#post=${O}`, `#post=${O}~${NONCE}x`]) {
      window.location.hash = fragment
      await settle()
      expect(window.location.hash, fragment).toBe(fragment)
    }
    expect(heard).toHaveLength(before)
  })
})
