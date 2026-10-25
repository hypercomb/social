// sharing/key-list.client.ts
//
// THE CLIENT'S SIDE OF THE KEY LIST (documentation/becoming-a-host.md,
// "Letting another place publish for you"; jwize 2026-10-24: "pass it and
// unfold it (ie allow publishing to that device)").
//
// Every place makes its own key and no secret ever travels. What travels is the
// anchor's key-list chain (core key-list.ts: the rules) and an INVITE — a
// throwaway key a listed key wrote into the list. This file reads and writes
// chains on hosts, makes and spends invites, takes a key off, and answers the
// two questions the rest of the client asks:
//
//   publisherKeyHex()   whose index is mine — the anchor I publish for, else my key
//   listedKeys()        which keys a host's list for an anchor names (a reader's
//                       check of an index its anchor did not sign)
//
// It touches no IoC service but the signer and the binding, both reached through
// deps so a spec runs with neither, and it imports nothing from hive-pointer
// (that imports this).
//
// An invite is consent to publish AS someone, so it is only ever spent by the
// participant's own word (`keys accept`): a link that merely lands is held and
// never acted on (captureInvite).

import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import {
  KEY_LIST_MEANING, SignatureService, firstKeyList, get, keyListTemplate, nextKeyList,
  registerPoolMeaning, verifyKeyListChain,
  type KeyList, type SignedKeyList,
} from '@hypercomb/core'
import { nip98Header } from './hive-pointer.js'

const ANCHOR_BINDING_IOC_KEY = '@hypercomb.social/AnchorBinding'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
/** How long an invite lives. The words offer ten minutes; core allows an hour. */
export const INVITE_SECONDS = 600
const SIG_RE = /^[0-9a-f]{64}$/
// Loopback hosts speak plain http, as hive-pointer's index door does.
const LOOPBACK_RE = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i
/** How long this tab trusts what it read of a host's list. */
const READ_TTL_MS = 30_000

export interface KeySigner {
  signEvent: (evt: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<Record<string, unknown>>
  getPublicKeyHex?: () => Promise<string | null>
  knownPublicKeyHex?: () => Promise<string | null>
}

export interface AnchorBindingLike {
  anchor(): string | null
  sources(): readonly string[]
  bind?(anchor: string, sources: readonly string[]): void
  unbind?(): void
  ready?(): Promise<void>
}

export interface KeyListDeps {
  fetch?: typeof fetch
  signer?: () => KeySigner | undefined
  binding?: () => AnchorBindingLike | undefined
  /** Seconds-epoch. */
  now?: () => number
  verify?: (event: SignedKeyList) => boolean
  newSecret?: () => Uint8Array
}

const fetcher = (deps: KeyListDeps): typeof fetch => deps.fetch ?? ((input, init) => fetch(input, init))
const signerOf = (deps: KeyListDeps): KeySigner | undefined => deps.signer ? deps.signer() : get<KeySigner>(NOSTR_SIGNER_KEY)
const bindingOf = (deps: KeyListDeps): AnchorBindingLike | undefined => deps.binding ? deps.binding() : get<AnchorBindingLike>(ANCHOR_BINDING_IOC_KEY)
const nowOf = (deps: KeyListDeps): number => deps.now ? deps.now() : Math.floor(Date.now() / 1000)
const verifierOf = (deps: KeyListDeps) => deps.verify ?? ((event: SignedKeyList): boolean => {
  // nostr-tools caches a verdict on the event object it is handed; a copy keeps
  // that off chains we hold and re-serve.
  try { return verifyEvent(structuredClone(event) as never) } catch { return false }
})

const hex = (bytes: Uint8Array): string => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
const bytesOf = (text: string): Uint8Array => Uint8Array.from(text.match(/../g) ?? [], pair => parseInt(pair, 16))

const bareHost = (host: string): string =>
  String(host ?? '').replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '').trim().toLowerCase()

/** Where an anchor's chain lives on a host: the member of sign('keys:lists')
 *  named by it — addressed by signature only, as the index is. */
export async function keyChainUrl(host: string, anchor: string): Promise<string> {
  const bare = bareHost(host)
  const pool = await registerPoolMeaning(KEY_LIST_MEANING)
  return `${LOOPBACK_RE.test(bare) ? 'http' : 'https'}://${bare}/${pool}/${anchor}`
}

// ── reading a chain ──────────────────────────────────────────────────────────

export type KeyChainRead =
  | { ok: true; chain: SignedKeyList[]; head: KeyList; headId: string; keys: string[]; headAt: number }
  | { ok: false; reason: 'unreachable' | 'none' | 'http' | 'malformed' | 'refused'; status?: number; detail?: string }

/** One host's chain for `anchor`, verified end to end. Never throws. A host
 *  can withhold a chain or serve a stale one, never forge a longer one. */
export async function fetchKeyChain(host: string, anchor: string, deps: KeyListDeps = {}): Promise<KeyChainRead> {
  const key = String(anchor ?? '').toLowerCase()
  if (!SIG_RE.test(key)) return { ok: false, reason: 'malformed' }
  let res: Response
  try { res = await fetcher(deps)(await keyChainUrl(host, key), { cache: 'no-store' }) } catch { return { ok: false, reason: 'unreachable' } }
  if (res.status === 404) return { ok: false, reason: 'none', status: 404 }
  if (!res.ok) return { ok: false, reason: 'http', status: res.status }
  let chain: unknown
  try { chain = await res.json() } catch { return { ok: false, reason: 'malformed' } }
  if (!Array.isArray(chain) || !chain.length) return { ok: false, reason: 'malformed' }
  const verdict = verifyKeyListChain(key, chain as SignedKeyList[], verifierOf(deps))
  if (!verdict.ok) return { ok: false, reason: 'refused', detail: `${verdict.reason} at list ${verdict.at}` }
  const last = (chain as SignedKeyList[])[chain.length - 1]
  return { ok: true, chain: chain as SignedKeyList[], head: verdict.head, headId: verdict.headId, keys: verdict.keys, headAt: Number(last.created_at) }
}

export type KeyChainPut = { ok: true } | { ok: false; status?: number; reason: string }

/** Offer `chain` to one host. The write is signed by this device's own key,
 *  untagged: a place that just spent an invite is not on the host's list yet,
 *  and the host asks only that the chain names the signer. */
export async function putKeyChain(host: string, anchor: string, chain: readonly SignedKeyList[], deps: KeyListDeps = {}): Promise<KeyChainPut> {
  const signer = signerOf(deps)
  if (!signer?.signEvent) return { ok: false, reason: 'no signer' }
  const url = await keyChainUrl(host, anchor)
  const body = JSON.stringify(chain)
  const payload = await SignatureService.sign(new TextEncoder().encode(body).buffer as ArrayBuffer)
  const auth = await nip98Header(signer, url, 'PUT', payload)
  if (!auth) return { ok: false, reason: 'nip-98 signing failed' }
  try {
    const res = await fetcher(deps)(url, { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body })
    if (!res.ok) return { ok: false, status: res.status, reason: `host said ${res.status}: ${res.headers.get('X-Reason') ?? ''}`.trim() }
    return { ok: true }
  } catch { return { ok: false, reason: 'host unreachable' } }
}

// ── whose index is mine ──────────────────────────────────────────────────────

const ownKeyOf = async (signer: KeySigner | undefined, known: boolean): Promise<string> => {
  try { return String((await (known ? signer?.knownPublicKeyHex?.() : signer?.getPublicKeyHex?.())) ?? '').toLowerCase() } catch { return '' }
}

/** The key whose index this device writes and reads: the anchor it publishes
 *  for, else its own key — what `getPublicKeyHex()` answered before anchors.
 *  `known` reads the key a device already holds and never mints one. '' when
 *  there is no signer. */
export async function publisherKeyHex(options: { known?: boolean } = {}, deps: KeyListDeps = {}): Promise<string> {
  const own = await ownKeyOf(signerOf(deps), options.known === true)
  if (!SIG_RE.test(own)) return ''
  const binding = bindingOf(deps)
  if (!binding) return own
  try { await binding.ready?.() } catch { /* unbound */ }
  const anchor = String(binding.anchor() ?? '').toLowerCase()
  return SIG_RE.test(anchor) ? anchor : own
}

/** The tags an index write carries when this device is not its anchor: it acts
 *  AS the anchor, and names the index it replaces. */
export function anchoredTags(publisher: string, own: string, replaces?: string): string[][] {
  if (!SIG_RE.test(publisher) || !SIG_RE.test(own) || publisher === own) return []
  return [['anchor', publisher], ...(replaces && SIG_RE.test(replaces) ? [['prev', replaces]] : [])]
}

const pinned = <T>(name: string, make: () => T): T => {
  const bag = globalThis as unknown as Record<string, T>
  return bag[name] ??= make()
}

// What this tab last read of a host's chain, by `host|anchor`: a reader asks
// per index, and a list changes a few times in a lifetime.
const reads = pinned('__hypercombKeyListReads', () => new Map<string, { at: number; keys: ReadonlySet<string> | null }>())

/** The keys `host`'s list for `anchor` names, or null when it holds none, or one
 *  that does not verify. A reader asks this only for an index the anchor did
 *  not sign. */
export async function listedKeys(host: string, anchor: string, deps: KeyListDeps = {}): Promise<ReadonlySet<string> | null> {
  const id = `${bareHost(host)}|${anchor}`
  const held = reads.get(id)
  if (held && Date.now() - held.at < READ_TTL_MS) return held.keys
  const read = await fetchKeyChain(host, anchor, deps)
  const keys = read.ok ? new Set(read.keys) : null
  // An unreachable host says nothing: do not remember a "none" from it.
  if (read.ok || read.reason !== 'unreachable') {
    if (reads.size > 256) reads.clear()
    reads.set(id, { at: Date.now(), keys })
  }
  return keys
}

export const forgetKeyReads = (): void => { reads.clear() }

// ── carrying the chain to a host ─────────────────────────────────────────────

// Hosts whose list for this device's anchor was seen to name this device's key:
// only there may a request say it acts as the anchor (host-sync tags uploads).
const served = pinned('__hypercombAnchorServes', () => new Map<string, number>())
const SERVED_TTL_MS = 5 * 60_000

/** May a request to `host` say it acts as the anchor? Synchronous, for a hot path. */
export const anchorServes = (host: string): boolean => {
  const at = served.get(bareHost(host))
  return at !== undefined && Date.now() - at < SERVED_TTL_MS
}

/** The tag an upload to `url` carries so the host takes it as the anchor's: only
 *  for a device that publishes for an anchor, and only to a host seen to hold
 *  the anchor's list with this device's key on it. Synchronous. */
export function anchorTagFor(url: string, own: string, deps: KeyListDeps = {}): string[] | null {
  const anchor = String(bindingOf(deps)?.anchor() ?? '').toLowerCase()
  if (!SIG_RE.test(anchor) || !SIG_RE.test(own) || anchor === own) return null
  let host = ''
  try { host = new URL(url).host } catch { return null }
  return anchorServes(host) ? ['anchor', anchor] : null
}

export type CarryResult = 'unbound' | 'held' | 'carried' | 'unlisted' | 'unreachable'

/** Make sure `host` holds the anchor's chain with this device's key on it, by
 *  carrying it from the hosts the binding names. A no-op for a device that is
 *  its own anchor. Never throws. */
export async function carryKeyChain(host: string, deps: KeyListDeps = {}): Promise<CarryResult> {
  const binding = bindingOf(deps)
  try { await binding?.ready?.() } catch { /* unbound */ }
  const anchor = String(binding?.anchor() ?? '').toLowerCase()
  if (!SIG_RE.test(anchor)) return 'unbound'
  const own = await ownKeyOf(signerOf(deps), true)
  if (!SIG_RE.test(own) || own === anchor) return 'unbound'
  const here = await fetchKeyChain(host, anchor, deps)
  if (here.ok && here.keys.includes(own)) { served.set(bareHost(host), Date.now()); return 'held' }
  if (!here.ok && here.reason === 'unreachable') return 'unreachable'
  for (const source of binding?.sources() ?? []) {
    if (bareHost(source) === bareHost(host)) continue
    const there = await fetchKeyChain(source, anchor, deps)
    if (!there.ok || !there.keys.includes(own)) continue
    if (here.ok && there.chain.length <= here.chain.length) continue
    const put = await putKeyChain(host, anchor, there.chain, deps)
    if (put.ok) { served.set(bareHost(host), Date.now()); reads.delete(`${bareHost(host)}|${anchor}`); return 'carried' }
  }
  return 'unlisted'
}

/** Carry the chain to every host a publish is about to write. */
export async function prepareAnchorHosts(hosts: readonly string[], deps: KeyListDeps = {}): Promise<void> {
  await Promise.all(hosts.map(host => carryKeyChain(host, deps).catch(() => 'unreachable' as CarryResult)))
}

// ── invites ──────────────────────────────────────────────────────────────────

export interface InviteParts { host: string; anchor: string; secret: string }

const INVITE_RE = /(?:^|[#?&\s])invite=([a-z0-9.:[\]-]+)\/([0-9a-f]{64})\/([0-9a-f]{64})(?![0-9a-f])/i
const BARE_INVITE_RE = /^([a-z0-9.:[\]-]+)\/([0-9a-f]{64})\/([0-9a-f]{64})$/i

/** An invite in a link, a fragment, `invite=…` or the bare `host/anchor/secret`. */
export function parseInvite(text: string): InviteParts | null {
  const raw = String(text ?? '').trim()
  const m = INVITE_RE.exec(raw) ?? BARE_INVITE_RE.exec(raw)
  if (!m) return null
  const host = bareHost(m[1])
  return host ? { host, anchor: m[2].toLowerCase(), secret: m[3].toLowerCase() } : null
}

/** The link to open where the new place lives. The secret is in the fragment,
 *  which a browser never sends to a server. */
export function inviteLink(where: string, parts: InviteParts): string {
  const bare = bareHost(where)
  return `${LOOPBACK_RE.test(bare) ? 'http' : 'https'}://${bare}/#invite=${parts.host}/${parts.anchor}/${parts.secret}`
}

// An invite that merely LANDED is held, never spent: opening a link must not
// make this device publish as somebody else's anchor.
const pending = pinned('__hypercombPendingInvite', () => ({ invite: null as InviteParts | null }))
export const pendingInvite = (): InviteParts | null => pending.invite
export const clearPendingInvite = (): void => { pending.invite = null }

/** Read an invite out of the page's address, hold it, and take it out of the
 *  address so a reload or a copied URL does not carry the secret on. */
export function captureInvite(
  loc: { hash: string; pathname: string; search: string },
  hist: { replaceState: (state: unknown, title: string, url: string) => void },
): InviteParts | null {
  const parts = parseInvite(String(loc.hash ?? ''))
  if (!parts) return null
  pending.invite = parts
  try { hist.replaceState(null, '', `${loc.pathname}${loc.search}`) } catch { /* the address stays */ }
  return parts
}

// ── the acts ─────────────────────────────────────────────────────────────────

type OwnList = { host: string; read: Extract<KeyChainRead, { ok: true }> }

/** The longest verified chain among `hosts` that names `own`, with every host
 *  that holds a shorter one. */
async function ownChain(hosts: readonly string[], anchor: string, own: string, deps: KeyListDeps): Promise<{ best: OwnList | null; reachable: number }> {
  const reads = await Promise.all(hosts.map(async host => ({ host, read: await fetchKeyChain(host, anchor, deps) })))
  let best: OwnList | null = null
  for (const { host, read } of reads) {
    if (!read.ok || !read.keys.includes(own)) continue
    if (!best || read.chain.length > best.read.chain.length) best = { host, read }
  }
  return { best, reachable: reads.filter(r => r.read.ok || r.read.reason === 'none').length }
}

async function putEverywhere(hosts: readonly string[], anchor: string, chain: readonly SignedKeyList[], deps: KeyListDeps): Promise<{ held: string[]; failed: { host: string; reason: string }[] }> {
  const puts = await Promise.all(hosts.map(async host => ({ host, put: await putKeyChain(host, anchor, chain, deps) })))
  for (const { host, put } of puts) if (put.ok) reads.delete(`${bareHost(host)}|${anchor}`)
  return {
    held: puts.filter(p => p.put.ok).map(p => p.host),
    failed: puts.filter(p => !p.put.ok).map(p => ({ host: p.host, reason: (p.put as { reason: string }).reason })),
  }
}

/** Sign the next list of a chain with this device's own key. The stamp never
 *  goes back: a list may not be dated before the one it follows. */
async function signNext(signer: KeySigner, chain: readonly SignedKeyList[], list: KeyList, at: number): Promise<SignedKeyList | null> {
  const previous = chain.length ? Number(chain[chain.length - 1].created_at) : 0
  try { return await signer.signEvent(keyListTemplate(list, Math.max(at, previous))) as unknown as SignedKeyList } catch { return null }
}

export type KeysAllowResult =
  | { ok: true; link: string; anchor: string; until: number; held: string[]; failed: { host: string; reason: string }[] }
  | { ok: false; reason: 'no-signer' | 'no-host' | 'not-listed' | 'unreachable' | 'refused'; detail?: string }

/** Let another place publish for you: write an invite into your list, on every
 *  host you publish to, and hand back the link that spends it. The first time,
 *  the list begins here, with this device as the anchor. */
export async function allowAnother(hosts: readonly string[], options: { where?: string; label?: string } = {}, deps: KeyListDeps = {}): Promise<KeysAllowResult> {
  const signer = signerOf(deps)
  const own = await ownKeyOf(signer, false)
  if (!signer?.signEvent || !SIG_RE.test(own)) return { ok: false, reason: 'no-signer' }
  if (!hosts.length) return { ok: false, reason: 'no-host' }
  const anchor = await publisherKeyHex({}, deps)
  const { best, reachable } = await ownChain(hosts, anchor, own, deps)
  if (!reachable) return { ok: false, reason: 'unreachable' }

  const at = nowOf(deps)
  let chain: SignedKeyList[]
  let head: KeyList
  let headId: string
  if (best) {
    chain = [...best.read.chain]; head = best.read.head; headId = best.read.headId
  } else if (anchor === own) {
    // No list anywhere that names this key: the list begins here.
    const first = await signNext(signer, [], firstKeyList(own, options.label), at)
    if (!first) return { ok: false, reason: 'refused', detail: 'signing failed' }
    chain = [first]; head = firstKeyList(own, options.label); headId = first.id
  } else {
    return { ok: false, reason: 'not-listed' }
  }

  const secret = (deps.newSecret ?? generateSecretKey)()
  const invitePub = getPublicKey(secret as never)
  const createdAt = Math.max(at, Number(chain[chain.length - 1].created_at))
  const until = createdAt + INVITE_SECONDS
  const next = nextKeyList(head, headId, { op: 'invite', pubkey: invitePub, until }, createdAt)
  if (!next) return { ok: false, reason: 'refused', detail: 'the list would not take another invite' }
  const event = await signNext(signer, chain, next, createdAt)
  if (!event) return { ok: false, reason: 'refused', detail: 'signing failed' }

  const { held, failed } = await putEverywhere(hosts, anchor, [...chain, event], deps)
  if (!held.length) return { ok: false, reason: 'refused', detail: failed.map(f => `${f.host}: ${f.reason}`).join('; ') }
  const link = inviteLink(options.where || held[0], { host: bareHost(held[0]), anchor, secret: hex(secret) })
  return { ok: true, link, anchor, until, held, failed }
}

export type KeysAcceptResult =
  | { ok: true; anchor: string; host: string; label: string; already?: true }
  | { ok: false; reason: 'no-invite' | 'no-signer' | 'own-anchor' | 'unreachable' | 'no-list' | 'unknown-invite' | 'expired' | 'refused'; detail?: string }

/** Spend an invite: add this device's own key to the anchor's list, signed by
 *  the invite's throwaway key, then take the anchor as this device's own to
 *  publish for. The invite's secret is used once here and not kept. */
export async function acceptInvite(text: string, options: { label?: string } = {}, deps: KeyListDeps = {}): Promise<KeysAcceptResult> {
  const parts = parseInvite(text)
  if (!parts) return { ok: false, reason: 'no-invite' }
  const signer = signerOf(deps)
  const own = await ownKeyOf(signer, false)
  if (!signer?.signEvent || !SIG_RE.test(own)) return { ok: false, reason: 'no-signer' }
  if (own === parts.anchor) return { ok: false, reason: 'own-anchor' }

  const read = await fetchKeyChain(parts.host, parts.anchor, deps)
  if (!read.ok) {
    return read.reason === 'none' ? { ok: false, reason: 'no-list' }
      : read.reason === 'unreachable' ? { ok: false, reason: 'unreachable' }
      : { ok: false, reason: 'refused', detail: read.detail ?? read.reason }
  }
  const label = String(options.label ?? '').trim().slice(0, 64)
  const binding = bindingOf(deps)
  if (read.keys.includes(own)) {
    binding?.bind?.(parts.anchor, [parts.host])
    return { ok: true, anchor: parts.anchor, host: parts.host, label, already: true }
  }

  const secret = bytesOf(parts.secret)
  const invitePub = getPublicKey(secret as never)
  const invite = read.head.invites.find(i => i.pubkey === invitePub)
  if (!invite) return { ok: false, reason: 'unknown-invite' }
  const now = nowOf(deps)
  if (now > invite.until) return { ok: false, reason: 'expired' }

  const next = nextKeyList(read.head, read.headId, { op: 'accept', invite: invitePub, pubkey: own, label })
  if (!next) return { ok: false, reason: 'refused', detail: 'the list would not take this key' }
  // Dated within the invite however this device's clock reads: the host judges
  // the invite's end by its own clock, and a list may not predate the one before.
  const createdAt = Math.min(Math.max(now, read.headAt), invite.until)
  const event = finalizeEvent(keyListTemplate(next, createdAt) as never, secret as never) as unknown as SignedKeyList
  const put = await putKeyChain(parts.host, parts.anchor, [...read.chain, event], deps)
  if (!put.ok) return { ok: false, reason: 'refused', detail: put.reason }
  reads.delete(`${bareHost(parts.host)}|${parts.anchor}`)
  binding?.bind?.(parts.anchor, [parts.host])
  clearPendingInvite()
  return { ok: true, anchor: parts.anchor, host: parts.host, label }
}

export type KeysOffResult =
  | { ok: true; removed: { pubkey: string; label?: string }; ownRemoved: boolean; held: string[]; failed: { host: string; reason: string }[] }
  | { ok: false; reason: 'no-signer' | 'no-host' | 'not-listed' | 'unreachable' | 'no-match' | 'ambiguous' | 'refused'; detail?: string }

/** Take a place off your list: its key, named by label or the start of its key
 *  (an open invite by the start of its key). Every host you publish to learns
 *  it; the host refuses what that key signs from then on. */
export async function removeKey(
  hosts: readonly string[], word: string,
  options: { resign?: (host: string, anchor: string) => Promise<unknown> } = {},
  deps: KeyListDeps = {},
): Promise<KeysOffResult> {
  const signer = signerOf(deps)
  const own = await ownKeyOf(signer, false)
  if (!signer?.signEvent || !SIG_RE.test(own)) return { ok: false, reason: 'no-signer' }
  if (!hosts.length) return { ok: false, reason: 'no-host' }
  const anchor = await publisherKeyHex({}, deps)
  const { best, reachable } = await ownChain(hosts, anchor, own, deps)
  if (!reachable) return { ok: false, reason: 'unreachable' }
  if (!best) return { ok: false, reason: 'not-listed' }

  const needle = String(word ?? '').trim().toLowerCase()
  const matches = needle ? [
    ...best.read.head.keys.filter(k => k.pubkey.startsWith(needle) || (k.label ?? '').toLowerCase() === needle),
    ...best.read.head.invites.filter(i => i.pubkey.startsWith(needle)),
  ] : []
  if (!matches.length) return { ok: false, reason: 'no-match' }
  if (matches.length > 1) return { ok: false, reason: 'ambiguous' }
  const target = matches[0]
  const at = nowOf(deps)
  const next = nextKeyList(best.read.head, best.read.headId, { op: 'remove', pubkey: target.pubkey }, at)
  if (!next) return { ok: false, reason: 'refused', detail: 'a list keeps at least one key' }
  const event = await signNext(signer, best.read.chain, next, at)
  if (!event) return { ok: false, reason: 'refused', detail: 'signing failed' }

  const { held, failed } = await putEverywhere(hosts, anchor, [...best.read.chain, event], deps)
  if (!held.length) return { ok: false, reason: 'refused', detail: failed.map(f => `${f.host}: ${f.reason}`).join('; ') }
  const ownRemoved = target.pubkey === own
  // So nothing the removed key signed is still the head: this device, still
  // listed, signs the current index again on each host that took the list.
  if (!ownRemoved && options.resign) for (const host of held) { try { await options.resign(host, anchor) } catch { /* the list is out; the index re-signs on the next publish */ } }
  if (ownRemoved) bindingOf(deps)?.unbind?.()
  return { ok: true, removed: { pubkey: target.pubkey, ...('label' in target && target.label ? { label: target.label } : {}) }, ownRemoved, held, failed }
}

export type KeysListing = {
  anchor: string
  own: string
  host: string
  keys: { pubkey: string; label?: string; you: boolean; anchor: boolean }[]
  invites: number
}

/** Who publishes for this participant, from the first host that has a list. */
export async function listKeys(hosts: readonly string[], deps: KeyListDeps = {}): Promise<KeysListing | null> {
  const signer = signerOf(deps)
  const own = await ownKeyOf(signer, true)
  if (!SIG_RE.test(own)) return null
  const anchor = await publisherKeyHex({ known: true }, deps)
  const reads = await Promise.all(hosts.map(async host => ({ host, read: await fetchKeyChain(host, anchor, deps) })))
  let best: { host: string; read: Extract<KeyChainRead, { ok: true }> } | null = null
  for (const { host, read } of reads) {
    if (read.ok && (!best || read.chain.length > best.read.chain.length)) best = { host, read }
  }
  if (!best) return null
  return {
    anchor, own, host: best.host,
    keys: best.read.head.keys.map(k => ({ pubkey: k.pubkey, ...(k.label ? { label: k.label } : {}), you: k.pubkey === own, anchor: k.pubkey === anchor })),
    invites: best.read.head.invites.length,
  }
}
