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

import { moleculeAddress } from '@hypercomb/core'
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
  const found = new Map<string, { words: Set<string>; origins: Set<string> }>()

  await Promise.all(hosts.flatMap(host => [...asked].map(async ([address, word]) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let members: string[] | null = null
    try { members = listingMembers(await deps.list(`${lensOrigin(host)}/${address}/`, controller.signal)) }
    catch { members = null }
    finally { clearTimeout(timer) }

    answers.push({ host, word, status: members === null ? 'gap' : 'listed' })
    for (const sig of members ?? []) {
      const point = found.get(sig) ?? { words: new Set<string>(), origins: new Set<string>() }
      point.words.add(word)
      point.origins.add(host)
      found.set(sig, point)
    }
  })))

  const points = [...found].map(([sig, point]): LensPoint => ({
    sig, words: [...point.words].sort(), origins: [...point.origins].sort(),
  })).sort((a, b) =>
    b.words.length - a.words.length || b.origins.length - a.origins.length || (a.sig < b.sig ? -1 : 1))

  answers.sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : a.word < b.word ? -1 : a.word > b.word ? 1 : 0))
  return { points, answers }
}
