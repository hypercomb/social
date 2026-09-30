// assistant/harness-network.ts
//
// A HARNESS TRAVELS LIKE A CATALOG (documentation/agent-harness.md, step 5).
// `harness offer <name> [@host]` puts the record's bytes on a host under the
// participant's key and stamps `agent:harness` in their signed index; the
// host lists every stamped record in the pool at `<origin>/<sign('agent:harness')>`
// once its operator lists the meaning (`hosts list agent:harness`).
// `harness sync [@host]` asks the hosts the participant follows for that
// listing, fetches each member, checks its bytes against its name, and
// brings it into the local pool — HELD: a record that arrived from a host
// is in the pool and runs nothing until `harness use` or `harness here`
// names it. That pointer is the hold, and it is the participant's.
//
// The same probe every published pool takes (sharing/published-pools.ts)
// is claimed for the meaning too, so a domain the participant learns can
// offer harnesses beside its providers; `placeOffers` is the acceptance.

import { SignatureService, registerPoolMeaning } from '@hypercomb/core'
import { HARNESS_POOL, harness, harnessBytes, parseHarness, type HarnessRecord } from './harness.js'
import { membersOf, registerPublishedPool } from '../sharing/published-pools.js'

export type HarnessPublishDeps = {
  put(text: string, type: string): Promise<string>
  publish(host: string, sigs: readonly string[]): Promise<{ ok: true } | { ok: false; error: string }>
  stamp(host: string, key: string, sig: string): Promise<{ ok: boolean; reason?: string }>
}

/** Put a record on a host under the participant's key. The bytes are the
 *  record's canonical JSON, so the signature the host lists is the one the
 *  local pool already holds. */
export const publishHarness = async (
  host: string, record: HarnessRecord, deps: HarnessPublishDeps,
): Promise<{ ok: true; sig: string } | { ok: false; error: string }> => {
  const text = new TextDecoder().decode(harnessBytes(record))
  const sig = await deps.put(text, 'application/json')
  const published = await deps.publish(host, [sig])
  if (!published.ok) return { ok: false, error: published.error }
  const stamped = await deps.stamp(host, HARNESS_POOL, sig)
  if (!stamped.ok) return { ok: false, error: stamped.reason ?? 'the harness pointer was not stamped' }
  return { ok: true, sig }
}

/** How many records one host may hand over per sync. */
export const HARNESSES_PER_HOST = 32

export type HostHarnesses = {
  readonly host: string
  /** The host answered the listing (even an empty one). */
  readonly answered: boolean
  /** Records brought into the local pool this sync, by name. */
  readonly imported: readonly { readonly sig: string; readonly name: string }[]
  /** Members the host listed that were dropped: unreadable, forged, or refused. */
  readonly dropped: number
}

/** Read one host's harness pool and bring its records in, held. */
export const syncHarnessesFrom = async (
  zone: string,
  fetchFn: typeof fetch = fetch,
): Promise<HostHarnesses> => {
  const base = zone.replace(/\/+$/, '')
  const out = { host: zone, answered: false, imported: [] as { sig: string; name: string }[], dropped: 0 }
  let members: string[]
  try {
    const pool = await registerPoolMeaning(HARNESS_POOL)
    const response = await fetchFn(`${base}/${pool}`, { cache: 'no-store' })
    if (!response.ok) return out
    const text = await response.text()
    let index: unknown = text
    try { index = JSON.parse(text) } catch { /* one signature per line */ }
    members = membersOf(index).slice(0, HARNESSES_PER_HOST)
  } catch { return out }
  out.answered = true
  for (const sig of members) {
    try {
      const response = await fetchFn(`${base}/${sig}`, { cache: 'force-cache' })
      if (!response.ok) { out.dropped++; continue }
      const bytes = await response.arrayBuffer()
      if ((await SignatureService.sign(bytes)) !== sig) { out.dropped++; continue }
      const record = parseHarness(new TextDecoder().decode(bytes))
      const placed = await harness.import(record)
      out.imported.push({ sig: placed, name: record.name })
    } catch { out.dropped++ }
  }
  return out
}

/** Claim the meaning on the published-pool probe, so a domain the
 *  participant learns can offer harnesses; accepting is `placeOffers`. */
export const claimHarnessPool = (): void => registerPublishedPool({
  meaning: HARNESS_POOL,
  accept: async record => {
    const sig = await harness.import(record)
    return harness.find(sig)?.record.name ?? sig
  },
})
