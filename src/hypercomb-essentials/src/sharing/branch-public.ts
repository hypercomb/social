// sharing/branch-public.ts
//
// PUBLIC MEANS PUBLISHED AND IN THE COMMUNITY (jwize, 2026-11-12: "I mean
// public should be mean published and in the community").
//
// Three states, one word each:
//
//   private    — only in this hive;
//   published  — on a host, its root named in this key's own signed index
//                there. Anyone holding a signature can read it; it is not
//                public;
//   public     — published AND in the community: the showcase record this key
//                signed for that host (`showcase:<zone>`, showcase-record.ts)
//                turns the branch on, by name or by showing the domain in full.
//
// The branch is the place you stand or the nearest tile above it that wears a
// host mark (community-hosts.ts) — the root a Publish names. Its index key is
// `lineageKey(segments)`, the same key the publications ledger and the
// showcase item carry. A branch is public when ANY host it publishes to has
// both: its root in the index and the branch on in the showcase.
//
// Never more than can be proven (the publish-status discipline): a cold layer
// or an index or showcase that cannot be read is UNKNOWN, never public.
//
// Pure apart from `liveBranchPublicDeps`.

import { lineageKey } from '@hypercomb/core'
import { showcases, type Showcase } from './showcase-record.js'

/** The effect the breadcrumb listens to: the state of the place you stand. */
export const BRANCH_PUBLIC_EFFECT = 'branch:public'

/** What the breadcrumb hears. `public` is true only when it was proven;
 *  `null` means it could not be told yet. `key` is the place it is about. */
export interface BranchPublicState {
  readonly key: string
  readonly public: boolean | null
  /** The branch the answer is about, when one was found. */
  readonly lineage?: string
  /** The host on which it is public, when it is. */
  readonly zone?: string
}

export interface BranchPublicDeps {
  /** The hosts a branch publishes to, primary first; null when not known yet. */
  hostsAt(segments: readonly string[]): Promise<readonly string[] | null>
  /** This key's own signed index root for `lineage` on `zone`, or null. */
  publishedRoot(zone: string, lineage: string): Promise<string | null>
  /** This key's signed showcase for `zone`; null when there is none. Throws
   *  when it could not be read (unknown, not absent). */
  showcase(zone: string): Promise<Showcase | null>
  /** This key, lowercase hex; '' when there is no signer. */
  pubkey(): Promise<string>
}

/** The place's key: its segments as the breadcrumb knows them. */
export const placeKey = (segments: readonly string[]): string => segments.join('\u0000')

/**
 * Is the place at `segments` public? Walks from the place up to the first tile
 * that wears a host mark; that branch is checked on each of its hosts.
 */
export async function branchPublicAt(segments: readonly string[], deps: BranchPublicDeps): Promise<BranchPublicState> {
  const key = placeKey(segments)
  for (let depth = segments.length; depth >= 1; depth--) {
    const branch = segments.slice(0, depth)
    const hosts = await deps.hostsAt(branch).catch(() => null)
    // A cold layer is not "no marks": the answer is unknown, not private.
    if (hosts === null) return { key, public: null }
    if (!hosts.length) continue
    const lineage = lineageKey(branch)
    const pubkey = (await deps.pubkey().catch(() => '')).toLowerCase()
    if (!lineage || !/^[0-9a-f]{64}$/.test(pubkey)) return { key, public: false, lineage }
    let unknown = false
    for (const zone of hosts) {
      const root = await deps.publishedRoot(zone, lineage).catch(() => null)
      if (!root) continue
      let showcase: Showcase | null
      try { showcase = await deps.showcase(zone) } catch { unknown = true; continue }
      if (showcase && showcases(showcase, { pubkey, lineage }, [zone])) return { key, public: true, lineage, zone }
    }
    return { key, public: unknown ? null : false, lineage }
  }
  // Nothing above the place publishes anywhere: it is in this hive only.
  return { key, public: false }
}

// ── the live reads ─────────────────────────────────────────────────────────

/** The hive's own reads, each memoized for a short while: a breadcrumb asks
 *  on every step, and an index or showcase does not change between steps
 *  unless a publish or a showcase switch says so (`forget`). */
export const liveBranchPublicDeps = (memoMs = 60_000): BranchPublicDeps & { forget(): void } => {
  const memo = new Map<string, { at: number; value: Promise<unknown> }>()
  const remember = <T,>(key: string, read: () => Promise<T>): Promise<T> => {
    const hit = memo.get(key)
    if (hit && Date.now() - hit.at < memoMs) return hit.value as Promise<T>
    const value = read()
    memo.set(key, { at: Date.now(), value })
    // A failed read is not remembered: the next step asks again.
    value.catch(() => { if (memo.get(key)?.value === value) memo.delete(key) })
    return value
  }
  return {
    hostsAt: async (segments) => (await import('./community-hosts.js')).hostsOfBranchKnown(segments),
    publishedRoot: (zone, lineage) =>
      remember(`root\u0000${zone}\u0000${lineage}`, async () => (await import('./hive-pointer.js')).ownHiveRoot(zone, lineage)),
    showcase: (zone) =>
      remember(`showcase\u0000${zone}`, async () => (await import('./showcase-record.js')).readSignedShowcase(zone)),
    pubkey: () => remember('pubkey', async () => (await import('./key-list.client.js')).publisherKeyHex()),
    forget: () => memo.clear(),
  }
}
