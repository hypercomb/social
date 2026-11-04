// hypercomb-shim/src/bootstrap/device-invite.ts
//
// A FRONT DOOR TAKES AN INVITE (documentation/phone-showcase-signing.md, part 1;
// becoming-a-host.md, "Letting another place publish for you").
//
// On the desktop, `keys allow <this domain>` writes an invite into the owner's
// key list and shows a link: `https://<domain>/#invite=<host>/<anchor>/<secret>`.
// Opened here, the invite is HELD, never spent: opening a link must not make a
// browser publish as somebody else. The page shows one card, and its Allow tap is
// the owner's word — the shim has no command line, so the tap plays the part
// `keys accept` plays in the hive. Allow makes this browser's key, signs the next
// list with the invite's throwaway key (its own key in, the invite out), offers
// the chain to the host, and records the anchor. The secret is used once and not
// kept.
//
// The rules (the chain check, the invite's one acceptance) are core's
// (key-list.ts); so is the invite's spelling. This file only does the reading,
// the signing and the writing a front door needs.

import {
  KEY_LIST_MEANING, SignatureService, bareInviteHost, keyListTemplate, nextKeyList, nip98Authorization, nip98Template,
  parseInvite, verifyKeyListChain,
  type InviteParts, type KeyList, type SignedKeyList,
} from '@hypercomb/core'
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { bindDevice } from './device-binding'
import { deviceSigner, type DeviceSigner } from './device-key'

const LOOPBACK = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i

const bytesOf = (text: string): Uint8Array => Uint8Array.from(text.match(/../g) ?? [], pair => parseInt(pair, 16))
const utf8 = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer

/** Where an anchor's chain lives on a host: the member of sign('keys:lists') named by it. */
export const keyChainUrl = async (host: string, anchor: string): Promise<string> => {
  const bare = bareInviteHost(host)
  return `${LOOPBACK.test(bare) ? 'http' : 'https'}://${bare}/${await SignatureService.sign(utf8(KEY_LIST_MEANING))}/${anchor}`
}

export type KeyChain = { chain: SignedKeyList[]; head: KeyList; headId: string; keys: string[]; headAt: number }

/** One host's chain for `anchor`, verified end to end; 'none' when it holds none; null when it could not
 *  be read or did not verify. Never throws. */
export const readKeyChain = async (host: string, anchor: string): Promise<KeyChain | 'none' | null> => {
  let response: Response
  try { response = await fetch(await keyChainUrl(host, anchor), { cache: 'no-store', signal: AbortSignal.timeout(8_000) }) } catch { return null }
  if (response.status === 404) return 'none'
  if (!response.ok) return null
  let chain: unknown
  try { chain = await response.json() } catch { return null }
  if (!Array.isArray(chain) || !chain.length) return null
  const verdict = verifyKeyListChain(anchor, chain as SignedKeyList[], event => {
    try { return verifyEvent(structuredClone(event) as never) } catch { return false }
  })
  if (!verdict.ok) return null
  const last = chain[chain.length - 1] as SignedKeyList
  return { chain: chain as SignedKeyList[], head: verdict.head, headId: verdict.headId, keys: verdict.keys, headAt: Number(last.created_at) }
}

/** Offer a chain to a host, signed by this browser's own key, untagged: a place that just spent an invite
 *  is not on the host's list yet, and the host asks only that the chain names the signer. */
export const putKeyChain = async (host: string, anchor: string, chain: readonly SignedKeyList[], signer: DeviceSigner): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const url = await keyChainUrl(host, anchor)
  const body = JSON.stringify(chain)
  const payload = await SignatureService.sign(utf8(body))
  const auth = nip98Authorization(signer.sign(nip98Template(url, 'PUT', Date.now() / 1000, payload)))
  try {
    const response = await fetch(url, { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body })
    return response.ok ? { ok: true } : { ok: false, reason: `${bareInviteHost(host)} said ${response.status}${response.headers.get('X-Reason') ? `: ${response.headers.get('X-Reason')}` : ''}` }
  } catch { return { ok: false, reason: `${bareInviteHost(host)} could not be reached` } }
}

// ── the invite this page was opened with ──

let held: InviteParts | null = null

/** The invite this page holds, unspent. */
export const heldInvite = (): InviteParts | null => held
export const dropInvite = (): void => { held = null }

/** Read an invite out of the page's address, hold it, and take it out of the address so a reload or a
 *  copied URL does not carry the secret on. */
export const captureDeviceInvite = (
  loc: { hash: string; pathname: string; search: string },
  hist: { replaceState: (state: unknown, title: string, url: string) => void },
): InviteParts | null => {
  const parts = parseInvite(String(loc.hash ?? ''))
  if (!parts) return null
  held = parts
  try { hist.replaceState(null, '', `${loc.pathname}${loc.search}`) } catch { /* the address stays */ }
  return parts
}

export type AllowResult = { readonly ok: true; readonly anchor: string; readonly already?: true } | { readonly ok: false; readonly reason: string }

/** Spend an invite: this browser's own key goes onto the anchor's list, signed by the invite's throwaway
 *  key, and the anchor becomes the one this browser publishes for. The reasons are said to a person. */
export const allowInvite = async (parts: InviteParts, label = 'phone', now = Math.floor(Date.now() / 1000)): Promise<AllowResult> => {
  const before = deviceSigner(false)
  if (before?.pubkey === parts.anchor) return { ok: false, reason: 'This browser already holds that key.' }
  const read = await readKeyChain(parts.host, parts.anchor)
  if (read === 'none') return { ok: false, reason: `${parts.host} holds no key list for this invite.` }
  if (!read) return { ok: false, reason: `Could not read the key list on ${parts.host}.` }
  if (before && read.keys.includes(before.pubkey)) {
    if (!await bindDevice(parts.anchor, [parts.host])) return { ok: false, reason: 'This browser is on the list, but could not remember it.' }
    held = null
    return { ok: true, anchor: parts.anchor, already: true }
  }
  const secret = bytesOf(parts.secret)
  const invitePub = getPublicKey(secret)
  const invite = read.head.invites.find(row => row.pubkey === invitePub)
  if (!invite) return { ok: false, reason: 'This invite was already used, or taken back.' }
  if (now > invite.until) return { ok: false, reason: 'This invite has run out. Ask for a new one.' }
  // Only now, with an invite that will take it, is this browser's key made.
  const signer = before ?? deviceSigner(true)
  if (!signer) return { ok: false, reason: 'This browser cannot keep a key, so it cannot publish.' }
  const next = nextKeyList(read.head, read.headId, { op: 'accept', invite: invitePub, pubkey: signer.pubkey, label })
  if (!next) return { ok: false, reason: 'The list would not take this browser\'s key.' }
  // Dated within the invite however this clock reads, and never before the list it follows.
  const createdAt = Math.min(Math.max(now, read.headAt), invite.until)
  const event = finalizeEvent(keyListTemplate(next, createdAt) as never, secret) as unknown as SignedKeyList
  const put = await putKeyChain(parts.host, parts.anchor, [...read.chain, event], signer)
  if (!put.ok) return { ok: false, reason: put.reason }
  held = null
  if (!await bindDevice(parts.anchor, [parts.host])) return { ok: false, reason: 'This browser is on the list, but could not remember it.' }
  return { ok: true, anchor: parts.anchor }
}
