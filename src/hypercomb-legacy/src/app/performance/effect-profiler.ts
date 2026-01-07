// app/performance/effect-profiler.ts
import { effect as ngEffect, EffectRef } from '@angular/core'

let counter = 0

export function effect<T>(
  fn: (onCleanup: (cleanupFn: () => void) => void) => void,
  options?: { allowSignalWrites?: boolean }
): EffectRef {
  const id = ++counter
  return ngEffect(onCleanup => {
    const start = performance.now()
    try {
      return fn(onCleanup)
    } finally {
      const dur = performance.now() - start
      console.log(`[effect #${id}] ran in ${dur.toFixed(2)}ms`)
    }
  }, options)
}