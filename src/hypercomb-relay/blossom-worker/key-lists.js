// key-lists.js — WHO MAY SIGN FOR AN ANCHOR, on a host
// (documentation/becoming-a-host.md, "Letting another place publish for you").
//
// A host keeps each anchor's whole key-list chain at sign('keys:lists')/<anchor>
// and asks it three questions:
//
//   • may this signed request act as that anchor?   actingKey (NIP-98, BUD-02)
//   • may this index stand as that anchor's?         indexSignerRefusal
//   • may this chain replace the one held here?      offerKeyChain
//
// The chain rules are core's own (hypercomb-core key-list.ts), imported and
// never copied. This file only keeps and serves the chain. Real signatures are
// checked by the verifier the worker hands in (`keyLists(verifyEventSig)`), so
// there is one secp256k1 check in the worker, not two. key-list.vector.json
// pins the answers from both sides with really signed chains (key-lists.spec.js
// here, sharing/key-list.vector.spec.ts in essentials).
//
// HTTP stays in worker.js: these return verdicts and bytes, and the worker
// shapes the response.

import {
  KEY_LIST_MAX_CHAIN, KEY_LIST_MEANING, acceptKeyListChain, isListedKey, readKeyList, verifyKeyListChain,
} from '../../hypercomb-core/src/core/key-list.ts'

const SIG_RE = /^[0-9a-f]{64}$/
/** A chain is a few changes in a lifetime; this is many hundred lists of many keys. */
export const KEY_LISTS_MAX_BYTES = 262_144
/** How long an isolate believes the chain it read. A chain written in this
 *  isolate drops every copy at once; another isolate catches up within this. */
const KEY_LIST_TTL_MS = 60_000
const HELD_MAX = 4_096

const utf8 = new TextEncoder()
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const tagOf = (evt, name) => Array.isArray(evt?.tags)
  ? evt.tags.find((t) => Array.isArray(t) && t[0] === name)?.[1]
  : undefined

/** Where an anchor's chain lives: the member of sign('keys:lists') named by it. */
export const keyChainKey = async (anchor) =>
  `${hex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(KEY_LIST_MEANING))))}/${anchor}`

/** The three questions, answered with `verifyEvent` — an async NIP-01 check of
 *  an event's id and schnorr signature (worker.js verifyEventSig). Each call
 *  keeps its own copy of the chains it has read. */
export function keyLists(verifyEvent) {
  let written = 0
  const held = new Map()

  /** Core's verifier is synchronous and the event check is not (the id is a
   *  WebCrypto digest), so every event is checked first and core asks the answers. */
  const signatureCheck = async (events) => {
    const good = new Set()
    for (const event of events) {
      try { if (await verifyEvent(event)) good.add(event) } catch { /* not good */ }
    }
    return (event) => good.has(event)
  }

  /** The chain held for `anchor`, as bytes and parsed, with the etag a
   *  conditional write needs. Null when none is held. Throws when the store
   *  cannot be read, so a caller can tell that apart from "none". */
  const readKeyChain = async (env, anchor) => {
    const object = await env?.CONTENT?.get?.(await keyChainKey(anchor))
    if (!object) return null
    const bytes = new Uint8Array(await object.arrayBuffer())
    let chain = null
    try { chain = JSON.parse(new TextDecoder().decode(bytes)) } catch { /* not a chain: below */ }
    return { bytes, chain: Array.isArray(chain) ? chain : [], etag: object.httpEtag ?? null }
  }

  /** The keys that may sign for `anchor` here now, or null when it holds no
   *  chain (then only the anchor itself may). A held chain that no longer
   *  verifies lists NOBODY, the anchor included: it was verified when it was
   *  written, so the store changed under it, and a lost removal must not hand
   *  a key back its power. `fresh` skips this isolate's copy. */
  const heldKeyList = async (env, anchor, fresh = false) => {
    const copy = held.get(anchor)
    if (!fresh && copy && copy.content === env?.CONTENT && copy.written === written
      && Date.now() - copy.at < KEY_LIST_TTL_MS) return copy.value
    const stored = await readKeyChain(env, anchor)
    let value = null
    if (stored) {
      const verdict = verifyKeyListChain(anchor, stored.chain, await signatureCheck(stored.chain))
      value = { keys: new Set(verdict.ok ? verdict.keys : []), verdict }
    }
    if (held.size >= HELD_MAX) held.clear()
    held.set(anchor, { at: Date.now(), content: env?.CONTENT, written, value })
    return value
  }

  /** Does `anchor`'s list here name `key`? A "no" from this isolate's copy is
   *  asked once more of the store before it is believed: the chain that names
   *  a new key may have landed in another isolate a moment ago. */
  const listsKey = async (env, anchor, key) => {
    if ((await heldKeyList(env, anchor))?.keys.has(key)) return true
    return !!(await heldKeyList(env, anchor, true))?.keys.has(key)
  }

  /** The key a signed request acts as, once its signature is checked. A
   *  request may carry `['anchor', <key>]`: when that anchor's list here names
   *  the signer, it acts AS the anchor (a host that trusts one of your keys
   *  accepts the others). Without the tag it acts as its signer, unless the
   *  signer is an anchor whose own list has taken it off: a host refuses
   *  everything a removed key signs from the moment it holds that list
   *  (within a minute in every isolate). A store that cannot be read refuses a
   *  tagged request and lets an untagged one answer for itself, as before. */
  const actingKey = async (env, evt) => {
    const signer = String(evt?.pubkey || '').toLowerCase()
    const anchor = String(tagOf(evt, 'anchor') ?? '').toLowerCase()
    if (anchor && anchor !== signer) {
      if (!SIG_RE.test(anchor)) return { ok: false, reason: 'auth anchor tag is not a key' }
      try {
        if (!await listsKey(env, anchor, signer)) return { ok: false, reason: "this key is not on that anchor's key list here" }
      } catch { return { ok: false, reason: 'the key list for that anchor could not be read' } }
      return { ok: true, pubkey: anchor, signer }
    }
    let own = null
    try { own = await heldKeyList(env, signer) } catch { /* unreadable: the signer answers for itself */ }
    if (own && !own.keys.has(signer)) return { ok: false, reason: 'this key was taken off its own key list' }
    return { ok: true, pubkey: signer, signer }
  }

  /** Why this index event may NOT stand as `anchor`'s index, or null when it
   *  may: signed by the anchor while its own list still names it (or it has
   *  none), or by a key the list names and tagged `['anchor', <anchor>]` — the
   *  tag stops one event being planted under another anchor that also lists
   *  the key. `retry` (the write path) asks the store again before refusing a
   *  key this isolate has not seen listed; a read takes this isolate's copy.
   *  Throws when the store cannot be read. */
  const indexSignerRefusal = async (env, anchor, evt, retry = false) => {
    const signer = String(evt?.pubkey || '').toLowerCase()
    if (signer === anchor) {
      const own = await heldKeyList(env, anchor)
      return own && !own.keys.has(signer) ? 'this key was taken off its own key list' : null
    }
    if (String(tagOf(evt, 'anchor') ?? '').toLowerCase() !== anchor) return 'index event pubkey does not match the hive being written'
    const listed = retry ? await listsKey(env, anchor, signer) : !!(await heldKeyList(env, anchor))?.keys.has(signer)
    return listed ? null : "the index signer is not on this anchor's key list here"
  }

  /** The chain held for `anchor`, byte for byte, or null. */
  const heldKeyChainBytes = async (env, anchor) => (await readKeyChain(env, anchor))?.bytes ?? null

  /** May `offered` replace the chain held for `anchor`? `signer` is the key
   *  that signed the write (NIP-98), which must be named somewhere in the
   *  chain: the chain proves itself, and this only keeps strangers from
   *  filling the store. The writer signs as ITSELF, untagged — a place that
   *  just spent an invite is not on the held list yet. Answers
   *  `{status, reason}`; on 200/201 the chain is held. Two writers racing from
   *  the same held chain: the conditional put takes one and the other is told
   *  to read again. */
  const offerKeyChain = async (env, anchor, signer, body, nowSeconds = Math.floor(Date.now() / 1000)) => {
    if (!SIG_RE.test(String(anchor))) return { status: 400, reason: 'the key list address is not a key' }
    if (body.byteLength > KEY_LISTS_MAX_BYTES) return { status: 413, reason: 'key list chain too large' }
    let offered = null
    try { offered = JSON.parse(new TextDecoder().decode(body)) } catch { /* below */ }
    if (!Array.isArray(offered)) return { status: 400, reason: 'body is not a JSON array of key-list events' }
    if (offered.length > KEY_LIST_MAX_CHAIN) return { status: 400, reason: 'key list chain too long' }
    if (!offered.some((event) => { const list = readKeyList(event); return !!list && isListedKey(list, signer) })) {
      return { status: 403, reason: 'only a key the chain names may carry it here' }
    }
    if (!env?.CONTENT?.put) return { status: 503, reason: 'this host holds no pools' }
    let stored
    try { stored = await readKeyChain(env, anchor) } catch { return { status: 503, reason: 'the key list held here could not be read' } }
    const before = stored?.chain ?? []
    const verdict = acceptKeyListChain(anchor, before, offered, await signatureCheck(offered), nowSeconds)
    if (!verdict.ok) {
      return { status: verdict.reason === 'fork' ? 409 : 400, reason: `key list refused at list ${verdict.at}: ${verdict.reason}` }
    }
    if (offered.length === before.length) return { status: 200, reason: 'key list already current' }
    const onlyIf = !stored ? new Headers({ 'If-None-Match': '*' })
      : stored.etag ? new Headers({ 'If-Match': stored.etag }) : undefined
    written++
    const put = await env.CONTENT.put(await keyChainKey(anchor), JSON.stringify(offered), {
      ...(onlyIf ? { onlyIf } : {}),
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    })
    if (put === null) return { status: 409, reason: 'the key list changed while this one was checked - read it again and retry' }
    return { status: before.length ? 200 : 201, reason: `key list ${verdict.head.seq} held for ${anchor.slice(0, 12)}...` }
  }

  return { heldKeyList, listsKey, actingKey, indexSignerRefusal, heldKeyChainBytes, offerKeyChain }
}
