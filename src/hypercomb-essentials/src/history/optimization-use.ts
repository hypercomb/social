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

export const noteDerivedUse = (
  store: OptimizationHeatStore | null | undefined,
  meaning: string,
  key: string,
): void => {
  store?.noteOptimizationUse?.(meaning, key)
}

export const noteDerivedMint = (
  store: OptimizationHeatStore | null | undefined,
  meaning: string,
  key: string,
): void => {
  store?.noteOptimizationUse?.(meaning, key, OPTIMIZATION_MINT_WEIGHT)
}
