// files/try-page.ts
//
// A website page a model writes is a resource in the hive and a trial outside
// it. The bytes stay in the store. The trial is one label on the host you are
// already using, at the same port: http://try-<name>.localhost:4250/ on the
// local hive, https://try-<name>.hypercomb.io/ on hypercomb.io, and
// https://try-<name>.<your domain>/ on your own domain. It does not run in
// this hive. Pictures and stylesheets the page names are copied onto that trial.
//
// The name is one label, try-<name>, not try.<name>. A module trial uses the
// same shape. Each time the page changes, the pool keeps the next version:
// try-<name>-v1, try-<name>-v2, each its own origin and its own memory.
// try-<name> lines those versions up. The label rule lives in sandbox-door.ts.

import { isSandboxLabel } from '@hypercomb/core'
import { extractPageRefSigs } from '../sharing/decoration-closure.js'

const KEY = 'hc:page-trials'
/** Kept so older callers still resolve. The door is this hive's own origin, not a side port. */
export const TRY_PAGE_PORT = 4292
const VERSION_TAIL = /-v([1-9][0-9]*)$/
const VECTOR_TAIL = /-v([1-9][0-9]*)-([0-9]+)-([0-9]+)-([1-9][0-9]*)$/
const SIG = /^[a-f0-9]{64}$/

/** The door label for a tile, from its own name. Null when the name cannot be a label. */
export const trialLabel = (segments: readonly string[]): string | null => {
  const raw = String(segments[segments.length - 1] ?? '').trim().toLowerCase()
  const slug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!slug) return null
  const label = `try-${slug}`
  return isSandboxLabel(label) ? label : null
}

/** The page name under a version label. try-press-kit-v2 is try-press-kit.
 *  try-v2 is its own name: the tail is a version only when what remains is a label. */
export const trialBase = (label: string): string => {
  const name = String(label ?? '').trim().toLowerCase()
  const wide = VECTOR_TAIL.exec(name)
  if (wide && isSandboxLabel(name)) {
    const base = name.slice(0, name.length - wide[0].length)
    if (isSandboxLabel(base)) return base
  }
  const tail = VERSION_TAIL.exec(name)
  if (!tail || !isSandboxLabel(name)) return name
  const base = name.slice(0, name.length - tail[0].length)
  return isSandboxLabel(base) ? base : name
}

/** major.minor.patch.build, or null when the label is the lineup or a plain name. */
export const trialVector = (label: string): string | null => {
  const name = String(label ?? '').trim().toLowerCase()
  const wide = VECTOR_TAIL.exec(name)
  if (wide && trialBase(name) !== name) return `${wide[1]}.${wide[2]}.${wide[3]}.${wide[4]}`
  const tail = VERSION_TAIL.exec(name)
  if (!tail || trialBase(name) === name) return null
  return `1.0.0.${tail[1]}`
}

/** The version a label names, or null when the label is the lineup. */
export const trialVersion = (label: string): number | null => {
  const name = String(label ?? '').trim().toLowerCase()
  if (trialBase(name) === name) return null
  const tail = VERSION_TAIL.exec(name)
  const version = Number(tail?.[1])
  return Number.isInteger(version) && version > 0 ? version : null
}

/** try-<name>-vN, or null when that label would not fit. */
export const trialVersionLabel = (base: string, version: number): string | null => {
  const name = trialBase(base)
  if (!isSandboxLabel(name) || trialVersion(name) !== null) return null
  if (!Number.isInteger(version) || version < 1) return null
  const label = `${name}-v${version}`
  return isSandboxLabel(label) ? label : null
}

/** The zone under the try- label. A door you are already standing on does not
 *  nest another label. 127.0.0.1 is the local hive, so its door is localhost. */
export const trialZone = (hostname: string): string => {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/:\d+$/, '')
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'localhost'
  const dot = host.indexOf('.')
  if (dot < 0) return host
  const first = host.slice(0, dot)
  return isSandboxLabel(first) ? host.slice(dot + 1) : host
}

/** The origin the trial is opened on: one try- label, the zone you are on, the same port. */
export const trialOrigin = (label: string, here?: string): string => {
  let page: URL
  try { page = new URL(here || globalThis.location?.href || 'http://localhost/') }
  catch { page = new URL('http://localhost/') }
  const port = page.port ? `:${page.port}` : ''
  return `${page.protocol}//${label}.${trialZone(page.hostname)}${port}`
}

const read = (): Record<string, string> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}') as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [sig, label] of Object.entries(parsed)) {
      if (SIG.test(sig) && isSandboxLabel(String(label))) out[sig] = String(label)
    }
    return out
  } catch { return {} }
}

/** Remember that this resource is a trial, so the site view will not mount it. */
export const rememberTrial = (sig: string, label: string): void => {
  if (!SIG.test(sig) || !isSandboxLabel(label)) return
  const next = read()
  next[sig] = label
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* the resource is still stored */ }
}

/** The trial label for a page resource, or null when this page runs in the hive. */
export const trialOf = (sig: string): string | null => read()[sig] ?? null

/** Where a person may bring a trial. Localhost while the hive is on this
 *  machine. Their own domain when the hive is already standing on it. */
export const pageHomeOf = (hostname: string): { where: 'localhost' | 'domain'; name: string } => {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/:\d+$/, '')
  const loopback = !host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
  return loopback ? { where: 'localhost', name: 'localhost' } : { where: 'domain', name: host }
}

export const pageHome = (): { where: 'localhost' | 'domain'; name: string } => {
  try { return pageHomeOf(globalThis.location?.hostname ?? '') } catch { return { where: 'localhost', name: 'localhost' } }
}

/** A person takes the page out of the trial, so the hive may mount it.
 *  Returns false when it was not a trial. Nothing here decides that the
 *  click was a person's. */
export const releaseTrial = (sig: string): boolean => {
  if (!SIG.test(sig) || !trialOf(sig)) return false
  const next = read()
  delete next[sig]
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { return false }
  return trialOf(sig) === null
}

export type TrialStage = { ok: boolean; version: number | null; label: string; vector?: string | null }
export type TrialPool = { base: string; versions: number[]; latest: number | null }

const hereOf = (here?: string): URL | null => {
  try { return new URL(here || globalThis.location?.href || 'http://127.0.0.1/') }
  catch { return null }
}

/** The versions this hive is holding for a page. Same pool the try- hosts read. */
export const listTrialVersions = async (label: string, here?: string): Promise<TrialPool> => {
  const base = trialBase(label)
  const empty: TrialPool = { base, versions: [], latest: null }
  const page = hereOf(here)
  if (!page || !isSandboxLabel(base)) return empty
  try {
    const response = await fetch(new URL('/', page.origin), {
      headers: { 'x-hc-trial-list': base },
      signal: AbortSignal.timeout(1500),
    })
    if (!response.ok) return empty
    const data = await response.json() as { versions?: unknown }
    const versions = Array.isArray(data.versions)
      ? data.versions.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : []
    return { base, versions, latest: versions.at(-1) ?? null }
  } catch { return empty }
}

const ASSET_TYPES = new Set([
  'text/css', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'font/woff', 'font/woff2',
])

const TYPE_BY_EXT: Record<string, string> = {
  css: 'text/css',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
}

const sniffAsset = (bytes: Uint8Array): string => {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  if (bytes.length >= 4 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x46) return 'font/woff'
  if (bytes.length >= 4 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32) return 'font/woff2'
  return ''
}

const namedAssetType = (html: string, sig: string): string => {
  const named = new RegExp(`resource:${sig}/([A-Za-z0-9._-]+)`, 'i').exec(html)
  const ext = named?.[1]?.toLowerCase().split('.').pop() ?? ''
  return TYPE_BY_EXT[ext] ?? ''
}

type TrialAssetStore = { getResource(sig: string): Promise<Blob | null> }

const trialStore = (): TrialAssetStore | undefined => {
  const holder = globalThis as { window?: { ioc?: { get?: <T>(key: string) => T | undefined } } }
  return holder.window?.ioc?.get?.<TrialAssetStore>('@hypercomb.social/Store')
}

/** Copy the page's pictures and stylesheets onto the trial. A miss leaves the page staged. */
const copyTrialAssets = async (label: string, html: string, page: URL): Promise<void> => {
  const sigs = extractPageRefSigs(html)
  if (!sigs.length) return
  const store = trialStore()
  if (!store?.getResource) return
  for (const sig of sigs) {
    try {
      const blob = await store.getResource(sig)
      if (!blob || blob.size < 1) continue
      const declared = blob.type.split(';')[0].trim().toLowerCase()
      let type = ASSET_TYPES.has(declared) ? declared : ''
      if (!type) {
        const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
        type = sniffAsset(head) || namedAssetType(html, sig)
      }
      if (!type) continue
      await fetch(new URL('/', page.origin), {
        method: 'POST',
        headers: { 'content-type': type, 'x-hc-trial': label, 'x-hc-trial-asset': sig },
        body: blob,
        signal: AbortSignal.timeout(20_000),
      })
    } catch { /* a missing picture does not unstage the page */ }
  }
}

/** Post the page to this hive. A new body is the next version. The same bytes
 *  as the latest version stay that version. A 204 is the accept. Pictures and
 *  stylesheets the page names are copied after the accept. A copy that misses
 *  does not undo the accept. */
export const stageTrial = async (label: string, html: string, here?: string): Promise<TrialStage> => {
  const name = trialBase(label)
  const missed: TrialStage = { ok: false, version: null, label: name, vector: null }
  if (!isSandboxLabel(name) || !html.trim()) return missed
  const page = hereOf(here)
  if (!page) return missed
  try {
    const response = await fetch(new URL('/', page.origin), {
      method: 'POST',
      headers: { 'content-type': 'text/html; charset=utf-8', 'x-hc-trial': name },
      body: html,
      signal: AbortSignal.timeout(1500),
    })
    if (response.status !== 204) return missed
    await copyTrialAssets(name, html, page)
    const version = Number(response.headers.get('x-hc-trial-version'))
    const assigned = response.headers.get('x-hc-trial-label') || name
    const vector = response.headers.get('x-hc-trial-vector') || ''
    return {
      ok: true,
      version: Number.isInteger(version) && version > 0 ? version : null,
      label: isSandboxLabel(assigned) ? assigned : name,
      vector: /^[1-9][0-9]*\.[0-9]+\.[0-9]+\.[1-9][0-9]*$/.test(vector) ? vector : null,
    }
  } catch { return missed }
}
