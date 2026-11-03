// sharing/device-pairing.ts
//
// THE RECORD OF WHO A DEVICE BELONGS TO, and the token that carries a grant
// from the master to the device it vouches for (documentation/device-sync.md).
//
// A token holds only SIGNED EVENTS — a grant or a revocation the master made
// (device-delegation.ts). Nothing in it is secret, so it can be pasted, scanned
// or sent over any channel; what makes it good is the master's signature, and
// what a device does with it is its own confirmed act.
//
// THE STATE is one pool document (`device:pairing`, this device's own setting —
// it never travels with content):
//
//   master   the participant this device shares a hive with. On the master
//            device it is its own key; on a delegated device it is whoever
//            vouched for it, taken ONCE at the first accepted grant (trust on
//            first use — the accept shows the key in words and asks).
//   events   the newest master-signed event this device knows for each device:
//            the grants a master minted, or on a delegated device its own grant
//            plus every revocation it was told of. This is `known` to the
//            handshake: a verifier can only refuse a revoked device it has heard
//            about.

import {
  DEVICE_DELEGATION_KIND,
  currentDelegation,
  isGenuine,
  supersedes,
  verifyDelegation,
  type NostrEventLike,
} from './device-delegation.js'

export const PAIRING_POOL = 'device:pairing'
/** On the bus whenever the record changed, so the sync service listens (or stops) to match. */
export const DEVICE_PAIRING_CHANGED = 'device-pairing:changed'
export const PAIRING_PREFIX = 'hcpair1.'

const HEX64 = /^[0-9a-f]{64}$/

export type PairingState = {
  v: 1
  master: string | null
  events: Record<string, NostrEventLike>
}

export const emptyPairing = (): PairingState => ({ v: 1, master: null, events: {} })

const deviceOf = (event: NostrEventLike): string =>
  String(event.tags?.find(tag => tag?.[0] === 'd')?.[1] ?? '').toLowerCase()

const revoked = (event: NostrEventLike): boolean => {
  try { return JSON.parse(event.content)?.revoked === true } catch { return false }
}

// --- the token ---------------------------------------------------------------

const toBase64Url = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromBase64Url = (text: string): string | null => {
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
  } catch { return null }
}

export const encodeToken = (events: readonly NostrEventLike[]): string =>
  PAIRING_PREFIX + toBase64Url(JSON.stringify({ v: 1, events }))

/** The events a token carries, or null for anything that is not one. */
export const decodeToken = (token: string): NostrEventLike[] | null => {
  const text = String(token ?? '').trim()
  if (!text.startsWith(PAIRING_PREFIX)) return null
  const json = fromBase64Url(text.slice(PAIRING_PREFIX.length))
  if (!json) return null
  try {
    const body = JSON.parse(json)
    if (body?.v !== 1 || !Array.isArray(body.events) || body.events.length === 0 || body.events.length > 64) return null
    return body.events as NostrEventLike[]
  } catch { return null }
}

// --- the state ---------------------------------------------------------------

/** Keep `event` for its device if it is newer than what the state holds. */
const remember = (state: PairingState, event: NostrEventLike): PairingState => {
  const device = deviceOf(event)
  const held = state.events[device]
  if (held && !supersedes(event, held)) return state
  return { ...state, events: { ...state.events, [device]: event } }
}

/** The master records a grant or revocation it just minted. Being the one who
 *  vouches makes this device the master of the pair. */
export const recordMinted = (state: PairingState, self: string, event: NostrEventLike): PairingState =>
  remember({ ...state, master: self }, event)

export type TakeResult =
  | { ok: true; state: PairingState; self: 'paired' | 'revoked' | null; noted: number }
  | { ok: false; reason: 'not a token' | 'nothing valid' | 'other master' | 'no key' }

/**
 * Apply a token on THIS device. An event naming this device is a grant (or the
 * news that it has been revoked); events for other devices are revocations and
 * renewals this device should know. Every event must be genuine and signed by
 * the one master — an event from anyone else is dropped, and a device already
 * paired to a master does not take a second one.
 */
export const takeToken = (
  state: PairingState,
  token: string,
  self: string | null,
  now: number = Math.floor(Date.now() / 1000),
): TakeResult => {
  const events = decodeToken(token)
  if (!events) return { ok: false, reason: 'not a token' }
  const me = String(self ?? '').toLowerCase()
  if (!HEX64.test(me)) return { ok: false, reason: 'no key' }

  let next = state
  let mine: 'paired' | 'revoked' | null = null
  let noted = 0
  let refusedOther = false

  for (const event of events) {
    if (!event || event.kind !== DEVICE_DELEGATION_KIND) continue
    const issuer = String(event.pubkey ?? '').toLowerCase()
    const device = deviceOf(event)
    if (!HEX64.test(issuer) || !HEX64.test(device) || !isGenuine(event)) continue
    // A device never takes a master from a stranger's event once it has one,
    // and a master does not take a second master's word either.
    if (next.master && next.master !== issuer) { refusedOther = true; continue }

    if (device === me) {
      const verdict = verifyDelegation(event, issuer, me, now)
      if (verdict.ok) {
        next = remember({ ...next, master: issuer }, event)
        mine = 'paired'
      } else if (verdict.reason === 'revoked' && next.master === issuer) {
        next = remember(next, event)
        mine = 'revoked'
      }
      continue
    }
    // News about another device: only the master this device already answers to.
    if (next.master === issuer) {
      const before = next
      next = remember(next, event)
      if (next !== before) noted += 1
    }
  }

  if (next === state) return { ok: false, reason: refusedOther ? 'other master' : 'nothing valid' }
  return { ok: true, state: next, self: mine, noted }
}

/** Every master-signed event this device knows — what a handshake treats as `known`. */
export const knownEvents = (state: PairingState): NostrEventLike[] => Object.values(state.events)

/** This device's own current grant, or null on the master device and when unpaired. */
export const ownGrant = (state: PairingState, self: string): NostrEventLike | null => {
  if (!state.master || state.master === self) return null
  const held = state.events[self]
  return held && !revoked(held) ? held : null
}

export type DeviceRow = { device: string; label: string; expiresAt: number | null }

/** The devices the master's word currently vouches for. */
export const activeDevices = (state: PairingState, now: number = Math.floor(Date.now() / 1000)): DeviceRow[] => {
  if (!state.master) return []
  const rows: DeviceRow[] = []
  for (const device of Object.keys(state.events)) {
    const current = currentDelegation(Object.values(state.events), state.master, device)
    const verdict = current ? verifyDelegation(current, state.master, device, now) : null
    if (verdict?.ok) rows.push({ device, label: verdict.label, expiresAt: verdict.expiresAt })
  }
  return rows
}

// --- the store ---------------------------------------------------------------

export type PairingStoreLike = {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null | undefined>
  openPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null | undefined>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer) => Promise<string | null>
}

/** Read the state. A read never creates the pool: a hive that never paired grows no directory. */
export const loadPairing = async (store: PairingStoreLike | undefined): Promise<PairingState> => {
  try {
    await store?.initialize?.().catch(() => {})
    const pool = await store?.openPool?.(PAIRING_POOL)
    const bytes = pool ? await store?.getPoolDoc?.(pool) : null
    if (!bytes) return emptyPairing()
    const doc = JSON.parse(new TextDecoder().decode(bytes))
    if (doc?.v !== 1 || typeof doc.events !== 'object' || doc.events === null) return emptyPairing()
    const master = typeof doc.master === 'string' && HEX64.test(doc.master) ? doc.master : null
    const events: Record<string, NostrEventLike> = {}
    // Re-check what was stored: a document is a file on disk, not a promise.
    for (const [device, event] of Object.entries(doc.events as Record<string, NostrEventLike>)) {
      if (HEX64.test(device) && master && event?.pubkey === master && deviceOf(event) === device && isGenuine(event)) events[device] = event
    }
    return { v: 1, master, events }
  } catch { return emptyPairing() }
}

/** Write the state. Returns whether it was kept. */
export const savePairing = async (store: PairingStoreLike | undefined, state: PairingState): Promise<boolean> => {
  try {
    await store?.initialize?.().catch(() => {})
    const pool = await store?.getPool?.(PAIRING_POOL)
    if (!pool || !store?.putPoolDoc) return false
    const bytes = new TextEncoder().encode(JSON.stringify(state)).buffer as ArrayBuffer
    return (await store.putPoolDoc(pool, bytes)) !== null
  } catch { return false }
}
