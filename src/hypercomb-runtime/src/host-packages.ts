// hypercomb-runtime/src/host-packages.ts
//
// WHAT A DOMAIN PUBLISHES. One question, asked the same way by everything that
// asks it.
//
// This lived in the shim, which was the right first home — the shim is the
// cold-boot shell, and asking a domain what it offers is the first thing it
// ever does. But the app needs the same answer for the same reason, and the
// app cannot import the shim. Two copies of "read what a host publishes" would
// have drifted on the first change, and the two readers would then disagree
// about what a host offers, which is the one thing they must never do.
//
// So it lives here, in runtime: the layer that owns io. Essentials cannot
// import it — a module imports core and nothing else, by doctrine — so this
// registers itself under the key CORE declares (`HOST_IOC_KEY`, host.types.ts)
// and a drone reaches it through IoC. Core holds the contract and stays free
// of io; runtime holds the fetch. Same split as I18nProvider.
//
// A DOMAIN'S OWN VOICE IS ITS POOL, and there is no document. The address is
// derived from a meaning every client already holds, so nothing is published
// saying where to look; the membership is the mutable part and the members are
// not. Everything a pool names is content-addressed and verified on admission,
// so a hostile or hijacked host can offer you a different tree but never wrong
// bytes. Binding "current" to a publisher identity is the signed sentinel's
// job, not this file's.
//
// It reads nothing but public URLs and writes nothing anywhere.

import { HOST_IOC_KEY, registerPoolMeaning, type HostProvider } from '@hypercomb/core'
import { HOST_PACKAGES_MEANING, markerIndices, parseMember, parsePoolListing, poolEntryName } from './host-pool.js'

const SIG_RE = /^[a-f0-9]{64}$/

/** Loopback speaks http. Every `*.localhost` name is loopback too (RFC 6761),
 *  which is how a sandbox door (`try-<change>.localhost:4291`) is proven on
 *  one machine before it runs on a real zone. */
const isLoopback = (zone: string): boolean =>
  /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3})(:\d{1,5})?$/i.test(zone)

/**
 * The URL bases a zone answers on under its OWN name, in order.
 *
 * Loopback hosts speak http; everything else https. A published site serves
 * the heap FLAT at its root, while a shell origin serves it under `/content`
 * — both are asked, flat first, because a door that publishes nothing answers
 * its flat pool address with an empty listing and the walk stops there.
 */
const ownBases = (zone: string): string[] => {
  const scheme = isLoopback(zone) ? 'http' : 'https'
  return [`${scheme}://${zone}`, `${scheme}://${zone}/content`]
}

/**
 * `content.<zone>` — the relay face, asked ONLY when the zone's own name does
 * not answer at all. On every zone the edge worker serves, the apex and the
 * content face are the same worker over the same heap, so asking both doubled
 * every request and every 404 (hypercomb.io, Update all, 2026-09-25). A zone
 * whose apex is deliberately unrouted (jwize.com) still reaches its heap here.
 * A zone that IS the content face needs no second one.
 */
const contentFaceBases = (zone: string): string[] =>
  /^content\./i.test(zone) || isLoopback(zone) ? [] : ownBases(`content.${zone}`)

const allHostBases = (zone: string): string[] => [...ownBases(zone), ...contentFaceBases(zone)]

/**
 * The bases ATOMS are fetched from. Once the pool probe has settled which base
 * a zone answers on, that is the only one — a zone's faces are one store, and
 * asking the others for every atom turned each miss into several requests.
 * Before the probe settles, the zone's own name.
 */
export const hostBases = (zone: string): string[] => {
  const settled = settledBase(zone)
  return settled ? [settled] : ownBases(zone)
}

/** Where a zone's pool last answered, remembered across sessions so the next
 *  boot asks there first instead of walking the wrong bases into a row of
 *  404s. The probe still tries every base, so a host whose layout moved is
 *  found again and the memo corrected. */
const answeredBase = new Map<string, string>()
const BASE_MEMO_KEY = 'hc:host-base:'

const settledBase = (zone: string): string | null => {
  const held = answeredBase.get(zone)
  if (held) return held
  try {
    const stored = globalThis.localStorage?.getItem(BASE_MEMO_KEY + zone)
    if (stored && allHostBases(zone).includes(stored)) { answeredBase.set(zone, stored); return stored }
  } catch { /* no storage here */ }
  return null
}

const settleBase = (zone: string, base: string): void => {
  answeredBase.set(zone, base)
  try { globalThis.localStorage?.setItem(BASE_MEMO_KEY + zone, base) } catch { /* memory memo still holds */ }
}

/**
 * A ZONE THAT PUBLISHES NOTHING, remembered for a while.
 *
 * Asking such a zone is the loudest thing discovery did: every base answered
 * a 404 (hosts not yet redeployed still do), and a browser prints each one to
 * the console whatever the code does with it — nothing in page script can hide a failed request, only
 * not make it. Update all asks every followed zone twice (who holds the root,
 * then what each head is), so one zone that is a site and not a host printed
 * a screen of red on every press (seen on hypercomb.io, 2026-09-25).
 *
 * Only an ANSWERED absence is remembered: every base replied and none held
 * the pool. A zone that did not answer is a network fact, not this one, and
 * is asked again next time. The memo is short, so a zone that starts
 * publishing is found within minutes, and a pool found anywhere clears it.
 */
const absentUntil = new Map<string, number>()
const ABSENT_MEMO_KEY = 'hc:host-absent:'
const ABSENT_FOR_MS = 15 * 60_000

const knownAbsent = (zone: string): boolean => {
  const now = Date.now()
  let until = absentUntil.get(zone)
  if (until === undefined) {
    try { until = Number(globalThis.localStorage?.getItem(ABSENT_MEMO_KEY + zone) ?? 0) || 0 } catch { until = 0 }
    absentUntil.set(zone, until)
  }
  return until > now
}

const markAbsent = (zone: string): void => {
  const until = Date.now() + ABSENT_FOR_MS
  absentUntil.set(zone, until)
  try { globalThis.localStorage?.setItem(ABSENT_MEMO_KEY + zone, String(until)) } catch { /* memory memo still holds */ }
}

const clearAbsent = (zone: string): void => {
  absentUntil.delete(zone)
  try { globalThis.localStorage?.removeItem(ABSENT_MEMO_KEY + zone) } catch { /* nothing held */ }
}

/** Test seam: forget every settled base and every remembered absence. */
export const _resetSettledBases = (): void => {
  answeredBase.clear()
  absentUntil.clear()
  inFlight.clear()
  try {
    const store = globalThis.localStorage
    if (!store) return
    for (let i = store.length - 1; i >= 0; i--) {
      const key = store.key(i)
      if (key?.startsWith(BASE_MEMO_KEY) || key?.startsWith(ABSENT_MEMO_KEY)) store.removeItem(key)
    }
  } catch { /* nothing to forget */ }
}

export type HostPackage = {
  zone: string
  /** The base the pool actually answered on — atoms hang off this one. */
  base: string
  packageSig: string
  /** Append-only host pool position. Browsers use it to request older pages;
   * it has no authority over the package root or what may run. */
  poolIndex?: number
  label: string
  at: string
  generation: number | null
  layers: string[]
  bees: string[]
  dependencies: string[]
  /** Display-only sizes, when a row can state them. A count cannot widen or
   *  narrow what installs — admission derives its own sets from the sealed
   *  root — so nothing depends on one being present. */
  layerCount?: number
  beeCount?: number
}


/**
 * What one domain publishes, newest first.
 *
 * Returns an empty list for a domain that publishes nothing, that cannot be
 * reached, or that is not a host at all — the three are deliberately one
 * outcome here. A caller showing a list has the same thing to render in each
 * case, and the distinctions that matter (is it a host? is CORS set? does the
 * pin resolve?) belong to the host check, not to a picker.
 */
/** One entry, as it came off the wire. `at` is the transport's own
 *  `Last-Modified` — when this host received the package — not a date anybody
 *  published. Every static host answers with it; a host that does not simply
 *  yields rows without a date. */
type Fetched = { text: string; at: string }

const poolReader = (base: string, pool: string) =>
  async (index: number): Promise<Fetched | null> => {
    try {
      // DEFAULT CACHE MODE, deliberately: a pool entry is append-only, so
      // entry N is the same bytes forever and the HTTP cache is free
      // bandwidth. A 404 for an index nobody has shipped yet is not cached,
      // which is what keeps the head probe honest.
      const res = await fetch(`${base}/${pool}/${poolEntryName(index)}`)
      if (!res.ok) return null
      const text = await res.text()
      if (text.includes('<')) return null   // an SPA fallback is not an entry
      const modified = res.headers.get('last-modified')
      const at = modified ? new Date(modified).toISOString() : ''
      return { text, at: at === 'Invalid Date' ? '' : at }
    } catch { return null }
  }

const rowFrom = (zone: string, base: string, fetched: Fetched | null, poolIndex?: number): HostPackage | null => {
  const member = parseMember(fetched?.text ?? null)
  if (!member) return null
  return {
    zone,
    base,
    packageSig: member.packageSig,
    poolIndex,
    label: member.label || member.packageSig.slice(0, 12),
    at: fetched?.at ?? '',
    generation: null,
    layers: [],
    bees: [],
    dependencies: [],
  }
}

type FoundPool = {
  base: string
  read: ReturnType<typeof poolReader>
  head: number
  /** Every index the host holds, from its listing. */
  indices: number[]
}

/**
 * WHERE A ZONE'S POOL ANSWERS.
 *
 * Ask the DIRECTORY first — `GET /<pool>/` — which is one request and returns
 * every entry name, so it serves browsing and booting alike. `no-store`,
 * because the members are immutable but the membership is not.
 *
 * The listing is the only mechanism. Probing entries one index at a time was
 * the drain window for relays that predated the directory branch; every host
 * shape answers the listing now, and the probe only ever added a 404 per base
 * for every zone that publishes nothing.
 */
/** What the probe learned: the pool, and — separately — whether any door
 *  ANSWERED at all. "Publishes nothing here" (an empty listing, or a 404, at
 *  the derived address) and "does not answer" (no HTTP response from any base) are
 *  different facts, and only the second is about reachability. */
type PoolProbe = { pool: FoundPool | null; answered: boolean }

/** One probe per zone at a time. Update all asks every zone from several
 *  places at once; they share the answer instead of each walking the bases. */
const inFlight = new Map<string, Promise<PoolProbe>>()

const probePool = (zone: string): Promise<PoolProbe> => {
  if (knownAbsent(zone)) return Promise.resolve({ pool: null, answered: true })
  const running = inFlight.get(zone)
  if (running) return running
  const probe = walkBases(zone).finally(() => inFlight.delete(zone))
  inFlight.set(zone, probe)
  return probe
}

const walkBases = async (zone: string): Promise<PoolProbe> => {
  const pool = await registerPoolMeaning(HOST_PACKAGES_MEANING)
  const remembered = settledBase(zone)

  /** Ask a list of bases in order. `found` is the pool; `none` is a door that
   *  said so outright (an empty listing); `answered` is whether any door gave
   *  an HTTP response at all. */
  const ask = async (bases: string[]): Promise<{ found: FoundPool | null; none: boolean; answered: boolean }> => {
    let answered = false
    for (const base of bases) {
      let res: Response
      try { res = await fetch(`${base}/${pool}/`, { cache: 'no-store' }) } catch { continue }
      answered = true   // any status is an answer; a thrown fetch is not
      // Every host shape that holds a pool answers its directory — the relay
      // by readdir, the edge worker by prefix, a static ship by the listing
      // it writes as index.html. A 404 or a page here is simply not this
      // base; the next is asked.
      const listing = res.ok ? parsePoolListing(await res.text()) : null
      if (!listing) continue
      const indices = markerIndices(listing)
      if (!indices.length) return { found: null, none: true, answered }
      settleBase(zone, base)
      return { found: { base, read: poolReader(base, pool), head: indices[indices.length - 1]!, indices }, none: false, answered }
    }
    return { found: null, none: false, answered }
  }

  // The settled base first — a hint only: the probe is what settles it, so
  // it must keep looking when the memo is stale.
  const own = ownBases(zone)
  const first = await ask(remembered ? [remembered, ...own.filter(base => base !== remembered)] : own)
  let outcome = first
  if (!first.found && !first.none && !first.answered) {
    const face = contentFaceBases(zone).filter(base => base !== remembered)
    if (face.length) outcome = await ask(face)
  }

  if (outcome.found) {
    clearAbsent(zone)
    return { pool: outcome.found, answered: true }
  }
  const answered = first.answered || outcome.answered
  if (answered) markAbsent(zone)
  return { pool: null, answered }
}

const findPool = async (zone: string): Promise<FoundPool | null> => (await probePool(zone)).pool

/**
 * THE HEAD PACKAGE A DOMAIN PUBLISHES — the whole of discovery.
 *
 * The address is DERIVED (`sign('host:packages')`), never named, so nothing
 * had to be published saying where to look. The max index is the head, and
 * that one signature expands into everything else at admission.
 */
export const headPackage = async (zone: string): Promise<HostPackage | null> => {
  const found = await findPool(zone)
  if (!found) return null
  return rowFrom(zone, found.base, await found.read(found.head), found.head)
}

/** How many rows a picker asks for before someone scrolls. Each is one
 *  request, so this is the difference between opening a panel and fetching a
 *  host's entire history — 179 entries and counting on the oldest host. */
const BROWSE_PAGE = 25

/**
 * WHAT A DOMAIN PUBLISHES, newest first — walked from the head, downward.
 *
 * There is no list to read: the pool IS the list, and a picker takes the page
 * it can show rather than the whole history. `before` continues the walk for a
 * caller that scrolls (the index below which to keep going).
 *
 * The three things a row needs now come from three places that cannot
 * disagree with each other: the signature and its publication label from the
 * member's own bytes, the date from the transport, and the counts from
 * nowhere — a count was only ever decoration, and admission derives the real
 * inventory anyway.
 */
export const listHostPackages = async (
  zone: string,
  options: { limit?: number; before?: number } = {},
): Promise<HostPackage[]> => (await askHostPackages(zone, options)).packages

/**
 * The same rows, plus the one fact a surface needs to say the right thing
 * about an empty answer: did the door answer at all? A host directory that
 * shows "publishes nothing here" for a domain that is DOWN sends the
 * participant to look for a publish problem that is a network problem.
 */
export const askHostPackages = async (
  zone: string,
  options: { limit?: number; before?: number } = {},
): Promise<{ packages: HostPackage[]; answered: boolean }> => {
  const { pool: found, answered } = await probePool(zone)
  if (!found) return { packages: [], answered }
  return { packages: await rowsFrom(zone, found, options), answered: true }
}

const rowsFrom = async (
  zone: string,
  found: FoundPool,
  options: { limit?: number; before?: number },
): Promise<HostPackage[]> => {

  const limit = Math.max(1, options.limit ?? BROWSE_PAGE)
  const ceiling = options.before !== undefined ? options.before - 1 : found.head
  if (ceiling < 0) return []

  const indices = found.indices.filter(i => i <= ceiling).sort((a, b) => b - a).slice(0, limit)

  const rows = await Promise.all(indices.map(async i => rowFrom(zone, found.base, await found.read(i), i)))
  return rows.filter((row): row is HostPackage => row !== null)
}

// ── the port ────────────────────────────────────────────────────────────────
// Registered under the key CORE declares, so a module that imports core and
// nothing else (which is every module, by doctrine) can still ask a domain what
// it publishes. Core holds the contract and does no io; the io is here.
const provider: HostProvider = {
  listPackages: listHostPackages,
  bases: hostBases,
}

try {
  ;(globalThis as { ioc?: { register?: (k: string, v: unknown) => void } })
    .ioc?.register?.(HOST_IOC_KEY, provider)
} catch { /* no ioc in this environment — direct importers still work */ }

export { provider as hostProvider }
