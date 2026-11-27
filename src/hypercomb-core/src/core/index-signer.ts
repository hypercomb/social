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
// verified here with the caller's verifier.
import { registerPoolMeaning } from './pool-registry.js'
import { KEY_LIST_MEANING, verifyKeyListChain, type SignedKeyList } from './key-list.js'

const SIG = /^[0-9a-f]{64}$/
const LIST_MAX_BYTES = 1_048_576

/** A nostr event verifier (id + signature). May be async; the key-list walk is not. */
export type IndexEventVerifier = (event: Record<string, unknown>) => boolean | Promise<boolean>

/** The keys `anchor`'s key list on `origin` names now, or null when that host
 *  holds no list, the list does not verify, or it could not be read. */
export async function listedSignersAt(origin: string, anchor: string, verify: IndexEventVerifier): Promise<ReadonlySet<string> | null> {
  if (!SIG.test(anchor)) return null
  let chain: unknown
  try {
    const pool = await registerPoolMeaning(KEY_LIST_MEANING)
    const response = await fetch(`${origin.replace(/\/+$/, '')}/${pool}/${anchor}`, { cache: 'no-store' })
    if (!response.ok || Number(response.headers?.get?.('content-length') ?? 0) > LIST_MAX_BYTES) return null
    const body = await response.text()
    if (body.length > LIST_MAX_BYTES) return null
    chain = JSON.parse(body)
  } catch { return null }
  if (!Array.isArray(chain)) return null
  // Verified first, with whatever verifier the caller holds (it may be async);
  // the walk then reads the verdicts. A copy keeps a verifier that caches its
  // verdict on the object (nostr-tools) off the chain itself.
  const verdicts = new Map<unknown, boolean>()
  for (const event of chain) {
    let ok = false
    try { ok = !!event && typeof event === 'object' && await verify(structuredClone(event) as Record<string, unknown>) } catch { ok = false }
    verdicts.set(event, ok)
  }
  const verdict = verifyKeyListChain(anchor, chain as SignedKeyList[], event => verdicts.get(event) === true)
  return verdict.ok ? new Set(verdict.keys) : null
}

/** Does `event` stand as `anchor`'s index? The anchor's own signature, or a
 *  key `listed` names on an event tagged for this anchor. `listed` is asked
 *  only in the second case. The event's signature is the caller's to check. */
export async function indexStandsFor(
  event: Record<string, unknown>,
  anchor: string,
  listed: () => Promise<ReadonlySet<string> | null>,
): Promise<boolean> {
  const key = String(anchor ?? '').toLowerCase()
  const signer = String(event?.['pubkey'] ?? '').toLowerCase()
  if (!SIG.test(key) || !SIG.test(signer)) return false
  if (signer === key) return true
  const tags = Array.isArray(event['tags']) ? event['tags'] as unknown[] : []
  if (!tags.some(tag => Array.isArray(tag) && tag[0] === 'anchor' && String(tag[1] ?? '').toLowerCase() === key)) return false
  try { return (await listed())?.has(signer) === true } catch { return false }
}
