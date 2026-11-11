// dub/dub-network.ts
//
// A SOUNDBANK TRAVELS LIKE A CATALOG (jwize, 2026-11-11: "publish to our host
// pools our own dub so that people in the community can provide their own ...
// we can leave artifacts behind that can be shared by the community").
//
// `dub offer @host` puts this hive's bank on the named host under the
// participant's key: the bank document, every take it names, and
// `presentation:dubs` stamped in their signed index. The host lists every
// stamped bank at `<origin>/<sign('presentation:dubs')>` once its operator
// lists the meaning (`hosts list presentation:dubs`) — the shared-record pool
// every offered record uses, so there is no named route.
//
// `dub sync [@host]` asks the hosts the participant follows for that listing,
// fetches each bank, and believes it only when its bytes hash to the signature
// the host named. A take is fetched the same way, by its own signature, when a
// sentence that needs it is shown. Nothing a host offers replaces a take the
// participant recorded themself.

import { SignatureService, registerPoolMeaning } from '@hypercomb/core'
import { DUB_POOL, asSoundbank, type Soundbank } from './dub-bank.js'
import { membersOf, originUrl, registerPublishedPool } from '../sharing/published-pools.js'

export type DubPublishDeps = {
  put(text: string, type: string): Promise<string>
  publish(host: string, sigs: readonly string[]): Promise<{ ok: true } | { ok: false; error: string }>
  stamp(host: string, key: string, sig: string): Promise<{ ok: boolean; reason?: string }>
}

/** A bank as it was offered: its own signature, and the host that carries it. */
export interface OfferedBank {
  readonly sig: string
  /** The host's zone URL (`https://example.com`), where its takes are fetched. */
  readonly origin: string
  readonly bank: Soundbank
}

/** The bank's canonical bytes: one spelling, so one signature wherever it goes. */
export const soundbankText = (bank: Soundbank): string => {
  const voices: Record<string, unknown> = {}
  for (const say of Object.keys(bank.voices).sort()) {
    const entry = bank.voices[say]!
    voices[say] = { voice: entry.voice, type: entry.type, seconds: entry.seconds, ...(entry.text ? { text: entry.text } : {}) }
  }
  return JSON.stringify({ kind: bank.kind, v: bank.v, name: bank.name, voices, at: bank.at })
}

/** Put a bank on a host under the participant's key: the document, then every
 *  take it names, then the pointer. A bank with nothing in it is not offered. */
export const publishSoundbank = async (
  host: string, bank: Soundbank, deps: DubPublishDeps,
): Promise<{ ok: true; sig: string; takes: number } | { ok: false; error: string }> => {
  const takes = [...new Set(Object.values(bank.voices).map(entry => entry.voice).filter(Boolean))]
  if (!Object.keys(bank.voices).length) return { ok: false, error: 'nothing to offer: no sentence has a take or new words yet' }
  const sig = await deps.put(soundbankText(bank), 'application/json')
  const published = await deps.publish(host, [sig, ...takes])
  if (!published.ok) return { ok: false, error: published.error }
  const stamped = await deps.stamp(host, DUB_POOL, sig)
  if (!stamped.ok) return { ok: false, error: stamped.reason ?? 'the soundbank pointer was not stamped' }
  return { ok: true, sig, takes: takes.length }
}

/** How many banks one host may hand over per sync. */
export const BANKS_PER_HOST = 32
/** A bank is a document of pointers, never the takes themselves. */
const BANK_BYTES_MAX = 512 * 1024

export type HostBanks = {
  readonly host: string
  /** The host answered the listing (even an empty one). */
  readonly answered: boolean
  readonly banks: readonly OfferedBank[]
  /** Members the host listed that were dropped: unreadable, forged, or not a bank. */
  readonly dropped: number
}

/** Read one host's soundbank pool. */
export const readSoundbanksFrom = async (zone: string, fetchFn: typeof fetch = fetch): Promise<HostBanks> => {
  const base = zone.replace(/\/+$/, '')
  const out = { host: zone, answered: false, banks: [] as OfferedBank[], dropped: 0 }
  let members: string[]
  try {
    const pool = await registerPoolMeaning(DUB_POOL)
    const response = await fetchFn(`${base}/${pool}`, { cache: 'no-store' })
    if (!response.ok) return out
    const text = await response.text()
    let index: unknown = text
    try { index = JSON.parse(text) } catch { /* one signature per line */ }
    members = membersOf(index).slice(0, BANKS_PER_HOST)
  } catch { return out }
  out.answered = true
  for (const sig of members) {
    try {
      const response = await fetchFn(`${base}/${sig}`, { cache: 'force-cache' })
      if (!response.ok) { out.dropped++; continue }
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > BANK_BYTES_MAX || (await SignatureService.sign(bytes)) !== sig) { out.dropped++; continue }
      const bank = asSoundbank(JSON.parse(new TextDecoder().decode(bytes)))
      if (!bank || !Object.keys(bank.voices).length) { out.dropped++; continue }
      out.banks.push({ sig, origin: base, bank })
    } catch { out.dropped++ }
  }
  return out
}

/** A take from a host, believed only when its bytes hash to the signature asked for. */
export const readTake = async (origin: string, sig: string, fetchFn: typeof fetch = fetch): Promise<ArrayBuffer | null> => {
  try {
    const response = await fetchFn(`${origin.replace(/\/+$/, '')}/${sig}`, { cache: 'force-cache' })
    if (!response.ok) return null
    const bytes = await response.arrayBuffer()
    return (await SignatureService.sign(bytes)) === sig ? bytes : null
  } catch { return null }
}

/**
 * WHICH BANK FILLS A SENTENCE. The participant's own record always wins (it is
 * not a bank here; the caller checks it first). After that:
 *   - the bank they chose, when it has the sentence;
 *   - else THE DEFAULT: a bank offered by the host this page is served from —
 *     the presentation's own host voices its own presentation — newest first.
 * A bank from any other host is used only when it is chosen.
 */
export const bankFor = (
  say: string,
  offered: readonly OfferedBank[],
  chosen: string,
  here: string,
): OfferedBank | null => {
  const has = (offer: OfferedBank): boolean => !!offer.bank.voices[say]
  const pick = chosen ? offered.find(offer => offer.sig === chosen) : undefined
  if (pick && has(pick)) return pick
  const home = hostOf(here)
  return [...offered]
    .filter(offer => home !== '' && hostOf(offer.origin) === home && has(offer))
    .sort((a, b) => b.bank.at - a.bank.at)[0] ?? null
}

/** A zone URL or a bare host, as the bare lowercase host. */
export const hostOf = (zone: string): string =>
  String(zone ?? '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '')

/** Claim the meaning on the published-pool probe, so a domain the participant
 *  learns can offer banks; `accept` is handed each verified bank. */
export const claimDubPool = (accept: (offer: OfferedBank) => void): void => registerPublishedPool({
  meaning: DUB_POOL,
  accept: async (record, origin, verified) => {
    const bank = asSoundbank(record)
    if (!bank || !verified?.sig || !Object.keys(bank.voices).length) return null
    accept({ sig: verified.sig, origin: originUrl(origin).replace(/\/+$/, ''), bank })
    return bank.name || verified.sig
  },
})
