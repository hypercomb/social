// core/index-signer.ts
//
// WHOSE INDEX IS THIS? One answer for every reader of a signed hive index
// (kind 30564, the member of sign('hive:indexes') named by its anchor).
//
// An index stands as the anchor's when the anchor signed it, OR when a key the
// anchor's signed key list names signed it on an event tagged
// ['anchor', <anchor>] (key-list.ts; becoming-a-host.md, "Letting another
// place publish for you"). The tag stops one event standing under another
// anchor whose list also names the key. The worker accepts exactly these
// writes (blossom-worker key-lists.js indexSignerRefusal), so a reader that
// asks only "did the anchor sign it?" calls a phone's publish forged: on
// 2026-11-27 a device-signed index left business-card.jwize.com saying "This
// site offers no package yet".
//
// The list is read from the same host that served the index, and only for an
// index the anchor did not sign itself. Signature checks stay with the caller,
// which verifies the index event as it always did; the list's own events are
// verified here with the caller's verifier. The chain itself is the proof, so
// a reader that must check offline (a resolved offer kept for later) carries
// the chain and re-walks it: no verdict is ever trusted from data.
import { registerPoolMeaning } from './pool-registry.js'
import { KEY_LIST_MAX_CHAIN, KEY_LIST_MEANING, verifyKeyListChain, type SignedKeyList } from './key-list.js'

const SIG = /^[0-9a-f]{64}$/
// What a host keeps for one anchor at most (blossom-worker KEY_LISTS_MAX_BYTES).
const LIST_MAX_BYTES = 262_144
// A list read is remembered this long per door and anchor, as essentials
// key-list.client.ts remembers its own: one publisher's offerings ask once.
const LIST_READ_TTL_MS = 60_000
const LIST_READS_MAX = 256

/** A nostr event verifier (id + signature). May be async; the key-list walk is not. */
export type IndexEventVerifier = (event: Record<string, unknown>) => boolean | Promise<boolean>

/** A verified key list: the keys it names now, and the chain that proves it. */
export type ListedSigners = { keys: ReadonlySet<string>; chain: readonly SignedKeyList[] }

const reads = new Map<string, { at: number; read: Promise<ListedSigners | null> }>()

/** Does `event` say it is for `anchor`, by its ['anchor', <anchor>] tag? */
const taggedFor = (event: Record<string, unknown>, anchor: string): boolean =>
  (Array.isArray(event?.['tags']) ? event['tags'] as unknown[] : [])
    .some(tag => Array.isArray(tag) && tag[0] === 'anchor' && String(tag[1] ?? '').toLowerCase() === anchor)

/** Would `event` stand on a list's word alone — another well-formed key,
 *  tagged for this anchor? Only then is the anchor's list worth reading. */
export function indexAsksForList(event: Record<string, unknown>, anchor: string): boolean {
  const key = String(anchor ?? '').toLowerCase()
  const signer = String(event?.['pubkey'] ?? '').toLowerCase()
  return SIG.test(key) && SIG.test(signer) && signer !== key && taggedFor(event, key)
}

/** The same rule, with the list's keys already in hand (null: no list). */
export function indexStandsWith(event: Record<string, unknown>, anchor: string, keys: ReadonlySet<string> | null | undefined): boolean {
  const key = String(anchor ?? '').toLowerCase()
  const signer = String(event?.['pubkey'] ?? '').toLowerCase()
  if (!SIG.test(key) || !SIG.test(signer)) return false
  if (signer === key) return true
  return taggedFor(event, key) && keys?.has(signer) === true
}

/** Does `event` stand as `anchor`'s index? The anchor's own signature, or a
 *  key `listed` names on an event tagged for this anchor. `listed` is asked
 *  only in the second case. The event's signature is the caller's to check. */
export async function indexStandsFor(
  event: Record<string, unknown>,
  anchor: string,
  listed: () => Promise<ReadonlySet<string> | null>,
): Promise<boolean> {
  if (indexStandsWith(event, anchor, null)) return true
  if (!indexAsksForList(event, anchor)) return false
  try { return indexStandsWith(event, anchor, await listed()) } catch { return false }
}

/** The keys a chain names now, walked with a synchronous verifier — the
 *  offline check of a chain a reader carried (null: it does not verify). */
export function chainSigners(anchor: string, chain: unknown, verify: (event: Record<string, unknown>) => boolean): ReadonlySet<string> | null {
  if (!Array.isArray(chain) || !chain.length || chain.length > KEY_LIST_MAX_CHAIN) return null
  const verdict = verifyKeyListChain(anchor, chain as SignedKeyList[], event => {
    try { return verify(structuredClone(event) as unknown as Record<string, unknown>) } catch { return false }
  })
  return verdict.ok ? new Set(verdict.keys) : null
}

const readList = async (origin: string, anchor: string, verify: IndexEventVerifier): Promise<ListedSigners | null> => {
  let chain: unknown
  try {
    const pool = await registerPoolMeaning(KEY_LIST_MEANING)
    const response = await fetch(`${origin}/${pool}/${anchor}`, { cache: 'no-store' })
    if (!response.ok || Number(response.headers?.get?.('content-length') ?? 0) > LIST_MAX_BYTES) return null
    const body = await response.text()
    if (body.length > LIST_MAX_BYTES) return null
    chain = JSON.parse(body)
  } catch { return null }
  // Bounded BEFORE any signature is checked: a door cannot make a reader
  // verify more than one chain's worth of events.
  if (!Array.isArray(chain) || !chain.length || chain.length > KEY_LIST_MAX_CHAIN) return null
  // Verified first, in order, with whatever verifier the caller holds (it may
  // be async), stopping at the first that fails; the walk then reads the
  // verdicts. A copy keeps a verifier that caches its verdict on the object
  // (nostr-tools) off the chain itself.
  const verdicts = new Map<unknown, boolean>()
  for (const event of chain) {
    let ok = false
    try { ok = !!event && typeof event === 'object' && await verify(structuredClone(event) as Record<string, unknown>) } catch { ok = false }
    verdicts.set(event, ok)
    if (!ok) break
  }
  const verdict = verifyKeyListChain(anchor, chain as SignedKeyList[], event => verdicts.get(event) === true)
  return verdict.ok ? { keys: new Set(verdict.keys), chain: chain as SignedKeyList[] } : null
}

/** The verified key list `anchor` holds on `origin` (its keys and the chain),
 *  or null when that host holds none, it does not verify, or it could not be
 *  read. Remembered for a minute per door and anchor. */
export function listedChainAt(origin: string, anchor: string, verify: IndexEventVerifier): Promise<ListedSigners | null> {
  const key = String(anchor ?? '').toLowerCase()
  if (!SIG.test(key)) return Promise.resolve(null)
  const base = String(origin ?? '').replace(/\/+$/, '')
  const id = `${base}|${key}`
  const held = reads.get(id)
  if (held && Date.now() - held.at < LIST_READ_TTL_MS) return held.read
  if (reads.size >= LIST_READS_MAX) reads.clear()
  const read = readList(base, key, verify)
  reads.set(id, { at: Date.now(), read })
  return read
}

/** The keys `anchor`'s key list on `origin` names now, or null. */
export async function listedSignersAt(origin: string, anchor: string, verify: IndexEventVerifier): Promise<ReadonlySet<string> | null> {
  return (await listedChainAt(origin, anchor, verify))?.keys ?? null
}

/** Forget remembered list reads (a spec, or a reader that just wrote a list). */
export const forgetListedChains = (): void => { reads.clear() }
