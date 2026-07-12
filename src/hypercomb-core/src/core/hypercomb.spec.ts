// hypercomb-core/src/core/hypercomb.spec.ts
//
// The processor's pulse loop must never explode on a pulse-less module
// product. Bee bundles legitimately register constructor-wired values with
// no pulse method (EventTarget UI drones, plain services) — one such entry
// reaching the loop unguarded threw `bee.pulse is not a function`, which
// silenced every bee after it in cache order and broke every act() in the
// web shell (tiles committed but the pulse cycle died mid-flight).

import { describe, expect, it } from 'vitest'
import { register } from '../ioc/ioc.js'
import { BEE_RESOLVER_KEY } from './bee-resolver.js'
import { hypercomb } from './hypercomb.js'

describe('hypercomb.act', () => {
  it('skips pulse-less entries and still pulses every bee after them', async () => {
    const pulsed: string[] = []
    const bee = (name: string) => ({ pulse: async () => { pulsed.push(name) } })
    const pulseless = { iocKey: '@test.com/PlainService' }   // constructor-wired product, no pulse

    register(BEE_RESOLVER_KEY, {
      find: async () => [bee('first'), pulseless, bee('second')],
    })

    let synchronized = 0
    window.addEventListener('synchronize', () => { synchronized++ })

    await expect(new hypercomb().act('')).resolves.toBeUndefined()
    expect(pulsed).toEqual(['first', 'second'])
    expect(synchronized).toBe(1)
  })
})
