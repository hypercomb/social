// core/packed-store-flag.ts
//
// THE PACKED-STORE FEATURE FLAG — one synchronous, boot-readable switch.
//
// Lives in core because BOTH sides of the seam need it: the shared shell
// (Store routes its root through the packed bridge) and essentials
// (HistoryService deletes its localStorage head-index cache in packed mode
// — with an O(log n) head lookup there is nothing left to cache). Neither
// may import the other, so the flag sits below both.
//
// Off by default: the packed store ships dark until the migration is proven
// on a copy of real data. Flip with `/packed-store on` (or set the key by
// hand) and reload — the choice is boot-time, not live, because the storage
// root cannot change under a running shell.

export const PACKED_STORE_FLAG_KEY = 'hc:store:packed'

export const packedStoreEnabled = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PACKED_STORE_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

export const setPackedStoreEnabled = (on: boolean): void => {
  try {
    if (on) localStorage.setItem(PACKED_STORE_FLAG_KEY, '1')
    else localStorage.removeItem(PACKED_STORE_FLAG_KEY)
  } catch { /* storage unavailable — flag stays off */ }
}
