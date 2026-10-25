// sharing/held-address-reader.ts
//
// THE READER BEHIND A HELD CARD (documentation/using-a-creation.md, "Holding a
// published item"): where an address stands now, and what card a head holds.
// Where it stands is asked once per address per boot, like the update scout's
// one check; only an answer is remembered, so a host that failed is asked again.
//
// A MISS ON THE HEAD YOU HOLD MEANS ITS HOST MAY HAVE MOVED ON. A head-only
// host answers what only an old head reached as a plain 404
// (documentation/hosted-tenants.md §4b) — so a held version that no longer
// reads is the moment to read where its address stands again. The remembered
// answer for every address on that host is dropped and read afresh, so the
// card page's next look finds the current head and offers it as Update
// (upgrade or skip, never a silent swap). Nothing is taken here.

import type { AddressHead } from './published-address.js'

export interface HeldAddressReaderDeps<Card> {
  readHead: (address: string) => Promise<AddressHead>
  readCard: (head: string, host: string) => Promise<Card | null>
}

export function heldAddressReader<Card>(deps: HeldAddressReaderDeps<Card>) {
  const heads = new Map<string, Promise<AddressHead>>()
  /** The host each remembered answer came from. */
  const hostOf = new Map<string, string>()

  const head = (address: string): Promise<AddressHead> => {
    const key = String(address ?? '').trim().toLowerCase()
    let read = heads.get(key)
    if (!read) {
      read = deps.readHead(key)
      heads.set(key, read)
      void read.then(
        r => { if ('error' in r) { if (heads.get(key) === read) heads.delete(key) } else hostOf.set(key, r.host.toLowerCase()) },
        () => { if (heads.get(key) === read) heads.delete(key) },
      )
    }
    return read
  }

  /** The held head missed on its host: read every address on that host again. */
  const reread = (host: string): void => {
    const at = String(host ?? '').trim().toLowerCase()
    for (const [key, from] of [...hostOf]) {
      if (from !== at) continue
      hostOf.delete(key)
      heads.delete(key)
      void head(key).catch(() => null)
    }
  }

  const card = async (sig: string, host: string): Promise<Card | null> => {
    const found = await deps.readCard(sig, host)
    if (!found) reread(host)
    return found
  }

  return { head, card }
}
