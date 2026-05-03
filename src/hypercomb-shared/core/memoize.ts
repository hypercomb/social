// hypercomb-shared/core/memoize.ts
//
// Decorator over project(): wraps a producer function so that its
// output is content-addressed and memoized. The wrapped function looks
// and behaves like the original — same inputs go in, same value comes
// out — but on the second call with the same inputs the producer is
// not invoked. The cached resource is loaded from Store and parsed.
//
//   const namesOf = memoize('names', async (sigs) => {
//     const out: string[] = []
//     for (const sig of sigs) {
//       const layer = await history.getLayerBySig(sig)
//       out.push(layer?.name ?? '')
//     }
//     return out
//   })
//
//   const names = await namesOf(parent.children)         // value
//   const sig   = await namesOf.sig(parent.children)     // projection sig
//
// Inputs accept the universal sig | sig[] form; expand() canonicalizes
// before keying so two callers — one passing the inline array, one
// passing the resource sig that resolves to the same array — share a
// cache slot.
//
// Producer key: any string. Two consumers using the same key share a
// cache; their producer functions are expected to compute the same
// thing for the same inputs. There is no version suffix — when the
// producer's code changes, its bee sig changes (in the merkle world
// where producers are content-addressed modules), which gives it a
// fresh keyspace automatically. Until bee-sig-as-producer-key is
// wired through the loader, bare strings are stable enough.
//
// Composes with itself: the value returned by one memoized producer
// can be the input to another (each value's bytes are stored, get a
// sig, and that sig can feed another memoize'd function). The merkle
// of optimizations builds itself.

import { Store } from './store'
import { project } from './projection'
import { expand } from './expand'

export type MemoizedFn<T> =
  & ((inputs: string | readonly string[]) => Promise<T>)
  & { sig: (inputs: string | readonly string[]) => Promise<string> }

/**
 * Wrap a producer with content-addressed memoization. Returns a
 * function that behaves like the producer but skips invocation on
 * repeated (canonicalized) inputs. The `.sig` companion returns the
 * projection sig for the same inputs without forcing a resource load.
 */
export const memoize = <T>(
  producerKey: string,
  produce: (inputs: readonly string[]) => Promise<T>,
): MemoizedFn<T> => {

  const sigOf = async (inputs: string | readonly string[]): Promise<string> => {
    const expanded = await expand(inputs)
    return project(producerKey, expanded, produce)
  }

  const valueOf = (async (inputs: string | readonly string[]): Promise<T> => {
    const sig = await sigOf(inputs)
    const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as Store | undefined
    if (!store) throw new Error('[memoize] Store not registered')
    const blob = await store.getResource(sig)
    if (!blob) throw new Error(`[memoize] resource missing for sig ${sig.slice(0, 12)}…`)
    return JSON.parse(await blob.text()) as T
  }) as MemoizedFn<T>

  valueOf.sig = sigOf
  return valueOf
}
