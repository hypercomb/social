// sharing/card-templates.ts
//
// FINDING THE COMMUNITY'S CARD TEMPLATES, and bringing one home to wear
// (jwize 2026-10-14: "an easy way to have community included templates so
// remember the primitive and pools"). The other half of
// card-template-offering.ts.
//
// The community is the hosts you name and follow: your own public host, then
// community:hosts. Each serves host:offerings (a floor pool, the same address
// everywhere); its card templates are the members whose meaning is
// `themes:card`. Every one is checked before it is shown —
// readHostCreations (hypercomb-core host-offerings.ts) verifies the
// publisher's signed index, the declared head, the host's current marker and
// the meta and leaf bytes by signature — and this file then checks the leaf's
// shape and that its theme is a theme. Nothing it reads is ever run.
//
// Wearing one brings the theme (and its default picture) into this hive by
// signature, so a later publish carries them to your own host like any other
// atom the card names.
import { SignatureService, get, readHostCreations, type HostCreation } from '@hypercomb/core'
import { verifyEvent } from 'nostr-tools/pure'
import { CARD_TEMPLATE_MEANING } from './card-template-offering.js'
import { listCommunityHosts } from './community-hosts.js'
import { zoneDoor } from './zone-door.js'

const SIG = /^[a-f0-9]{64}$/
const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const MAX_HOSTS = 16
const THEME_MAX = 65_536
const PICTURE_MAX = 1_048_576
const LEAF_MAX = 65_536

/** One community template: where it is offered, what it is called, and what it names. */
export type CardTemplateOffer = {
  host: string
  /** The publisher's own route for it: the handle is its last segment. */
  key: string
  handle: string
  label: string
  themeSig: string
  pictureSig?: string
  pubkey: string
}

export type CardTemplateIo = {
  hosts?: () => Promise<string[]>
  creations?: (host: string) => Promise<HostCreation[]>
  /** Bytes at https://<host>/<sig>, already checked against the signature. */
  atom?: (host: string, sig: string, limit: number) => Promise<Uint8Array | null>
}

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const verifyIndex = (index: Record<string, unknown>): boolean => {
  try { return verifyEvent(index as never) } catch { return false }
}
const handleOf = (key: string): string => (key.split('/').filter(Boolean).at(-1) ?? key).toLowerCase()

/** The hosts asked, in order: your own named host, then your community's. */
export async function communityTemplateHosts(): Promise<string[]> {
  const own = zoneDoor(get<{ publicHostDomain?: () => string }>('@diamondcoreprocessor.com/HostSyncService')?.publicHostDomain?.() || '')
  const named = await listCommunityHosts().catch(() => [] as string[])
  return [...new Set([own, ...named].map(h => zoneDoor(String(h ?? '').trim().toLowerCase())).filter(h => DOMAIN.test(h)))].slice(0, MAX_HOSTS)
}

async function fetchAtom(host: string, sig: string, limit: number): Promise<Uint8Array | null> {
  for (const base of [`https://${host}`, `https://${host}/content`]) {
    try {
      const res = await fetch(`${base}/${sig}`, { cache: 'force-cache', signal: AbortSignal.timeout(8000) })
      if (!res.ok || Number(res.headers.get('content-length') ?? 0) > limit) continue
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.byteLength <= limit && await SignatureService.sign(exact(bytes)) === sig) return bytes
    } catch { /* the other face, else nothing */ }
  }
  return null
}

const json = (bytes: Uint8Array | null): Record<string, unknown> | null => {
  if (!bytes) return null
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

/** A verified creation's leaf, as a template — or null when it is not one. */
async function templateOf(c: HostCreation, atom: NonNullable<CardTemplateIo['atom']>): Promise<CardTemplateOffer | null> {
  if (c.meaning !== CARD_TEMPLATE_MEANING) return null
  const leaf = json(await atom(c.host, c.payload, LEAF_MAX))
  if (!leaf || leaf['name'] !== 'card-theme'
    || typeof leaf['label'] !== 'string' || !leaf['label'].trim() || leaf['label'].length > 80
    || !SIG.test(String(leaf['theme'] ?? ''))
    || (leaf['picture'] !== undefined && !SIG.test(String(leaf['picture'])))) return null
  return {
    host: c.host, key: c.key, handle: handleOf(c.key), label: leaf['label'].trim(),
    themeSig: String(leaf['theme']), ...(leaf['picture'] ? { pictureSig: String(leaf['picture']) } : {}), pubkey: c.pubkey,
  }
}

/** Every card template your community offers, host by host. */
export async function findCardTemplates(io: CardTemplateIo = {}): Promise<CardTemplateOffer[]> {
  const hosts = await (io.hosts ?? communityTemplateHosts)()
  const creations = io.creations ?? ((host: string) => readHostCreations(host, verifyIndex))
  const atom = io.atom ?? fetchAtom
  const found = await Promise.all(hosts.map(async host => {
    const rows = await creations(host).catch(() => [] as HostCreation[])
    return (await Promise.all(rows.map(row => templateOf(row, atom)))).filter((t): t is CardTemplateOffer => !!t)
  }))
  return found.flat()
}

/** `example.com:contour` → the host and the handle, or null when the words are a route instead. */
export function parseTemplateHandle(raw: string): { host: string; handle: string } | null {
  const m = /^([a-z0-9.-]+\.[a-z]{2,}):([^\s/:]+)$/i.exec(String(raw ?? '').trim())
  return m ? { host: zoneDoor(m[1].toLowerCase()), handle: m[2].toLowerCase() } : null
}

export type BroughtTemplate = { offer: CardTemplateOffer; theme: Record<string, unknown> }

/** Find one template by its handle on its host, and bring its theme and picture into this hive by signature. */
export async function bringCardTemplate(host: string, handle: string, io: CardTemplateIo & {
  put?: (bytes: Uint8Array) => Promise<string>
} = {}): Promise<BroughtTemplate | { error: string }> {
  if (!DOMAIN.test(host)) return { error: `"${host}" is not a domain` }
  const offers = (await findCardTemplates({ ...io, hosts: async () => [host] })).filter(o => o.handle === handle)
  if (offers.length === 0) return { error: `${host} offers no card template called "${handle}"` }
  if (offers.length > 1) return { error: `${host} offers more than one "${handle}" — the publisher has to rename one` }
  const offer = offers[0]
  const atom = io.atom ?? fetchAtom
  const themeBytes = await atom(host, offer.themeSig, THEME_MAX)
  const theme = json(themeBytes)
  if (!themeBytes || !theme) return { error: `${offer.label}: its theme did not arrive from ${host}` }
  const pictureBytes = offer.pictureSig ? await atom(host, offer.pictureSig, PICTURE_MAX) : null
  if (offer.pictureSig && !pictureBytes) return { error: `${offer.label}: its picture did not arrive from ${host}` }
  const put = io.put ?? (async (bytes: Uint8Array) => {
    const store = get<{ putResource?: (b: Blob) => Promise<string> }>('@hypercomb.social/Store')
    if (!store?.putResource) throw new Error('no store')
    return store.putResource(new Blob([exact(bytes)]))
  })
  // Kept here by the same signature it was offered under: anything else is not what was offered.
  if (await put(themeBytes) !== offer.themeSig) return { error: `${offer.label}: its theme could not be kept` }
  if (pictureBytes && await put(pictureBytes) !== offer.pictureSig) return { error: `${offer.label}: its picture could not be kept` }
  return { offer, theme }
}
