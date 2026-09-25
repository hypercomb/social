// sharing/arrival-plan-publish.ts
//
// A published branch's ARRIVAL PLAN — what its first view loads (hypercomb-
// runtime arrival-plan.ts reads it on the visitor). The plan is a record
// `{ arrive: [IoC keys] }`, content-addressed, sent to the host under the
// participant's key and named in their signed index as `plan:<lineage>`.
// One act, two doors onto it: the `arrival` word and the Publish window's
// Optimize section.

import { SignatureService } from '@hypercomb/core'
import { clearHiveRoot, setHiveRoot } from './hive-pointer.js'

type HostSyncLike = {
  publishAtoms?: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true } | { ok: false; error: string }>
}

export type PlanResult = { ok: true; sig: string | null } | { ok: false; reason: string }

/** The signed-index key a branch's plan is named under. */
export const arrivalPointer = (lineage: string): string => `plan:${lineage}`

/** A plan names bees by IoC key; a bare class name is taken as
 *  `@diamondcoreprocessor.com/<Class>`. Anything else is refused. */
export const arrivalKeyOf = (raw: string): string => {
  const name = String(raw ?? '').trim()
  if (!name) return ''
  if (/^@[^\s/]+\/[A-Za-z][A-Za-z0-9]*$/.test(name)) return name
  return /^[A-Za-z][A-Za-z0-9]*$/.test(name) ? `@diamondcoreprocessor.com/${name}` : ''
}

/** `@diamondcoreprocessor.com/SiteViewDrone` → `SiteViewDrone`. */
export const arrivalClassOf = (key: string): string => key.slice(key.lastIndexOf('/') + 1)

/** Mint, send and name a plan. */
export async function publishArrivalPlan(host: string, lineage: string, names: readonly string[]): Promise<PlanResult> {
  const keys = [...new Set(names.map(arrivalKeyOf).filter(Boolean))]
  if (!keys.length) return { ok: false, reason: 'name at least one bee by its class or IoC key' }
  const bytes = new TextEncoder().encode(JSON.stringify({ arrive: keys }))
  const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
  const sync = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HostSyncService') as HostSyncLike | undefined
  if (!sync?.publishAtoms) return { ok: false, reason: 'host sync is not available here' }
  const sent = await sync.publishAtoms(host, [sig], async wanted => (wanted === sig ? bytes : null))
  if (!sent.ok) return { ok: false, reason: sent.error }
  const stamped = await setHiveRoot(host, arrivalPointer(lineage), sig)
  return stamped.ok ? { ok: true, sig } : { ok: false, reason: stamped.reason ?? 'the index refused it' }
}

/** Withdraw a plan: the branch loads its whole package again. */
export async function withdrawArrivalPlan(host: string, lineage: string): Promise<PlanResult> {
  const cleared = await clearHiveRoot(host, arrivalPointer(lineage))
  return cleared.ok ? { ok: true, sig: null } : { ok: false, reason: cleared.reason ?? 'the index refused it' }
}

/** Read a published plan record from a host: its IoC keys, or null. */
export async function readArrivalPlan(host: string, sig: string): Promise<string[] | null> {
  if (!/^[a-f0-9]{64}$/.test(sig)) return null
  const bare = String(host).replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const scheme = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(?::\d+)?$/i.test(bare) ? 'http' : 'https'
  try {
    const response = await fetch(`${scheme}://${bare}/${sig}`)
    if (!response.ok) return null
    const record = await response.json() as { arrive?: unknown }
    return Array.isArray(record?.arrive) ? record.arrive.map(String) : null
  } catch { return null }
}
