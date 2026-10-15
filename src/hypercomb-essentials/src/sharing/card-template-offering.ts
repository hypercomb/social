// sharing/card-template-offering.ts
//
// OFFERING A CARD TEMPLATE TO THE COMMUNITY (jwize 2026-10-14: "an easy way to
// have community included templates so remember the primitive and pools").
//
// A card template is its THEME — the concept and the colours, one JSON atom —
// and, for a template that shows a picture, a default picture. The page never
// travels: every reader already runs the card page. Offering one is the
// text-theme pattern (text-theme-offering.ts): the bytes go to the host you
// named, then your signed index declares the offering, and the host lists it in
// `host:offerings` — a floor pool every host serves at the same address
// (hypercomb-relay/host-listing.floor.json), so following a host is finding its
// templates. Off withdraws the declaration; named bytes stay where they are.
//
//   location  sign('themes:card:' + key) — the key is the template tile's route
//   head      a meta record { meta: 1, relation: 'themes:card', layer }
//   layer     { name: 'card-theme', label, theme, picture? } — both by signature
//
// The host checks the same shape before it lists anything
// (blossom-worker/worker.js hasCreationHead).
import { SignatureService, get } from '@hypercomb/core'
import { fetchHiveIndex, putHiveManifest } from './hive-pointer.js'
import { zoneDoor } from './zone-door.js'

export const CARD_TEMPLATE_MEANING = 'themes:card'
const SIG = /^[a-f0-9]{64}$/
const DOMAIN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const THEME_MAX = 65_536
const PICTURE_MAX = 1_048_576

type StoreLike = { getResource: (sig: string) => Promise<Blob | null> }
type SyncLike = {
  publicHostDomain: () => string
  publishAtoms: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string; sig?: string }>
}
type SignerLike = { getPublicKeyHex: () => Promise<string | null> }

/** What a template offers: its route (the key), its name, its theme, and its picture when it has one. */
export type CardTemplate = { key: string; label: string; themeSig: string; pictureSig?: string }

export type CardTemplateOfferResult =
  | { ok: true; state: 'on' | 'off'; host: string }
  | { ok: false; reason: string }

export type CardTemplateOfferDeps = {
  store?: StoreLike
  sync?: SyncLike
  pubkey?: () => Promise<string | null>
  readIndex?: typeof fetchHiveIndex
  putIndex?: typeof putHiveManifest
}

const encoder = new TextEncoder()
const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const digest = (bytes: Uint8Array): Promise<string> => SignatureService.sign(exact(bytes))

/** Where a template is offered from: sign('themes:card:' + its key), the address the host checks. */
export const cardTemplateLocation = (key: string): Promise<string> =>
  digest(encoder.encode(`${CARD_TEMPLATE_MEANING}:${key}`))

/** The two records an offering names: the leaf and its meta head, as exact bytes. */
export async function cardTemplateLeaf(t: CardTemplate): Promise<{ layer: Uint8Array; layerSig: string; meta: Uint8Array; metaSig: string }> {
  const leaf: Record<string, string> = { name: 'card-theme', label: t.label, theme: t.themeSig }
  if (t.pictureSig) leaf['picture'] = t.pictureSig
  const layer = encoder.encode(JSON.stringify(leaf))
  const layerSig = await digest(layer)
  const meta = encoder.encode(JSON.stringify({ meta: 1, relation: CARD_TEMPLATE_MEANING, layer: layerSig }))
  return { layer, layerSig, meta, metaSig: await digest(meta) }
}

const bytesOf = async (store: StoreLike | undefined, sig: string, max: number): Promise<Uint8Array | null> => {
  const blob = await store?.getResource(sig).catch(() => null)
  if (!blob || blob.size > max) return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return await digest(bytes) === sig ? bytes : null
}

/** Offer a template on the host you named (on), or withdraw it (off). */
export async function setCardTemplateOffering(t: CardTemplate, on: boolean, deps: CardTemplateOfferDeps = {}): Promise<CardTemplateOfferResult> {
  if ((globalThis as typeof globalThis & { __HC_READONLY__?: boolean }).__HC_READONLY__ === true) {
    return { ok: false, reason: 'This visitor hive cannot publish.' }
  }
  const label = String(t.label ?? '').trim()
  if (!t.key || t.key.length > 256) return { ok: false, reason: 'This template has no route to offer it under.' }
  if (!label || label.length > 80) return { ok: false, reason: 'This template needs a name of up to 80 characters.' }
  if (!SIG.test(t.themeSig)) return { ok: false, reason: 'This template has no theme to offer.' }
  if (t.pictureSig !== undefined && !SIG.test(t.pictureSig)) return { ok: false, reason: 'Its picture is not a signature.' }

  // Writes go to the host the participant NAMED (jwize 2026-10-11: no default host).
  const sync = deps.sync ?? get<SyncLike>('@diamondcoreprocessor.com/HostSyncService')
  if (!sync?.publishAtoms || !sync.publicHostDomain) return { ok: false, reason: 'Host sync is unavailable.' }
  const host = zoneDoor(sync.publicHostDomain() || '')
  if (!DOMAIN.test(host)) return { ok: false, reason: 'Name your host first — hosts add <your-domain>.' }
  const signer = get<SignerLike>('@diamondcoreprocessor.com/NostrSigner')
  const pubkey = String(await (deps.pubkey?.() ?? signer?.getPublicKeyHex?.()) ?? '').toLowerCase()
  if (!SIG.test(pubkey)) return { ok: false, reason: 'A signing key is required.' }

  const read = await (deps.readIndex ?? fetchHiveIndex)(host, pubkey)
  if (read.ok && !read.manifest.signedContent) return { ok: false, reason: 'Verified index content is unavailable.' }
  if (!read.ok && !(read.reason === 'http' && read.status === 404)) {
    return { ok: false, reason: `Cannot safely read the host index (${read.reason}).` }
  }
  const location = await cardTemplateLocation(t.key)
  const offerings = { ...(read.ok ? read.manifest.offerings ?? {} : {}) }
  if (!on && !offerings[location]) return { ok: true, state: 'off', host }

  if (on) {
    const store = deps.store ?? get<StoreLike>('@hypercomb.social/Store')
    const theme = await bytesOf(store, t.themeSig, THEME_MAX)
    if (!theme) return { ok: false, reason: 'Its theme is not held here.' }
    try {
      const parsed = JSON.parse(new TextDecoder().decode(theme)) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'Its theme is not a theme.' }
    } catch { return { ok: false, reason: 'Its theme is not a theme.' } }
    const picture = t.pictureSig ? await bytesOf(store, t.pictureSig, PICTURE_MAX) : null
    if (t.pictureSig && !picture) return { ok: false, reason: 'Its picture is not held here, or is over 1 MB.' }
    const leaf = await cardTemplateLeaf({ ...t, label })
    const held = new Map<string, Uint8Array>([[t.themeSig, theme], [leaf.layerSig, leaf.layer], [leaf.metaSig, leaf.meta]])
    if (t.pictureSig && picture) held.set(t.pictureSig, picture)
    // The parts before the head that names them, so the host can check the leaf the moment it is declared.
    const sent = await sync.publishAtoms(host, [...held.keys()].filter(s => s !== leaf.metaSig).concat(leaf.metaSig),
      async sig => held.get(sig) ?? null)
    if (!sent.ok) return { ok: false, reason: sent.error }
    offerings[location] = { meaning: CARD_TEMPLATE_MEANING, key: t.key, head: leaf.metaSig, title: label, host }
  } else {
    delete offerings[location]
  }

  const previous = read.ok ? read.manifest.signedContent! : undefined
  const put = await (deps.putIndex ?? putHiveManifest)(host,
    read.ok ? read.manifest.roots : {}, read.ok ? read.manifest.doors ?? {} : {},
    read.ok ? read.manifest.createdAt : 0, { ...previous, offerings })
  if (!put.ok) return { ok: false, reason: put.reason ?? 'The signed index refused the change.' }
  if (put.pubkey !== pubkey) return { ok: false, reason: 'The signing key changed during publication.' }
  return { ok: true, state: on ? 'on' : 'off', host }
}
