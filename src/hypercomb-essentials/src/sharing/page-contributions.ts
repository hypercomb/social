// sharing/page-contributions.ts
//
// A CONTRIBUTION TO SOMEBODY ELSE'S PAGE (documentation/page-contributions.md,
// step 2; jwize 2026-11-12: "Everyone can drop their contributions in pools").
//
// An edit to a page that is not yours never changes the page. It is offered:
// the new page's bytes go to the publisher's host, and your OWN signed index
// there names them under `page:<base>`, where <base> is the signature of the
// page you edited. The host lists every claim for a base at the pool's derived
// address `sign('page:<base>')` (step 3), the key holder's pick decides what
// everyone is shown (step 5), and the published page stays as it is until then.
//
// The key is a content signature, so the same page published on two domains
// finds its contributions on both; one key per contributor per base, so a
// second offer to the same page replaces your first.
//
// Only words travel this way for now: a contribution that changes markup or
// code is refused here (page-text-only.ts), so viewing any contribution runs
// nothing its base did not already run.

import { SignatureService, registerPoolMeaning } from '@hypercomb/core'
import { differsOnlyInText } from '../presentation/tiles/page-text-only.js'
import { clearHiveRoot, fetchHiveIndex } from './hive-pointer.js'
import { hostOfferDeps, type HostOfferDeps } from './host-offer.js'
import { originUrl } from './published-pools.js'
import { readPoolListing } from './pool-listing.js'
import { fetchWithDeadline } from './bounded-fetch.js'

export const PAGE_CONTRIBUTION_PREFIX = 'page:'

const SIG_RE = /^[0-9a-f]{64}$/

/** The index key, and the pool meaning, a page's contributions are found under. */
export const contributionKey = (base: string): string => `${PAGE_CONTRIBUTION_PREFIX}${base}`

export type Contribution = {
  /** The signature of the page that was edited. */
  readonly base: string
  /** That page's bytes, to prove the offer changes only words. */
  readonly baseHtml: string
  /** The edited page. */
  readonly html: string
}

export type ContributionResult =
  | { readonly ok: true; readonly sig: string; readonly key: string }
  | { readonly ok: false; readonly error: string }

/** Put the edited page, ship it to `host`, and name it in this hive's own index
 *  there as `page:<base>`. `host` is the publisher's zone. */
export const dropContribution = async (host: string, offer: Contribution, deps: HostOfferDeps): Promise<ContributionResult> => {
  const base = String(offer.base ?? '').toLowerCase()
  if (!SIG_RE.test(base)) return { ok: false, error: 'the edited page has no signature' }
  if (!String(host ?? '').trim()) return { ok: false, error: 'no host is named for this page' }
  if (offer.html === offer.baseHtml) return { ok: false, error: 'nothing changed' }
  if (!differsOnlyInText(offer.baseHtml, offer.html)) return { ok: false, error: 'only changed words can be offered' }
  const sig = await deps.put(offer.html, 'text/html')
  const published = await deps.publish(host, [sig])
  if (!published.ok) return { ok: false, error: published.error }
  const key = contributionKey(base)
  const stamped = await deps.stamp(host, key, sig)
  if (!stamped.ok) return { ok: false, error: stamped.reason ?? 'the contribution was not named in your index' }
  return { ok: true, sig, key }
}

// ── reading a page's pool (step 3) ─────────────────────────────────────────
//
// A host lists who contributed to a page at the pool's own derived address —
// `<origin>/<sign('page:<base>')>/`, one contributor key per line (the worker's
// notePageContributors). The listing is membership only and is never believed
// on its own: each contributor's OWN signed index is read and verified, the
// page it names under `page:<base>` is fetched and must hash to that name, and
// whether it changes only words is decided here, against the base page.

/** Contributors read per host per page — a pool to look through, not a dump. */
export const CONTRIBUTIONS_SHOWN = 64

export type PageContribution = {
  /** The contributor's key. */
  readonly pubkey: string
  /** The contributed page's signature. */
  readonly sig: string
  /** The contributed page. */
  readonly html: string
  /** When the contributor's index was signed (unix seconds). */
  readonly at: number
  /** True when it changes only words of the base, so viewing it runs nothing new. */
  readonly textOnly: boolean
  /** The host it was read from. */
  readonly host: string
}

export type ContributionReadDeps = {
  /** The keys listed at a pool address on a host; empty when there is no pool.
   *  `fresh` asks again even when the host said "no pool" a moment ago. */
  members(host: string, poolSig: string, fresh?: boolean): Promise<string[]>
  /** A key's verified index on a host: its roots and when it was signed; null when absent or unverifiable. */
  index(host: string, pubkey: string): Promise<{ roots: Record<string, string>; createdAt: number } | null>
  /** Bytes by signature from a host; null when absent. */
  bytes(host: string, sig: string): Promise<Uint8Array | null>
}

const HEX64 = /^[0-9a-f]{64}$/

/** The network reads a contribution needs. */
export const contributionReadDeps = (): ContributionReadDeps => ({
  members: async (host, poolSig, fresh) => {
    const text = await readPoolListing(originUrl(host), poolSig, { fresh: fresh === true })
    return (text ?? '').split(/\r?\n/).map(line => line.trim().toLowerCase()).filter(line => HEX64.test(line))
  },
  index: async (host, pubkey) => {
    const read = await fetchHiveIndex(host, pubkey).catch(() => null)
    return read?.ok ? { roots: read.manifest.roots, createdAt: Number(read.manifest.createdAt) || 0 } : null
  },
  bytes: async (host, sig) => {
    try {
      const res = await fetchWithDeadline(`${originUrl(host)}/${sig}`, { cache: 'force-cache' })
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
    } catch { return null }
  },
})

/** Every contribution `host` holds for the page `base`, verified, newest first.
 *  `baseHtml` is the page's own bytes, to tell words-only from anything else. */
export const readContributions = async (
  host: string, base: string, baseHtml: string, deps: ContributionReadDeps = contributionReadDeps(),
  options: { fresh?: boolean } = {},
): Promise<PageContribution[]> => {
  const page = String(base ?? '').toLowerCase()
  if (!HEX64.test(page) || !String(host ?? '').trim()) return []
  const key = contributionKey(page)
  const pool = await registerPoolMeaning(key)
  const keys = (await deps.members(host, pool, options.fresh)).slice(-CONTRIBUTIONS_SHOWN)
  const found = await Promise.all(keys.map(async (pubkey): Promise<PageContribution | null> => {
    const index = await deps.index(host, pubkey)
    const sig = String(index?.roots?.[key] ?? '').toLowerCase()
    if (!index || !HEX64.test(sig) || sig === page) return null
    const bytes = await deps.bytes(host, sig)
    if (!bytes) return null
    const copy = bytes.slice()
    if ((await SignatureService.sign(copy.buffer as ArrayBuffer)) !== sig) return null
    const html = new TextDecoder().decode(bytes)
    return { pubkey, sig, html, at: index.createdAt, textOnly: differsOnlyInText(baseHtml, html), host }
  }))
  return found.filter((c): c is PageContribution => c !== null).sort((a, b) => b.at - a.at)
}

// ── the key holder's pick (step 5) ─────────────────────────────────────────
//
// What everyone is shown is the page's publisher's choice: the publisher's own
// signed index — the ONE index every place that publishes for them writes
// (key-list.client.ts publisherKeyHex) — names it as `pick:<base>` → the chosen
// contribution. The site view renders a page through its publisher's pick.
//
// Which index is current: the newest any of the page's hosts holds — every
// place writes the same index with a `prev` chain, so the newest has the last
// word, a cleared pick included. "Higher wins" (documentation/
// page-contributions.md, "Keys at any level") needs keys scoped below the root,
// which the key list does not carry yet: every listed key is a root key today,
// and among equals the newest pick wins — the newest index.

export const PAGE_PICK_PREFIX = 'pick:'

/** The index key a page's pick is named under. */
export const pagePickKey = (base: string): string => `${PAGE_PICK_PREFIX}${base}`

/** The publisher's pick for the page `base`, read from the newest copy of
 *  their index the hosts hold; null when there is none (or it was cleared, or
 *  its bytes do not hash to their name). */
export const readPick = async (
  hosts: readonly string[], anchor: string, base: string, baseHtml: string,
  deps: ContributionReadDeps = contributionReadDeps(),
): Promise<PageContribution | null> => {
  const page = String(base ?? '').toLowerCase()
  const owner = String(anchor ?? '').toLowerCase()
  if (!HEX64.test(page) || !HEX64.test(owner)) return null
  const read = await Promise.all([...new Set(hosts.filter(Boolean))].map(async host => ({ host, index: await deps.index(host, owner).catch(() => null) })))
  const newest = read.filter(r => r.index).sort((a, b) => b.index!.createdAt - a.index!.createdAt)[0]
  if (!newest?.index) return null
  const sig = String(newest.index.roots?.[pagePickKey(page)] ?? '').toLowerCase()
  if (!HEX64.test(sig) || sig === page) return null
  const bytes = await deps.bytes(newest.host, sig)
  if (!bytes || (await SignatureService.sign(bytes.slice().buffer as ArrayBuffer)) !== sig) return null
  const html = new TextDecoder().decode(bytes)
  return { pubkey: owner, sig, html, at: newest.index.createdAt, textOnly: differsOnlyInText(baseHtml, html), host: newest.host }
}

export type PickDeps = {
  publish(host: string, sigs: readonly string[]): Promise<{ ok: true } | { ok: false; error: string }>
  stamp(host: string, key: string, sig: string): Promise<{ ok: boolean; reason?: string }>
  clear(host: string, key: string): Promise<{ ok: boolean; reason?: string }>
}

export type PickResult =
  | { readonly ok: true; readonly hosts: readonly string[] }
  | { readonly ok: false; readonly error: string }

/** Name `pick` as what everyone sees of the page `base` on every host it is
 *  published to — or, with null, take the pick away so the published page
 *  shows again. Done where a host took it; refused only when none did. */
export const signPick = async (
  hosts: readonly string[], base: string, pick: PageContribution | null, deps: PickDeps,
): Promise<PickResult> => {
  const page = String(base ?? '').toLowerCase()
  if (!HEX64.test(page)) return { ok: false, error: 'the page has no signature' }
  const targets = [...new Set(hosts.filter(Boolean))]
  if (!targets.length) return { ok: false, error: 'this page is not published anywhere yet' }
  const key = pagePickKey(page)
  const done: string[] = []
  const errors: string[] = []
  for (const host of targets) {
    if (pick) {
      const shipped = await deps.publish(host, [pick.sig])
      if (!shipped.ok) { errors.push(`${host}: ${shipped.error}`); continue }
      const stamped = await deps.stamp(host, key, pick.sig)
      if (!stamped.ok) { errors.push(`${host}: ${stamped.reason ?? 'not named'}`); continue }
    } else {
      const cleared = await deps.clear(host, key)
      if (!cleared.ok) { errors.push(`${host}: ${cleared.reason ?? 'not cleared'}`); continue }
    }
    done.push(host)
  }
  return done.length ? { ok: true, hosts: done } : { ok: false, error: errors.join('; ') }
}

/** What this hive signs a pick with: its host service and its index. */
export const pickDeps = (): PickDeps | null => {
  const offer = hostOfferDeps()
  if (!offer) return null
  return { publish: offer.publish, stamp: offer.stamp, clear: (host, key) => clearHiveRoot(host, key) }
}
