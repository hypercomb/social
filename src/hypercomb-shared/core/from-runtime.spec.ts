// hypercomb-shared/core/from-runtime.spec.ts — A BRIDGE THAT LEAVES WITH ITS
// OWNER AND SPEAKS ONLY WHEN THE VALUE MOVED.

import { describe, expect, it } from 'vitest'
import { computed, type DestroyRef } from '@angular/core'
import { fromRuntime } from './from-runtime'

const nextTick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** A DestroyRef that can be destroyed by hand. */
const owner = (): { ref: DestroyRef; destroy: () => void } => {
  const callbacks: (() => void)[] = []
  const ref = { onDestroy: (cb: () => void) => { callbacks.push(cb); return () => {} } } as unknown as DestroyRef
  return { ref, destroy: () => { for (const cb of callbacks) cb() } }
}

class Counter extends EventTarget {
  value = 0
  bump(): void { this.value++; this.dispatchEvent(new CustomEvent('change')) }
}

describe('fromRuntime', () => {
  it('reads once per burst, in the microtask after the events (the NG0100 rule)', async () => {
    const svc = new Counter()
    let reads = 0
    const n = fromRuntime(svc, () => { reads++; return svc.value }, 'change', { destroyRef: null })
    expect(n()).toBe(0)
    expect(reads).toBe(1)
    svc.bump(); svc.bump(); svc.bump(); svc.bump(); svc.bump()
    expect(n()).toBe(0)          // nothing flips inside the pass that dispatched
    await nextTick()
    expect(n()).toBe(5)
    expect(reads).toBe(2)        // one read for five events
  })

  it('wakes no consumer when the reading is the same value', async () => {
    const svc = new Counter()
    const n = fromRuntime(svc, () => svc.value, 'change', { destroyRef: null })
    let recomputes = 0
    const twice = computed(() => { recomputes++; return n() * 2 })
    expect(twice()).toBe(0)
    svc.dispatchEvent(new CustomEvent('change'))   // a change event, same value
    await nextTick()
    expect(twice()).toBe(0)
    expect(recomputes).toBe(1)
    svc.bump()
    await nextTick()
    expect(twice()).toBe(2)
    expect(recomputes).toBe(2)
  })

  it('takes a structural equality for getters that build a fresh value each read', async () => {
    const svc = new Counter()
    const list = fromRuntime(svc, () => Array.from({ length: svc.value }, (_, i) => i), 'change', {
      destroyRef: null,
      equal: (a, b) => a.length === b.length && a.every((x, i) => x === b[i]),
    })
    let recomputes = 0
    const size = computed(() => { recomputes++; return list().length })
    expect(size()).toBe(0)
    svc.dispatchEvent(new CustomEvent('change'))
    await nextTick()
    expect(size()).toBe(0)
    expect(recomputes).toBe(1)
  })

  it('removes its listener when its owner is destroyed', async () => {
    const svc = new Counter()
    const { ref, destroy } = owner()
    let reads = 0
    const n = fromRuntime(svc, () => { reads++; return svc.value }, 'change', { destroyRef: ref })
    svc.bump()
    await nextTick()
    expect(n()).toBe(1)
    destroy()
    svc.bump()
    await nextTick()
    expect(n()).toBe(1)
    expect(reads).toBe(2)
  })

  it('outside an injection context, with no owner given, listens for as long as the target lives', async () => {
    const svc = new Counter()
    const n = fromRuntime(svc, () => svc.value)
    svc.bump()
    await nextTick()
    expect(n()).toBe(1)
  })

  it('still answers the getter when there is no target', () => {
    const n = fromRuntime(undefined, () => 'fallback')
    expect(n()).toBe('fallback')
  })
})
