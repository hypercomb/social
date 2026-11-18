// sharing/tile-visibility.ts
//
// PUBLIC AND PRIVATE, SET FROM THE TILE (jwize 2026-11-18: "public and private should be able to be set from the tiles
// themselves … we can type a word").
//
// The two words are the two ends of what branch-public.ts reads:
//
//   public    the tile is staged on the hosts it names (staged now, with consent, when it is on none) and switched ON in
//             the community of each — published AND in the community, the only thing "public" means.
//   private   the tile is KEPT ON ITS HOSTS AS CIPHERTEXT ONLY this key opens (private-keep.ts), so every machine that
//             holds the key can bring it in (`private sync`). A tile that was staged is first switched OFF in the
//             community of each host, and once the sealed copy is kept its plain root is withdrawn from the signed
//             index and the hosts are asked to forget its plain bytes — after the participant says yes, in words.
//
// Both ride the acts that already exist — the stage gesture, the community switch (showcase-bridge.ts applyToggle, signed
// under this key, last one wins), the sealed closure (sealed-publish.ts), withdrawal and remove-from-my-hosts
// (publish-branch.ts).
//
// The order is the safety: the sealed copy is kept BEFORE the plain one is withdrawn, so a failure leaves the tile where
// it was. Forgetting is the host's to do: anyone who already fetched the plain bytes keeps them.
//
// Pure apart from `liveVisibilityDeps`.

import { lineageKey } from '@hypercomb/core'

const SIG = /^[0-9a-f]{64}$/

export type Switched = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly reason: string }
type Done<T = unknown> = ({ readonly ok: true } & T) | { readonly ok: false; readonly reason: string }

export interface VisibilityDeps {
  /** The hosts the tile names, primary first. */
  hosts(segments: readonly string[]): Promise<readonly string[]>
  /** This key, lowercase hex; '' when there is no signer. */
  pubkey(): Promise<string>
  /** This key's own signed index root for `lineage` on `zone`, or null. */
  root(zone: string, lineage: string): Promise<string | null>
  /** Stage the tile on its hosts, asking consent. True when it staged. */
  stage(segments: readonly string[]): Promise<boolean>
  /** The community switch of one host for this tile. */
  toggle(zone: string, pubkey: string, lineage: string, on: boolean): Promise<Switched>
  /** Asked before a staged tile is withdrawn: the hosts it leaves. */
  confirm(segments: readonly string[], staged: readonly string[]): Promise<boolean>
  /** Keep the tile on its hosts as ciphertext only this key opens. */
  keep(segments: readonly string[]): Promise<Done<{ readonly hosts: readonly string[] }>>
  /** Take the tile's plain root out of the signed index. */
  withdraw(segments: readonly string[]): Promise<Done>
  /** Ask the hosts to forget the plain bytes only this tile used. */
  forget(segments: readonly string[]): Promise<Done<{ readonly removed: number }>>
}

export type Refused = { readonly zone: string; readonly reason: string }

export type PublicResult =
  | { readonly ok: true; readonly on: readonly string[]; readonly refused: readonly Refused[] }
  | { readonly ok: false; readonly reason: 'no-tile' | 'no-host' | 'no-signer' | 'not-staged' }

export type PrivateResult =
  | {
      readonly ok: true
      /** The hosts that now keep the sealed copy; empty when it could not be kept (`keepReason`). */
      readonly kept: readonly string[]; readonly keepReason?: string
      /** Where it was staged, and the communities it left or could not leave. */
      readonly staged: readonly string[]; readonly off: readonly string[]; readonly refused: readonly Refused[]
      /** The plain root left the signed index; `forgotten` is how many plain atoms the hosts dropped. */
      readonly withdrawn: boolean; readonly withdrawReason?: string; readonly forgotten?: number; readonly forgetReason?: string
    }
  | { readonly ok: false; readonly reason: 'no-tile' | 'no-signer' | 'declined' }

const clean = (segments: readonly string[]): string[] => segments.map(s => String(s ?? '').trim()).filter(Boolean)
const failed = (reason: string) => (): { ok: false; reason: string } => ({ ok: false, reason })

/** The hosts whose signed index names the tile as a root. */
const stagedOn = async (zones: readonly string[], lineage: string, deps: VisibilityDeps): Promise<string[]> => {
  const staged: string[] = []
  for (const zone of zones) if (await deps.root(zone, lineage).catch(() => null)) staged.push(zone)
  return staged
}

/** The community switch of each host, one after another. */
const switchAll = async (zones: readonly string[], pubkey: string, lineage: string, on: boolean, deps: VisibilityDeps) => {
  const done: string[] = []
  const refused: Refused[] = []
  for (const zone of zones) {
    const result = await deps.toggle(zone, pubkey, lineage, on).catch((): Switched => ({ ok: false, reason: 'the community could not be signed' }))
    if (result.ok) done.push(zone)
    else refused.push({ zone, reason: result.reason })
  }
  return { done, refused }
}

/** Make the tile public: staged on its hosts and on in the community of each. */
export async function makePublic(segments: readonly string[], deps: VisibilityDeps): Promise<PublicResult> {
  const segs = clean(segments)
  const lineage = lineageKey(segs)
  if (!segs.length || !lineage) return { ok: false, reason: 'no-tile' }
  const zones = await deps.hosts(segs).catch(() => [] as string[])
  if (!zones.length) return { ok: false, reason: 'no-host' }
  const pubkey = (await deps.pubkey().catch(() => '')).toLowerCase()
  if (!SIG.test(pubkey)) return { ok: false, reason: 'no-signer' }
  let staged = await stagedOn(zones, lineage, deps)
  if (!staged.length) {
    if (!(await deps.stage(segs).catch(() => false))) return { ok: false, reason: 'not-staged' }
    staged = await stagedOn(zones, lineage, deps)
    if (!staged.length) return { ok: false, reason: 'not-staged' }
  }
  const { done, refused } = await switchAll(staged, pubkey, lineage, true, deps)
  return { ok: true, on: done, refused }
}

/** Make the tile private: ciphertext only on its hosts, out of every community, its plain copy withdrawn. */
export async function makePrivate(segments: readonly string[], deps: VisibilityDeps): Promise<PrivateResult> {
  const segs = clean(segments)
  const lineage = lineageKey(segs)
  if (!segs.length || !lineage) return { ok: false, reason: 'no-tile' }
  const pubkey = (await deps.pubkey().catch(() => '')).toLowerCase()
  if (!SIG.test(pubkey)) return { ok: false, reason: 'no-signer' }
  const staged = await stagedOn(await deps.hosts(segs).catch(() => [] as string[]), lineage, deps)
  if (staged.length && !(await deps.confirm(segs, staged).catch(() => false))) return { ok: false, reason: 'declined' }
  // The community first: what visitors see closes before anything else is tried.
  const { done: off, refused } = await switchAll(staged, pubkey, lineage, false, deps)
  const keep = await deps.keep(segs).catch(failed('the sealed copy could not be made'))
  // No sealed copy, no withdrawal: the tile stays where it was rather than nowhere.
  if (!keep.ok) return { ok: true, kept: [], keepReason: keep.reason, staged, off, refused, withdrawn: false }
  if (!staged.length) return { ok: true, kept: keep.hosts, staged, off, refused, withdrawn: false }
  const withdraw = await deps.withdraw(segs).catch(failed('the index could not be written'))
  if (!withdraw.ok) return { ok: true, kept: keep.hosts, staged, off, refused, withdrawn: false, withdrawReason: withdraw.reason }
  const forget = await deps.forget(segs).catch(failed('the hosts could not be asked'))
  return { ok: true, kept: keep.hosts, staged, off, refused, withdrawn: true, ...(forget.ok ? { forgotten: forget.removed } : { forgetReason: forget.reason }) }
}

// ── the live reads and acts ────────────────────────────────────────────────

const why = (failure: string, reason?: string): string => reason ? `${failure}: ${reason}` : failure

export const liveVisibilityDeps = (): VisibilityDeps => ({
  hosts: async segments => (await import('./community-hosts.js')).hostsOfBranch(segments),
  pubkey: async () => (await import('./key-list.client.js')).publisherKeyHex(),
  root: async (zone, lineage) => (await import('./hive-pointer.js')).ownHiveRoot(zone, lineage),
  stage: async segments => (await import('./host-gesture.js')).hostCurrentBranch(segments),
  toggle: async (zone, pubkey, lineage, on) => (await import('./showcase-bridge.js')).applyToggle({ zone, pubkey, lineage, on }),
  confirm: async (segments, staged) => {
    const { requestConfirm } = await import('@hypercomb/core')
    return requestConfirm({
      title: 'Make this tile private?',
      message: `${segments[segments.length - 1]} is staged on ${staged.join(', ')}. It will be kept there sealed, for your key only; its staged copy is withdrawn and those hosts are asked to forget it. Anyone who already fetched it keeps what they have.`,
      confirmLabel: 'Make it private',
      cancelLabel: 'Not now',
    }).catch(() => false)
  },
  keep: async segments => {
    const { keepPrivate, liveKeepDeps } = await import('./private-keep.js')
    const result = await keepPrivate(segments, await liveKeepDeps())
    if (result.ok) return { ok: true, hosts: result.hosts }
    const first = result.failed?.[0]
    return { ok: false, reason: first ? `${result.reason} (${first.host}: ${first.reason})` : result.reason }
  },
  withdraw: async segments => {
    const result = await (await import('./publish-branch.js')).unpublishBranch(segments)
    return result.ok ? { ok: true } : { ok: false, reason: why(result.failure, result.reason) }
  },
  forget: async segments => {
    const result = await (await import('./publish-branch.js')).secureDeleteBranch(segments)
    return result.ok ? { ok: true, removed: result.removed } : { ok: false, reason: why(result.failure, result.reason) }
  },
})
