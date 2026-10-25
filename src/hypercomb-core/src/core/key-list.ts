// core/key-list.ts
//
// WHO MAY SIGN FOR AN ANCHOR (documentation/becoming-a-host.md, "Letting
// another place publish for you"; jwize 2026-10-24: "pass it and unfold it
// (ie allow publishing to that device)").
//
// Every place makes its own key and no secret ever travels. What travels is
// this list: a chain of signed records begun by the ANCHOR (the key everything
// already names you by), each naming the list before it by its event id and
// signed by a key that list holds. A host keeps the whole chain at
// sign('keys:lists')/<anchor>, so one read is the whole proof. The event id is
// the SHA-256 of nostr's canonical serialization, so a list has the same name
// on every host whatever bytes that host keeps.
//
// AN INVITE is a throwaway key a listed key wrote into the list. Its secret is
// passed in a link; the place that opens it signs exactly ONE list with it —
// the list before, its own invite out, exactly one key in, nothing else — and
// forgets it. An invite never publishes and never signs anything else.
//
// WHAT THIS MODULE DOES NOT DO. It checks no signature itself: core carries no
// secp256k1, so the nostr verifier (id + schnorr) is INJECTED, as head-claim.ts
// takes its own. And it reads no clock. A reader verifies steps a host accepted
// in the past, so an invite's `until` is checked against the list's own
// `created_at` (which may never go backwards, so an acceptance is pinned
// between the invite's issue and its end). A host also passes its own clock —
// `acceptKeyListChain` — but it judges by it only the step built directly on
// the list it holds as the head: that is the one step it can see happen NOW,
// and the one a stolen, expired invite cannot backdate past. Steps it missed
// while it was behind happened elsewhere, earlier; refusing an old acceptance
// among them by today's clock would strand the host behind forever. So the
// place that writes an invite carries that list to every host it publishes to
// at once, and each of them then holds the invite's list as its head.

export const KEY_LIST_KIND = 30570
/** The pool a host keeps each anchor's chain in, the member named by the anchor. */
export const KEY_LIST_MEANING = 'keys:lists'
/** The longest an invite may live. The words offer ten minutes. */
export const INVITE_MAX_SECONDS = 3600
export const KEY_LIST_MAX_KEYS = 64
export const KEY_LIST_MAX_CHAIN = 256
const LABEL_MAX = 64
const HEX64 = /^[0-9a-f]{64}$/

export interface KeyListKey { pubkey: string; label?: string }
export interface KeyListInvite { pubkey: string; until: number }

export interface KeyList {
  v: 1
  anchor: string
  seq: number
  /** The event id of the list before; null on list 0. */
  prev: string | null
  keys: KeyListKey[]
  invites: KeyListInvite[]
}

/** A signed list as it travels and as a host keeps it: a nostr event. */
export interface SignedKeyList {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/** Checks a nostr event's id and schnorr signature (nostr-tools `verifyEvent`). */
export type KeyListVerifier = (event: SignedKeyList) => boolean

export type KeyListRefusal =
  | 'empty'      // no chain at all
  | 'too-long'   // more than KEY_LIST_MAX_CHAIN lists
  | 'malformed'  // not a key-list event, or its content is not a list
  | 'signature'  // the verifier refused the event
  | 'anchor'     // names another anchor, or list 0 is not the anchor's own
  | 'sequence'   // seq is not one on, or created_at went backwards
  | 'prev'       // does not name the list before it
  | 'signer'     // signed by a key the list before does not hold
  | 'invite'     // an invite signed more than its one acceptance, or too late
  | 'fork'       // a host's chain is not a prefix of the one offered

export type KeyListVerdict =
  | { ok: true; head: KeyList; headId: string; keys: string[] }
  | { ok: false; reason: KeyListRefusal; at: number }

export type KeyListChange =
  | { op: 'add'; pubkey: string; label?: string }
  | { op: 'remove'; pubkey: string }
  | { op: 'invite'; pubkey: string; until: number }
  | { op: 'accept'; invite: string; pubkey: string; label?: string }

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const labelOf = (raw: unknown): string | undefined | null => {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string') return null
  const label = raw.trim()
  return label.length > LABEL_MAX ? null : label || undefined
}

const keyEntry = (pubkey: string, label?: string): KeyListKey => label ? { pubkey, label } : { pubkey }
/** Builders trim and cap a label; `readKeyList` refuses one that is not. */
const cleanLabel = (raw?: string): string | undefined => raw?.trim().slice(0, LABEL_MAX) || undefined

/** The list an event carries, or null when it is not one. Checks shape only. */
export function readKeyList(event: unknown): KeyList | null {
  if (!isObject(event) || Number(event['kind']) !== KEY_LIST_KIND) return null
  let raw: unknown
  try { raw = JSON.parse(String(event['content'] ?? '')) } catch { return null }
  if (!isObject(raw) || raw['v'] !== 1) return null
  const anchor = raw['anchor']
  const seq = raw['seq']
  const prev = raw['prev']
  if (typeof anchor !== 'string' || !HEX64.test(anchor)) return null
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return null
  if (seq === 0 ? prev !== null : (typeof prev !== 'string' || !HEX64.test(prev))) return null
  const rawKeys = raw['keys']
  const rawInvites = raw['invites']
  if (!Array.isArray(rawKeys) || !Array.isArray(rawInvites)) return null
  if (!rawKeys.length || rawKeys.length > KEY_LIST_MAX_KEYS || rawInvites.length > KEY_LIST_MAX_KEYS) return null
  const seen = new Set<string>()
  const keys: KeyListKey[] = []
  for (const k of rawKeys) {
    if (!isObject(k) || typeof k['pubkey'] !== 'string' || !HEX64.test(k['pubkey']) || seen.has(k['pubkey'])) return null
    const label = labelOf(k['label'])
    if (label === null) return null
    seen.add(k['pubkey'])
    keys.push(keyEntry(k['pubkey'], label))
  }
  const invites: KeyListInvite[] = []
  for (const i of rawInvites) {
    if (!isObject(i) || typeof i['pubkey'] !== 'string' || !HEX64.test(i['pubkey']) || seen.has(i['pubkey'])) return null
    const until = i['until']
    if (typeof until !== 'number' || !Number.isInteger(until) || until <= 0) return null
    seen.add(i['pubkey'])
    invites.push({ pubkey: i['pubkey'], until })
  }
  return { v: 1, anchor, seq, prev: seq === 0 ? null : prev as string, keys, invites }
}

/** The one spelling a list is signed in: fixed field order, labels trimmed. */
export function keyListContent(list: KeyList): string {
  return JSON.stringify({
    v: 1, anchor: list.anchor, seq: list.seq, prev: list.prev,
    keys: list.keys.map(k => keyEntry(k.pubkey, cleanLabel(k.label))),
    invites: list.invites.map(i => ({ pubkey: i.pubkey, until: i.until })),
  })
}

/** The unsigned event a signer turns into the next link of the chain. */
export function keyListTemplate(list: KeyList, createdAt: number): { kind: number; created_at: number; tags: string[][]; content: string } {
  return { kind: KEY_LIST_KIND, created_at: createdAt, tags: [['d', list.anchor]], content: keyListContent(list) }
}

export const isListedKey = (list: KeyList, pubkey: string): boolean =>
  list.keys.some(k => k.pubkey === pubkey)

/** List 0: the anchor, alone. */
export function firstKeyList(anchor: string, label?: string): KeyList {
  return { v: 1, anchor, seq: 0, prev: null, keys: [keyEntry(anchor, cleanLabel(label))], invites: [] }
}

/** The list after `head` with one change made, or null when the change cannot
 *  be made (a key already there, the last key removed, a name it does not
 *  hold). `nowSeconds`, when given, drops expired invites — except from an
 *  acceptance, which may change nothing but its own two entries. */
export function nextKeyList(head: KeyList, headId: string, change: KeyListChange, nowSeconds?: number): KeyList | null {
  const held = (pubkey: string): boolean =>
    head.keys.some(k => k.pubkey === pubkey) || head.invites.some(i => i.pubkey === pubkey)
  const base = { v: 1 as const, anchor: head.anchor, seq: head.seq + 1, prev: headId }
  const live = change.op === 'accept' || nowSeconds === undefined
    ? head.invites
    : head.invites.filter(i => i.until >= nowSeconds)
  switch (change.op) {
    case 'add':
      if (!HEX64.test(change.pubkey) || held(change.pubkey)) return null
      return { ...base, keys: [...head.keys, keyEntry(change.pubkey, cleanLabel(change.label))], invites: live }
    case 'remove': {
      const keys = head.keys.filter(k => k.pubkey !== change.pubkey)
      const invites = live.filter(i => i.pubkey !== change.pubkey)
      if (!keys.length || !held(change.pubkey)) return null
      return { ...base, keys, invites }
    }
    case 'invite':
      if (!HEX64.test(change.pubkey) || held(change.pubkey) || !Number.isInteger(change.until)) return null
      return { ...base, keys: head.keys, invites: [...live, { pubkey: change.pubkey, until: change.until }] }
    case 'accept':
      if (!head.invites.some(i => i.pubkey === change.invite)) return null
      if (!HEX64.test(change.pubkey) || held(change.pubkey)) return null
      return {
        ...base,
        keys: [...head.keys, keyEntry(change.pubkey, cleanLabel(change.label))],
        invites: head.invites.filter(i => i.pubkey !== change.invite),
      }
  }
}

const sameKey = (a: KeyListKey, b: KeyListKey): boolean => a.pubkey === b.pubkey && a.label === b.label
const sameInvite = (a: KeyListInvite, b: KeyListInvite): boolean => a.pubkey === b.pubkey && a.until === b.until

/** Is `after` exactly `before` with `invite` spent on one new key? */
function isAcceptance(before: KeyList, after: KeyList, invite: string): boolean {
  const invites = before.invites.filter(i => i.pubkey !== invite)
  if (after.invites.length !== invites.length || !invites.every((i, n) => sameInvite(i, after.invites[n]))) return false
  if (after.keys.length !== before.keys.length + 1 || !before.keys.every((k, n) => sameKey(k, after.keys[n]))) return false
  return after.keys[after.keys.length - 1].pubkey !== invite
}

/** Every invite a step writes or changes must end after it and within the cap. */
const invitesInWindow = (before: KeyList | null, after: KeyList, createdAt: number): boolean =>
  after.invites.every(i => before?.invites.some(b => sameInvite(b, i))
    || (i.until > createdAt && i.until <= createdAt + INVITE_MAX_SECONDS))

const verifies = (verify: KeyListVerifier, event: SignedKeyList): boolean => {
  try { return verify(event) === true } catch { return false }
}

type Link = { list: KeyList; event: SignedKeyList }

function walk(anchor: string, chain: readonly SignedKeyList[], verify: KeyListVerifier,
  clock?: { now: number; at: number }): KeyListVerdict {
  if (!chain.length) return { ok: false, reason: 'empty', at: 0 }
  if (chain.length > KEY_LIST_MAX_CHAIN) return { ok: false, reason: 'too-long', at: KEY_LIST_MAX_CHAIN }
  let before: Link | null = null
  for (let at = 0; at < chain.length; at++) {
    const event = chain[at]
    const list = readKeyList(event)
    const refuse = (reason: KeyListRefusal): KeyListVerdict => ({ ok: false, reason, at })
    if (!list || !HEX64.test(String(event.id)) || !HEX64.test(String(event.pubkey))
      || !Number.isInteger(event.created_at)) return refuse('malformed')
    if (list.anchor !== anchor) return refuse('anchor')
    if (!verifies(verify, event)) return refuse('signature')
    const signer = event.pubkey
    if (!before) {
      if (list.seq !== 0) return refuse('sequence')
      if (signer !== anchor || !isListedKey(list, anchor)) return refuse('anchor')
      if (!invitesInWindow(null, list, event.created_at)) return refuse('invite')
    } else {
      if (list.seq !== before.list.seq + 1 || event.created_at < before.event.created_at) return refuse('sequence')
      if (list.prev !== before.event.id) return refuse('prev')
      if (isListedKey(before.list, signer)) {
        if (!invitesInWindow(before.list, list, event.created_at)) return refuse('invite')
      } else {
        const invite = before.list.invites.find(i => i.pubkey === signer)
        if (!invite) return refuse('signer')
        if (event.created_at > invite.until) return refuse('invite')
        if (clock && at === clock.at && clock.now > invite.until) return refuse('invite')
        if (!isAcceptance(before.list, list, signer)) return refuse('invite')
      }
    }
    before = { list, event }
  }
  const head = before as Link
  return { ok: true, head: head.list, headId: head.event.id, keys: head.list.keys.map(k => k.pubkey) }
}

/** A reader's check of a whole chain, list 0 first. The verdict's `keys` are
 *  the keys that may sign for the anchor now. */
export function verifyKeyListChain(anchor: string, chain: readonly SignedKeyList[], verify: KeyListVerifier): KeyListVerdict {
  return walk(anchor, chain, verify)
}

/** Does `offered` keep every list `held` has, in order? */
export const extendsKeyListChain = (held: readonly SignedKeyList[], offered: readonly SignedKeyList[]): boolean =>
  held.length <= offered.length && held.every((event, n) => offered[n]?.id === event.id)

/** A host's check before it keeps `offered` in place of the chain it holds:
 *  never a fork, and the step built on the head it holds is judged by its own
 *  clock as well, so an invite written into that head is spent before its end
 *  or not at all (the header says why only that step). */
export function acceptKeyListChain(anchor: string, held: readonly SignedKeyList[], offered: readonly SignedKeyList[],
  verify: KeyListVerifier, nowSeconds: number): KeyListVerdict {
  if (!extendsKeyListChain(held, offered)) {
    const at = held.findIndex((event, n) => offered[n]?.id !== event.id)
    return { ok: false, reason: 'fork', at: at < 0 ? offered.length : at }
  }
  return walk(anchor, offered, verify, held.length ? { now: nowSeconds, at: held.length } : undefined)
}
