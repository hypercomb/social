// hypercomb-shared/core/expand.ts
//
// Universal sig-expansion primitive. Many fields in the merkle layer
// model — `children`, projection inputs, fan-out lists — can hold either
// of two shapes:
//
//   field: ["sigA", "sigB", "sigC"]    // inline array
//   field: "sigOfArrayResource"         // sig pointing to a resource
//                                       // whose bytes are JSON-encoded
//                                       // [string, string, ...]
//
// The first form is cheaper for short lists; the second form is cheaper
// for long lists shared across many parents (one resource, deduped by
// content). Above the storage layer every consumer should treat both
// forms as identical — that is the rule this helper enforces.
//
//   const children = await expand(parent.children)
//   // children is always readonly string[]
//
// Two parents that resolve to the same expanded array see the same key
// when fed to project(), so projections compose across both storage
// shapes without special-casing.
//
// One-level only: if the resource at `sig` itself contains another sig
// pointing to an array, callers expand again themselves. Recursion is
// not the responsibility of this primitive — it would hide cost and
// muddy the projection key.

import { Store } from './store'

export const expand = async (
  field: string | readonly string[],
): Promise<readonly string[]> => {
  if (Array.isArray(field)) return field as readonly string[]

  const store = (window as any).ioc?.get?.('@hypercomb.social/Store') as Store | undefined
  if (!store) throw new Error('[expand] Store not registered')

  const blob = await store.getResource(field as string)
  if (!blob) throw new Error(`[expand] resource not found: ${(field as string).slice(0, 12)}…`)

  const parsed = JSON.parse(await blob.text())
  if (!Array.isArray(parsed)) {
    throw new Error(`[expand] resource ${(field as string).slice(0, 12)}… is not an array`)
  }
  return parsed as readonly string[]
}
