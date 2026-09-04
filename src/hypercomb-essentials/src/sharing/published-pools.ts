// sharing/published-pools.ts
//
// WHAT A DOMAIN OFFERS — the probe that reads it, for ANY meaning.
//
// A participant's own pools of meaning live in OPFS as directories of
// sig-named members. A DOMAIN cannot offer a directory: static hosts (Azure
// blob, R2, a plain web server) serve files, and there is no listing. So a
// domain publishes the same pool as ONE FILE AT THE POOL'S OWN ADDRESS —
// `<origin>/<sign(meaning)>` — holding the index of its members:
//
//     { "meaning": "llm:providers", "members": ["<sig>", "<sig>", …] }
//
// The address needs no convention because it is DERIVED: any client computes
// `sign('llm:providers')` and knows exactly where to look, on any host, with
// one request. A 404 is the normal answer for a domain that offers nothing,
// and costs one HEAD-sized miss.
//
// ── this is a general configuration vector, not an AI feature ─────────────
//
// Nothing here knows what a provider is. A MEANING is claimed by whoever
// cares about it (`registerPublishedPool`), and the handler decides what a
// member means and whether to keep it. `llm:providers` is simply the first
// one; a domain could publish themes, keymaps, behaviours, or a vocabulary
// the same way, and this file would not change.
//
// ── trust ─────────────────────────────────────────────────────────────────
//
// Two gates, both mechanical:
//
//   1. EVERY MEMBER IS VERIFIED. A domain names a sig; the bytes it serves
//      must hash to that sig or they are dropped. A domain can therefore
//      only ever offer content it cannot forge the identity of — the same
//      rule the content broker applies to swarm bytes.
//   2. THE ORIGIN RIDES ALONG. Handlers are told which domain offered the
//      record, so provenance can be shown to the participant and a record
//      that asks for something sensitive (a spec naming an endpoint your key
//      would go to) can be held until they say yes.
//
// Probing is once per (origin, meaning) per session, and only for domains
// this participant already learned — the broker's `domain:learned` effect,
// which fires for the self domain, community domains, and any host the mesh
// or an adopt handoff taught us.

import { EffectBus, poolKindOfMeaning, registerPoolMeaning, SignatureService } from '@hypercomb/core'
import { allows as intakeAllows } from '../pheromones/intake-filter.js'

/** How many members one domain may offer per meaning. A published index is
 *  a curated list, not a database dump; past this something is wrong and we
 *  would be spending the participant's bandwidth finding out. */
const MAX_MEMBERS = 64

/** Cap on one member's bytes. Specs are small; this stops a hostile index
 *  from turning a probe into a download. */
const MAX_MEMBER_BYTES = 256 * 1024

/** What a claimed meaning does with the records a domain publishes. */
export type PublishedPoolHandler = {
  /** The pool meaning, e.g. `llm:providers`. Colon-carrying, per doctrine. */
  readonly meaning: string
  /**
   * Take one verified member. `origin` is the host that offered it, for
   * provenance and for any "is this asking for too much?" decision the
   * handler wants to make. Return an id when kept, null when declined —
   * the probe only logs, never decides.
   */
  accept(record: unknown, origin: string): Promise<string | null>
}

const handlers = new Map<string, PublishedPoolHandler>()

/** Claim a meaning. Later claims for the same meaning replace the earlier
 *  one (hot-reload safe); two modules claiming one meaning is a programming
 *  error the console will show as duplicate work, not a merge. */
export const registerPublishedPool = (handler: PublishedPoolHandler): void => {
  const meaning = String(handler?.meaning ?? '').trim()
  if (!meaning) throw new Error('[published-pools] handler must declare a meaning')
  if (!meaning.includes(':')) {
    throw new Error(
      `[published-pools] meaning "${meaning}" must carry a colon — a bare word collides with a lineage bag`,
    )
  }
  // THE DECLARED KIND, READ. `replicates` is the one fact that answers "may
  // this pool be OFFERED to a stranger at all", and until now nothing asked.
  //
  // It REFUSES and never widens: the offered set can only get smaller, no byte
  // moves, no reference is removed, and nothing here reaches a delete. It also
  // changes nothing today — both live handlers are `set` — which is the point:
  // what it buys is that `molecule:index` (SEED-declared `index`) can never be
  // registered as a published pool. Serving a wipe-safe, GC-able derived cache
  // as if it were an answer is exactly the mistake the vocabulary claim exists
  // to prevent, and this turns that argument into a mechanism.
  //
  // UNDECLARED IS PERMITTED, deliberately — that is the conservative direction
  // here and it preserves today's behaviour byte for byte. A kind is a
  // declaration by whoever mints the pool, and its absence is not a licence to
  // guess.
  const facts = poolKindOfMeaning(meaning)
  if (facts && !facts.replicates) {
    throw new Error(
      `[published-pools] meaning "${meaning}" is declared ${facts.kind} — ` +
      `${facts.kind === 'index'
        ? 'a derived cache is never sent'
        : 'a per-participant document is never sent'}`,
    )
  }
  handlers.set(meaning, handler)
}

/** Meanings currently claimed. */
export const publishedPoolMeanings = (): string[] => [...handlers.keys()]

// ── addressing ──────────────────────────────────────────────────────────

/**
 * `sign(meaning)` — through the REGISTRY, which memoises and REGISTERS in one
 * call.
 *
 * It used to derive through a private memo and a raw `SignatureService.sign`,
 * bypassing `registerPoolMeaning` — every other addressing site in the tree was
 * corrected to register (`runtime/store.ts`, `host-sync.service.ts`,
 * `acquire.ts`). A meaning known ONLY through a published-pool handler
 * therefore never entered the core registry, so `isPoolAddress` could not see
 * it: the swarm walk's pool-exclusion set, history's bag-removal refusal and
 * folder-sync's pool labelling would all have been blind to that address. Both
 * current meanings happen to be seeded, so nothing is broken today; a
 * module-minted one would have been.
 *
 * Registering also lets `poolKindOfAddress` resolve the address back to its
 * declared kind.
 */
const poolAddress = (meaning: string): Promise<string> => registerPoolMeaning(meaning)

/** A bare host from anything host-shaped. Empty when it is not usable. */
export const originHost = (raw: string): string => {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    // ws/wss relays are mesh addresses, not content hosts — the same string
    // often names both, and fetching a relay's root is a guaranteed miss.
    const scheme = url.protocol.replace(':', '')
    if (scheme !== 'http' && scheme !== 'https' && scheme !== 'ws' && scheme !== 'wss') return ''
    return url.host
  } catch { return '' }
}

/** Where a host's content lives. Loopback keeps http so a participant can
 *  serve their own machine; everything else is https. */
const originUrl = (host: string): string => {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)
  return `${local ? 'http' : 'https'}://${host}`
}

// ── the probe ───────────────────────────────────────────────────────────

/** One index shape, permissively read: a bare array, or `{ members: [...] }`. */
const membersOf = (parsed: unknown): string[] => {
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { members?: unknown })?.members)
      ? (parsed as { members: unknown[] }).members
      : []
  return list
    .map(entry => String(entry ?? '').trim().toLowerCase())
    .filter(sig => /^[a-f0-9]{64}$/.test(sig))
    .slice(0, MAX_MEMBERS)
}

/** Fetch one member and prove it is what the index called it. */
const verifiedMember = async (origin: string, sig: string): Promise<unknown | null> => {
  let response: Response
  try {
    response = await fetch(`${originUrl(origin)}/${sig}`)
  } catch { return null }
  if (!response.ok) return null

  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > MAX_MEMBER_BYTES) {
    console.warn(`[published-pools] ${origin} member ${sig.slice(0, 12)}… is too large — dropped`)
    return null
  }
  // THE GATE. A domain that names a sig must serve bytes that hash to it;
  // anything else is a different record wearing a trusted name.
  const actual = await SignatureService.sign(bytes)
  if (actual !== sig) {
    console.warn(`[published-pools] ${origin} served ${actual.slice(0, 12)}… for ${sig.slice(0, 12)}… — dropped`)
    return null
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch { return null }
}

/** (origin, meaning) already probed this session — a 404 counts. */
const probed = new Set<string>()

/** What a host has DECLARED and this participant has not yet PLACED. Keyed
 *  `origin::meaning`; memory only — an offer is a fact about a host, and the
 *  host will say it again. */
export type PublishedOffer = { origin: string; meaning: string; sig: string; record: unknown }
const offers = new Map<string, PublishedOffer[]>()

/** The standing offers, all of them or one origin's. */
export const offeredPools = (origin?: string): PublishedOffer[] => {
  const host = origin ? originHost(origin) : ''
  const out: PublishedOffer[] = []
  for (const [key, list] of offers) {
    if (host && !key.startsWith(`${host}::`)) continue
    out.push(...list)
  }
  return out
}

/**
 * THE GESTURE. Hand one origin's offers (one meaning's, or all of them) to
 * their handlers. Returns the ids kept. This is the only path to
 * `handler.accept`, and nothing calls it on a visit, on `domain:learned`,
 * or on a schedule — a surface calls it because the participant said yes.
 */
export const placeOffers = async (rawOrigin: string, meaning?: string): Promise<string[]> => {
  const origin = originHost(rawOrigin)
  if (!origin) return []
  const kept: string[] = []
  for (const [key, list] of [...offers]) {
    if (!key.startsWith(`${origin}::`)) continue
    if (meaning && key !== `${origin}::${meaning}`) continue
    const handler = handlers.get(key.slice(origin.length + 2))
    if (!handler) continue
    offers.delete(key)
    for (const offer of list) {
      try {
        const id = await handler.accept(offer.record, origin)
        if (id) kept.push(id)
      } catch (err) {
        console.warn(`[published-pools] ${origin} offered a ${offer.meaning} record that was refused:`, err)
      }
    }
  }
  if (kept.length) console.log(`[published-pools] placed ${kept.length} from ${origin}: ${kept.join(', ')}`)
  return kept
}

/** NOT NOW. Drop one origin's offers (one meaning's, or all) without placing
 *  them. Memory only, so the host offers again the next time it is learned;
 *  the window says so. Nothing is written, so nothing is deleted. */
export const dismissOffers = (rawOrigin: string, meaning?: string): void => {
  const origin = originHost(rawOrigin)
  if (!origin) return
  for (const key of [...offers.keys()]) {
    if (!key.startsWith(`${origin}::`)) continue
    if (meaning && key !== `${origin}::${meaning}`) continue
    offers.delete(key)
  }
}

/** Test seam. */
export const _resetOffers = (): void => { offers.clear(); probed.clear() }

/**
 * Read one meaning from one domain. Returns the sigs OFFERED — verified,
 * admitted by the intake gate, and held for a gesture. Nothing is placed:
 * a host declaring what it holds is not a host putting it in your world
 * (`the-algorithm-is-the-application.md` — "nothing enters your world
 * because someone else decided it should"). `placeOffers` is the act.
 *
 * Silent about the ordinary: a domain with nothing to offer answers 404 and
 * produces no output at all. Only a domain that publishes something, or one
 * that publishes something WRONG, is worth a line in the console.
 */
export const probePublishedPool = async (
  rawOrigin: string,
  meaning: string,
  options: { force?: boolean } = {},
): Promise<string[]> => {
  const origin = originHost(rawOrigin)
  const handler = handlers.get(meaning)
  if (!origin || !handler) return []

  const once = `${origin}::${meaning}`
  if (!options.force && probed.has(once)) return []
  probed.add(once)

  let index: unknown
  try {
    const response = await fetch(`${originUrl(origin)}/${await poolAddress(meaning)}`)
    if (!response.ok) return []              // the normal answer
    index = await response.json()
  } catch { return [] }                      // offline, CORS, not a content host

  const members = membersOf(index)
  if (!members.length) return []

  const offered: PublishedOffer[] = []
  for (const sig of members) {
    const record = await verifiedMember(origin, sig)
    if (record === null) continue
    // THE INTAKE GATE. Verification answered "are these the bytes the domain
    // named"; it cannot answer "do I want them". One pass per member, at most
    // MAX_MEMBERS of them per domain per session, so it can afford the awaited
    // record read. A published member has only ever had a signature to be
    // judged by, which is why this call site needed no change when the gate
    // dropped the location carrier — it was already asking the right question.
    // Allows everything until the participant expresses an interest. An offer
    // the gate refuses is never even shown.
    if (!await intakeAllows({ sig })) continue
    offered.push({ origin, meaning, sig, record })
  }
  if (offered.length) {
    offers.set(once, offered)
    console.log(`[published-pools] ${origin} offers ${offered.length} ${meaning} — held for a gesture`)
    EffectBus.emit('published-pools:offered', { origin, meaning, count: offered.length })
  }
  return offered.map(o => o.sig)
}

/** Read EVERY claimed meaning from one domain. What learning a domain
 *  means for configuration: ask it, once, what it has — and HOLD the answer. */
export const probeDomain = async (rawOrigin: string, options: { force?: boolean } = {}): Promise<string[]> => {
  const origin = originHost(rawOrigin)
  if (!origin) return []
  const kept: string[] = []
  for (const meaning of handlers.keys()) {
    kept.push(...await probePublishedPool(origin, meaning, options))
  }
  return kept
}

// ── the trigger ─────────────────────────────────────────────────────────
//
// `domain:learned` is emitted by the content broker for every host this
// participant comes to know: the self domain, community domains, a host the
// mesh attributed, and the one an adopt handoff passes in. Probing there
// means "configuration arrives with the domain" without any surface having
// to remember to ask.
//
// Deliberately NOT gated on a live renderer, a UI, or an install: a probe is
// one conditional GET, and it PLACES NOTHING. What it learns waits in
// `offeredPools` until a surface calls `placeOffers` on the participant's
// yes. This used to call `handler.accept` straight from the visit, which
// made a host that declares a provider spec into a host that installs one.

EffectBus.on('domain:learned', (payload: unknown) => {
  const host = String((payload as { host?: unknown })?.host ?? '')
  if (host) void probeDomain(host)
})
