// history/optimization-use.ts
//
// Tell the store that a derived optimization was read or minted. The store
// owns the count. A shell with no store, or a store from before this
// method, simply does not count — the record stays protected until a
// ledger exists.

import { OPTIMIZATION_MINT_WEIGHT } from '@hypercomb/core'

export type OptimizationHeatStore = {
  noteOptimizationUse?(meaning: string, key: string, weight?: number): void
}

// Any store is accepted, and the method is looked up on it: a caller's own
// narrow store type need not mention the ledger at all.
const heatOf = (store: object | null | undefined): OptimizationHeatStore | null | undefined =>
  store as OptimizationHeatStore | null | undefined

export const noteDerivedUse = (
  store: object | null | undefined,
  meaning: string,
  key: string,
): void => {
  heatOf(store)?.noteOptimizationUse?.(meaning, key)
}

export const noteDerivedMint = (
  store: object | null | undefined,
  meaning: string,
  key: string,
): void => {
  heatOf(store)?.noteOptimizationUse?.(meaning, key, OPTIMIZATION_MINT_WEIGHT)
}
