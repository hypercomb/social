// sharing/device-delegation.ts
//
// ONE PARTICIPANT, MANY DEVICES — without the key ever leaving the device that
// holds it. The key lives only in a device's own storage, "never a pool,
// resource, event or export" (nostr-signer.ts, jwize 2026-10-07), and with a
// NIP-07 extension it never reaches the page at all. So a second device cannot
// be given the master key; it holds its OWN key and the master vouches for it.
//
// A DELEGATION is one signed nostr event, signed by the master through the
// ordinary `signEvent` door (so it works with an extension too):
//
//   kind 30571 · d = <device pubkey> · p = <device pubkey>
//   tags: ['scope', 'sync'] and optionally ['expiration', <unix seconds>]
//
// 30000-39999 is parameterized-replaceable, and the `d` tag is the device, so a
// REVOCATION is simply a newer event for the same device whose content says
// `revoked`. One event per (master, device): grant, renew and revoke are the
// same shape and the newest wins — there is no revocation list to keep.
//
// What a delegation authorises is stated by `scope`. The only scope is `sync`:
// the device may exchange this participant's atoms with the master's other
// devices. It does NOT let the device sign as the master — a verifier that
// holds a delegation learns "this device belongs to M", never "this is M".

import { verifyEvent } from 'nostr-tools/pure'

/** 30564-30569 are taken (hive index, head claim, vocabulary, room member,
 *  calendar RSVP, room notice) and 30570 is a publish list. */
export const DEVICE_DELEGATION_KIND = 30571

export const SYNC_SCOPE = 'sync'

const HEX64 = /^[0-9a-f]{64}$/

export type NostrEventLike = {
  id?: string
  pubkey?: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig?: string
}

/**
 * Is this event genuinely signed by the key it declares?
 *
 * `verifyEvent` remembers its verdict on the event object under a symbol key,
 * and `{ ...event }` copies that key — so a TAMPERED in-memory copy of a signed
 * event inherits "verified" and is never re-checked. Events off the wire are
 * plain JSON and carry no symbol, but a verifier must not depend on where its
 * input came from, so it checks a fresh object with only the wire fields.
 */
export const isGenuine = (event: NostrEventLike): boolean => {
  try {
    return verifyEvent({
      id: event.id, pubkey: event.pubkey, created_at: event.created_at,
      kind: event.kind, tags: event.tags, content: event.content, sig: event.sig,
    } as any)
  } catch { return false }
}

/** What a signer lends: sign one event. NostrSigner satisfies this. */
export interface EventSigner {
  signEvent: (evt: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<NostrEventLike>
}

export type DelegationFailure =
  | 'malformed'
  | 'wrong kind'
  | 'wrong master'
  | 'bad signature'
  | 'wrong device'
  | 'wrong scope'
  | 'expired'
  | 'revoked'

export type DelegationVerdict =
  | { ok: true; master: string; device: string; label: string; expiresAt: number | null }
  | { ok: false; reason: DelegationFailure }

const tagValue = (event: NostrEventLike, name: string): string | undefined =>
  event.tags?.find(tag => tag?.[0] === name)?.[1]

const parseContent = (event: NostrEventLike): { revoked: boolean; label: string } | null => {
  try {
    const body = JSON.parse(event.content)
    if (!body || typeof body !== 'object') return null
    return { revoked: body.revoked === true, label: typeof body.label === 'string' ? body.label.slice(0, 80) : '' }
  } catch { return null }
}

/** The master vouches for `device`. `expiresAt` (unix seconds) is optional —
 *  a delegation with none stays good until it is revoked. */
export const mintDelegation = async (
  signer: EventSigner,
  device: string,
  options: { label?: string; expiresAt?: number; now?: number } = {},
): Promise<NostrEventLike | null> => {
  const key = String(device ?? '').toLowerCase()
  if (!HEX64.test(key)) return null
  const tags: string[][] = [['d', key], ['p', key], ['scope', SYNC_SCOPE]]
  if (options.expiresAt) tags.push(['expiration', String(Math.floor(options.expiresAt))])
  try {
    return await signer.signEvent({
      kind: DEVICE_DELEGATION_KIND,
      created_at: options.now ?? Math.floor(Date.now() / 1000),
      tags,
      content: JSON.stringify({ v: 1, label: options.label ?? '' }),
    })
  } catch { return null }
}

/** The master withdraws `device`. Replaces the grant — same `d`, newer time. */
export const mintRevocation = async (
  signer: EventSigner,
  device: string,
  options: { now?: number } = {},
): Promise<NostrEventLike | null> => {
  const key = String(device ?? '').toLowerCase()
  if (!HEX64.test(key)) return null
  try {
    return await signer.signEvent({
      kind: DEVICE_DELEGATION_KIND,
      created_at: options.now ?? Math.floor(Date.now() / 1000),
      tags: [['d', key], ['p', key], ['scope', SYNC_SCOPE]],
      content: JSON.stringify({ v: 1, revoked: true }),
    })
  } catch { return null }
}

/**
 * Is `event` the master's current word that `device` may sync?
 *
 * The pubkey comparison is what stops substitution — `verifyEvent` alone
 * proves only that an event is consistent under the key it DECLARES (the same
 * reasoning as hive-pointer.ts and head-claim-signer.ts). Cheapest checks run
 * first; the curve maths runs last.
 */
export const verifyDelegation = (
  event: NostrEventLike | null | undefined,
  master: string,
  device: string,
  now: number = Math.floor(Date.now() / 1000),
): DelegationVerdict => {
  if (!event || typeof event !== 'object' || !Array.isArray(event.tags)) return { ok: false, reason: 'malformed' }
  if (event.kind !== DEVICE_DELEGATION_KIND) return { ok: false, reason: 'wrong kind' }
  const masterKey = String(master ?? '').toLowerCase()
  const deviceKey = String(device ?? '').toLowerCase()
  if (!HEX64.test(masterKey) || !HEX64.test(deviceKey)) return { ok: false, reason: 'malformed' }
  if (String(event.pubkey ?? '').toLowerCase() !== masterKey) return { ok: false, reason: 'wrong master' }
  if (tagValue(event, 'd') !== deviceKey || tagValue(event, 'p') !== deviceKey) return { ok: false, reason: 'wrong device' }
  if (tagValue(event, 'scope') !== SYNC_SCOPE) return { ok: false, reason: 'wrong scope' }
  const body = parseContent(event)
  if (!body) return { ok: false, reason: 'malformed' }
  if (body.revoked) return { ok: false, reason: 'revoked' }
  const expiry = tagValue(event, 'expiration')
  const expiresAt = expiry === undefined ? null : Number(expiry)
  if (expiresAt !== null && !Number.isFinite(expiresAt)) return { ok: false, reason: 'malformed' }
  if (expiresAt !== null && expiresAt <= now) return { ok: false, reason: 'expired' }
  if (!isGenuine(event)) return { ok: false, reason: 'bad signature' }
  return { ok: true, master: masterKey, device: deviceKey, label: body.label, expiresAt }
}

/** Does this event withdraw the device rather than grant it? */
export const isRevocation = (event: NostrEventLike): boolean => {
  try { return JSON.parse(event.content)?.revoked === true } catch { return false }
}

/**
 * Does `candidate` replace `held`? The newer `created_at` wins — which is what
 * makes a revocation a replacement. Timestamps are whole seconds, so a grant
 * and its revocation can tie; the tie goes to the REVOCATION, the safe way to
 * be wrong: a device wrongly turned away presses sync again after a renewal, a
 * device wrongly let in keeps reading someone's hive.
 */
export const supersedes = (candidate: NostrEventLike, held: NostrEventLike): boolean =>
  candidate.created_at > held.created_at
  || (candidate.created_at === held.created_at && isRevocation(candidate) && !isRevocation(held))

/**
 * Of every delegation event offered for one device, the CURRENT one. A relay
 * may hand back stale copies; this never lets an old grant outlive a revoke.
 */
export const currentDelegation = (
  events: readonly NostrEventLike[],
  master: string,
  device: string,
): NostrEventLike | null => {
  const masterKey = String(master ?? '').toLowerCase()
  const deviceKey = String(device ?? '').toLowerCase()
  let best: NostrEventLike | null = null
  for (const event of events) {
    if (event?.kind !== DEVICE_DELEGATION_KIND) continue
    if (String(event.pubkey ?? '').toLowerCase() !== masterKey) continue
    if (tagValue(event, 'd') !== deviceKey) continue
    if (!best || supersedes(event, best)) best = event
  }
  return best
}
