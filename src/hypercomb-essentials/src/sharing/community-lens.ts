// sharing/community-lens.ts
//
// THE COMMUNITY LENS, RECORD LAYER — documentation/community-lens.md.
//
// Given a community's hosts and some words, ask each host for each word's
// molecule at its address (`GET /<sign(word)>/`, a directory, `no-store`) and
// merge what comes back into one list of signatures, each with the words that
// gathered it and the hosts that carry it. A signature under two or more words
// is a triangulation point.
//
// READ ONLY, SIGNATURES ONLY. The request path is the word's signature; no page
// text, no page URL and no reader identity is sent, and nothing is logged. The
// union is computed here at read time — it mints no pool and stores nothing, so
// a cold client rebuilds it from the hosts alone. A host that is down, slow or
// answers with something that is not a listing is a silent gap, never an error:
// the answers say which.
//
// Entries that are not signatures (the `0000` markers of a lineage bag, an
// `index.html`) are not members and are left out.

import { moleculeAddress, moleculeKey } from '@hypercomb/core'
import { isLoopbackHost } from './zone-door.js'

/** Words asked per gesture: N words x M hosts is N x M listings. */
export const LENS_MAX_WORDS = 8
/** One host's silence is waited on this long, then it is a gap. */
export const LENS_TIMEOUT_MS = 6_000

const SIG_RE = /^[a-f0-9]{64}$/

/** One signature the lens found. */
export interface LensPoint {
  readonly sig: string
  /** The words (as asked) whose molecule held it. */
  readonly words: readonly string[]
  /** The hosts that listed it under any of those words. */
  readonly origins: readonly string[]
  /** The published paths whose segments named those words (the ledger read
   *  only; a molecule listing carries no path). */
  readonly paths?: readonly string[]
}

/** What one host said about one word. */
export interface LensAnswer {
  readonly host: string
  readonly word: string
  /** 'listed' = a listing (possibly empty); 'gap' = no answer worth reading. */
  readonly status: 'listed' | 'gap'
}

export interface LensResult {
  /** Most shared first: words, then origins, then signature (stable). */
  readonly points: readonly LensPoint[]
  readonly answers: readonly LensAnswer[]
}

export interface LensDeps {
  /** A directory listing's body, or null for anything that is not an answer. */
  list(url: string, signal: AbortSignal): Promise<string | null>
  /** The word's molecule address. */
  address(word: string): Promise<string>
}

export const liveLensDeps: LensDeps = {
  list: async (url, signal) => {
    try {
      const response = await fetch(url, { cache: 'no-store', signal })
      return response.ok ? await response.text() : null
    } catch { return null }
  },
  address: word => moleculeAddress(word),
}

/** The origin a host name is read from (a loopback host speaks plain http). */
export const lensOrigin = (host: string): string => `${isLoopbackHost(host) ? 'http' : 'https'}://${host}`

/** Entry names of a listing, or null when the body is not a listing (an SPA
 *  fallback page, an error body). Only signatures are members. */
export const listingMembers = (text: string | null): string[] | null => {
  if (text === null || text.includes('<')) return null
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => SIG_RE.test(line))
}

export interface LensOptions {
  readonly hosts: readonly string[]
  readonly words: readonly string[]
  readonly deps?: LensDeps
  readonly timeoutMs?: number
}

/** Ask every host for every word and merge. Never throws for a host. */
export const readLens = async (options: LensOptions): Promise<LensResult> => {
  const deps = options.deps ?? liveLensDeps
  const timeoutMs = options.timeoutMs ?? LENS_TIMEOUT_MS
  const hosts = [...new Set(options.hosts.map(host => host.trim().toLowerCase()).filter(Boolean))]

  // One entry per distinct molecule, in the order asked; an empty name has no
  // molecule and is dropped rather than allowed to ask for the root.
  const asked = new Map<string, string>()
  for (const word of options.words) {
    if (asked.size >= LENS_MAX_WORDS) break
    let address: string
    try { address = await deps.address(word) } catch { continue }
    if (!asked.has(address)) asked.set(address, word)
  }

  const answers: LensAnswer[] = []
  const found: Found = new Map()

  await Promise.all(hosts.flatMap(host => [...asked].map(async ([address, word]) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let members: string[] | null = null
    try { members = listingMembers(await deps.list(`${lensOrigin(host)}/${address}/`, controller.signal)) }
    catch { members = null }
    finally { clearTimeout(timer) }

    answers.push({ host, word, status: members === null ? 'gap' : 'listed' })
    for (const sig of members ?? []) gather(found, sig, word, host)
  })))

  answers.sort(byAnswer)
  return { points: pointsOf(found), answers }
}

type Found = Map<string, { words: Set<string>; origins: Set<string>; paths: Set<string> }>

const byAnswer = (a: LensAnswer, b: LensAnswer): number =>
  a.host < b.host ? -1 : a.host > b.host ? 1 : a.word < b.word ? -1 : a.word > b.word ? 1 : 0

const gather = (found: Found, sig: string, word: string, origin: string, path?: string): void => {
  const point = found.get(sig) ?? { words: new Set<string>(), origins: new Set<string>(), paths: new Set<string>() }
  point.words.add(word)
  point.origins.add(origin)
  if (path) point.paths.add(path)
  found.set(sig, point)
}

const pointsOf = (found: Found): LensPoint[] => [...found].map(([sig, point]): LensPoint => ({
  sig,
  words: [...point.words].sort(),
  origins: [...point.origins].sort(),
  ...(point.paths.size ? { paths: [...point.paths].sort() } : {}),
})).sort((a, b) =>
  b.words.length - a.words.length || b.origins.length - a.origins.length || (a.sig < b.sig ? -1 : 1))

// ── ROUTE 1: the ledger a host already serves ─────────────────────────────
//
// Until a host lists a word at `sign(word)/` (the molecule write path does not
// exist yet), what it DOES publish is its ledger, `GET /publications.json`:
// each site's lineage path and each publisher's current head. A word matches a
// site when it names any SEGMENT of that path, so `music/jazz` answers both
// `music` and `jazz`. The head is the signature the point stands for.
//
// The ledger is the HOST'S assertion, not a signed record: a host can omit or
// invent a row. The head itself is content-addressed, so a reader who fetches
// it can check the bytes against it; the signed hive index is the stronger
// check and is left to a later step.

export interface LedgerDeps {
  /** The parsed ledger body, or null for anything that is not one. */
  ledger(url: string, signal: AbortSignal): Promise<unknown | null>
}

export const liveLedgerDeps: LedgerDeps = {
  ledger: async (url, signal) => {
    try {
      const response = await fetch(url, { cache: 'no-store', signal })
      if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) return null
      const text = await response.text()
      return text.length > 1_000_000 ? null : JSON.parse(text)
    } catch { return null }
  },
}

export interface LedgerRow { readonly lineage: string; readonly head: string }

/** The (lineage, head) pairs a ledger body carries; anything malformed is skipped. */
export const ledgerRows = (raw: unknown): LedgerRow[] => {
  const sites = (raw as { sites?: unknown } | null)?.sites
  if (!Array.isArray(sites)) return []
  const rows: LedgerRow[] = []
  for (const site of sites) {
    const lineage = typeof site?.lineage === 'string' ? site.lineage.trim() : ''
    if (!lineage || !Array.isArray(site?.publishers)) continue
    for (const publisher of site.publishers) {
      const head = typeof publisher?.head === 'string' ? publisher.head.trim().toLowerCase() : ''
      if (SIG_RE.test(head)) rows.push({ lineage, head })
    }
  }
  return rows
}

export interface LedgerLensOptions {
  readonly hosts: readonly string[]
  readonly words: readonly string[]
  readonly deps?: LedgerDeps
  readonly timeoutMs?: number
}

/** Read each host's ledger and match the words against the segments of every
 *  published path. Never throws for a host. */
export const readLedgerLens = async (options: LedgerLensOptions): Promise<LensResult> => {
  const deps = options.deps ?? liveLedgerDeps
  const timeoutMs = options.timeoutMs ?? LENS_TIMEOUT_MS
  const hosts = [...new Set(options.hosts.map(host => host.trim().toLowerCase()).filter(Boolean))]

  const asked = new Map<string, string>()
  for (const word of options.words) {
    const key = moleculeKey(word)
    if (key && !asked.has(key) && asked.size < LENS_MAX_WORDS) asked.set(key, word)
  }

  const answers: LensAnswer[] = []
  const found: Found = new Map()

  await Promise.all(hosts.map(async host => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let body: unknown | null = null
    try { body = await deps.ledger(`${lensOrigin(host)}/publications.json`, controller.signal) }
    catch { body = null }
    finally { clearTimeout(timer) }

    const rows = body === null ? null : ledgerRows(body)
    for (const word of asked.values()) answers.push({ host, word, status: rows === null ? 'gap' : 'listed' })
    for (const row of rows ?? []) {
      for (const segment of row.lineage.split('/')) {
        const word = asked.get(moleculeKey(segment))
        if (word) gather(found, row.head, word, host, row.lineage)
      }
    }
  }))

  answers.sort(byAnswer)
  return { points: pointsOf(found), answers }
}
