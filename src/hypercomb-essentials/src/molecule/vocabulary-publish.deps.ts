// molecule/vocabulary-publish.deps.ts
//
// THE LIVE WIRING for `vocabulary-publish.ts`, kept in its own file for one
// reason: the routine itself must be testable without a container, a key, a
// pool or a socket, and this file reaches every one of them.
//
// It is also where the IMPORT COST lives. `readPublicBranches` is exported by
// `presentation/tiles/tile-actions.drone.ts`, which registers a drone at
// module load; the publish routine must not drag that into a spec's module
// graph, so the routine takes its deps as a required argument and this file is
// the only thing that names the drone.

import { SignatureService, acceptVocabularyClaim, get, requestConfirm } from '@hypercomb/core'
import { lineageKey } from '../history/lineage-key.js'
import { PUBLIC_CONTENT_HOSTS, vocabularyRootOf } from '../sharing/hive-link.js'
import { fetchHiveIndex, setHiveRoot } from '../sharing/hive-pointer.js'
import { hostsOfBranch } from '../sharing/community-hosts.js'
import { latestByLineageKey } from '../sharing/publish-heads.js'
import { cachedPubkey, readerPubkey } from '../sharing/head-claim-signer.js'
import { readPublicBranches } from '../presentation/tiles/tile-actions.drone.js'
import { MOLECULE_INDEX_SERVICE_KEY, type MoleculeIndexReader } from './molecule-index.service.js'
import { mintedVocabularyClaim, writeVocabularyRecord } from './vocabulary-ledger.js'
import { readVocabularyEntry, signVocabularyClaim, verifierFor } from './vocabulary-signer.js'
import { contentUrl, vocabularySurface } from './vocabulary-search.js'
import type { VocabularyPublishDeps, VocabularyPublishSummary } from './vocabulary-publish.js'

const HEX64 = /^[0-9a-f]{64}$/

const STORE_KEY = '@hypercomb.social/Store'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'

interface StoreLike { putResource?: (b: Blob) => Promise<string> }
interface HistoryLike {
  sign?: (lineage: { explorerSegments: () => readonly string[] }) => Promise<string>
  headLayer?: (locationSig: string) => Promise<{ layerSig?: string } | null>
}
interface HostSyncLike {
  markPublic?: (sig: string, kind?: string, closure?: boolean) => Promise<void>
  isClosureAvailable?: (sig: string, kind: string, closure: boolean) => Promise<boolean>
  drain?: () => Promise<void>
}

const utf8 = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer

/**
 * THE CONFIRMATION COPY IS LOAD-BEARING, so it is here and not left to a
 * caller. `isCellPublic` prefix-descends, so marking `/work` public declares
 * every DESCENDANT NAME, and a molecule address is sha256 of a short public
 * string that a dictionary inverts. The prompt must therefore say that tile
 * NAMES in these subtrees become publicly derivable — not merely "publish your
 * vocabulary", which sounds like a setting.
 */
const askParticipant = async (summary: VocabularyPublishSummary): Promise<boolean> => {
  if (summary.withdrawal) {
    return await requestConfirm({
      title: 'Withdraw your vocabulary',
      message:
        'Sign a claim that declares NOTHING. Readers who ask which words you hold will get a signed empty answer instead of "unknown". Nothing already published is deleted.',
      confirmLabel: 'Withdraw',
      danger: true,
    })
  }
  const where = summary.branches.length
    ? summary.branches.join(', ')
    : '(no published branch)'
  return await requestConfirm({
    title: 'Declare the words you hold',
    message:
      `Sign and publish ${summary.words} word address${summary.words === 1 ? '' : 'es'} from ${where}. ` +
      'A word address is a hash of a TILE NAME, and a short name is invertible by dictionary — so the names in these subtrees become publicly derivable by anyone who asks your host. ' +
      (summary.complete ? '' : 'This picture is INCOMPLETE and the claim will say so. ') +
      `The claim is served from ${summary.host}.`,
    confirmLabel: 'Publish vocabulary',
  })
}

/** The door the index is advanced on: the branch marks first, then the
 *  standing public endpoint — the same order `publishBranch` resolves. */
const indexHost = async (): Promise<string> => {
  try {
    for (const path of readPublicBranches()) {
      const segments = path.split('/').map((s) => s.trim()).filter(Boolean)
      if (segments.length === 0) continue
      const zones = await hostsOfBranch(segments)
      const first = zones?.[0]
      if (first) return `content.${first}`
    }
  } catch { /* fall through to the standing endpoint */ }
  return PUBLIC_CONTENT_HOSTS[0] ?? ''
}

/**
 * The claim my OWN index currently names, read back through a door, and
 * VERIFIED BEFORE IT IS BELIEVED.
 *
 * It used to be taken on the host's word — "the worst a lie can buy is a gap
 * in my own sequence" — and that was wrong twice over. Any host, or any cache
 * in front of one, can serve arbitrary JSON at that address:
 *
 *   * `prev` from it is SIGNED INTO MY REAL CLAIM. Line 5 of the preimage
 *     exists precisely "so a genuine claim cannot be re-parented", and an
 *     invented `prev` gets me to re-parent it myself.
 *   * `seq` from it is signed AND written to my permanent ledger. Paired with
 *     an unbounded counter that was an unrecoverable publish DoS in two
 *     publishes; core now caps `seq` at `MAX_CLAIM_SEQ`, and this call now
 *     refuses anything that is not MY OWN SIGNATURE at THIS surface.
 *
 * A publisher must never sign a counter or a parent it did not derive from
 * something authenticated.
 */
const readHeld = async (
  host: string,
  pubkey: string,
): Promise<{ body: string; seq: number } | null> => {
  const surface = String(await vocabularySurface().catch(() => '')).toLowerCase()
  if (!HEX64.test(surface) || !HEX64.test(pubkey)) return null
  const index = await fetchHiveIndex(host, pubkey)
  if (!index.ok) return null
  const claimSig = vocabularyRootOf(index.manifest.roots)
  if (!claimSig) return null
  try {
    const res = await fetch(contentUrl(host, claimSig), { cache: 'no-store' })
    if (!res.ok) return null
    const bytes = await res.arrayBuffer()
    if ((await SignatureService.sign(bytes)).toLowerCase() !== claimSig) return null
    const read = readVocabularyEntry(new Uint8Array(bytes))
    if (!read) return null
    // The address is rendered by ME — my key, my surface — exactly as a
    // stranger's claim is checked. A claim for another key, another surface,
    // or no valid signature at all is not my chain.
    const verdict = await acceptVocabularyClaim(
      { pubkey, surface }, read.offered, verifierFor(read.event),
    )
    if (!verdict.authentic) return null
    return { body: verdict.claim.body, seq: verdict.claim.seq }
  } catch { return null }
}

/** The live wiring. Nothing here is called until `publishVocabulary` is. */
export const defaultVocabularyPublishDeps = (): VocabularyPublishDeps => ({
  surface: vocabularySurface,
  publicKey: readerPubkey,
  host: indexHost,

  publicBranches: () => { try { return readPublicBranches() } catch { return [] } },
  // `cachedPubkey()`, NEVER `readerPubkey()`: this runs BEFORE the
  // confirmation, and resolving a key mints and persists one. An empty key
  // reads the whole local ledger, which is this device's own acts either way
  // — a wider floor, never a wider claim.
  publishedKeys: async () => {
    try { return new Set((await latestByLineageKey(cachedPubkey() ?? '')).keys()) }
    catch { return new Set<string>() }
  },
  lineageKeyOf: (segments) => lineageKey([...segments]),
  headOf: async (segments) => {
    const history = get<HistoryLike>(HISTORY_KEY)
    if (!history?.sign || !history?.headLayer) return null
    try {
      const location = await history.sign({ explorerSegments: () => [...segments] })
      return (await history.headLayer(location))?.layerSig ?? null
    } catch { return null }
  },
  // `subtreeVocabulary`, NEVER the raw `readRecord`. The pool is declared
  // `index` kind — wipe-safe, GC-able, licensed to be empty — and the raw
  // reader never derives, so a wipe used to turn a publishable claim into a
  // refusal. That is a different ANSWER from a cache, not a slower one.
  readRecord: async (layerSig) => {
    const reader = get<MoleculeIndexReader>(MOLECULE_INDEX_SERVICE_KEY)
    if (!reader?.subtreeVocabulary) return null
    try { return await reader.subtreeVocabulary(layerSig) } catch { return null }
  },

  hash: async (text) => await SignatureService.sign(utf8(text)),
  readHeld,
  readMinted: mintedVocabularyClaim,

  confirm: askParticipant,

  sign: (surface, body, prev, seq, count, complete) =>
    signVocabularyClaim(surface, body, prev, seq, count, complete),
  putResource: async (text) => {
    const store = get<StoreLike>(STORE_KEY)
    if (!store?.putResource) throw new Error('Store.putResource is not available')
    return await store.putResource(new Blob([text], { type: 'application/json' }))
  },
  markPublic: async (sig, kind, closure) => {
    const sync = get<HostSyncLike>(HOST_SYNC_KEY)
    await sync?.markPublic?.(sig, kind, closure)
    void sync?.drain?.()
  },
  available: async (sig) => {
    const sync = get<HostSyncLike>(HOST_SYNC_KEY)
    if (!sync?.isClosureAvailable) return false
    try { return (await sync.isClosureAvailable(sig, 'resource', false)) === true } catch { return false }
  },
  setRoot: async (host, key, sig) => {
    const result = await setHiveRoot(host, key, sig)
    return { ok: result.ok, ...(result.reason ? { reason: result.reason } : {}) }
  },
  writeRecord: writeVocabularyRecord,
})

// ---------------------------------------------------------------------------
// THE DOOR, RE-EXPORTED — the only route a surface may take to it
// ---------------------------------------------------------------------------
//
// `vocabulary-publish.accidental.spec.ts` walks every non-spec `.ts` in
// essentials and shared and fails if the source names the routine's own
// module, exempting only that module and this one. A surface therefore cannot
// import the door directly, and the allowlist stays EMPTY.
//
// Re-exporting here is a TIGHTENING, not a loosening. After it, the door is
// unreachable without also holding `defaultVocabularyPublishDeps` in the same
// import — so a caller cannot hand-roll a deps object with its own `confirm`
// and quietly replace the load-bearing copy above. That substitution is the
// actual thing the ratchet defends.
//
// `vocabulary.queen.spec.ts` names the single permitted caller.

export { publishVocabulary, withdrawVocabulary } from './vocabulary-publish.js'
export type {
  VocabularyPublishDeps,
  VocabularyPublishFailure,
  VocabularyPublishResult,
  VocabularyPublishSummary,
} from './vocabulary-publish.js'
