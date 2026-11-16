// files/card-commit.ts
//
// ONE WAY A TILE'S CARD IS REPLACED — the card's twin of page-commit.ts. A
// business card is two records on its tile (documentation/business-card.md):
// the page every card wears, and the tile's own `card:data` record naming the
// card's details (dataSig) and, optionally, its theme (themeSig) and picture
// (artSig). The new JSON is already a resource; this points the record at it:
// the record is replaced, keeping everything else it said about itself, and
// changing only the one signature.
//
// Nothing is deleted: the JSON it replaces stays at the content root and the
// tile's history still reaches it, so a replacement is one undo away. Used by
// a model's write block on a managed site door (tile-files.drone.ts).

import { isMetaEnvelope, metaPayloadOf } from '@hypercomb/core'
import { listDecorations, removeDecorationAndWait, writeDecoration } from '../commands/decoration-manifest.js'
import { CARD_DATA_KIND } from '../commands/card-wear.js'
import { collectSigsDeep } from '../sharing/decoration-closure.js'

/** The two JSON documents a card's record names. */
export type CardPart = 'details' | 'theme'

/** The payload field each part is named by. */
export const CARD_FIELD: Readonly<Record<CardPart, 'dataSig' | 'themeSig'>> = { details: 'dataSig', theme: 'themeSig' }

/** A card is a few hundred bytes; its picture and its theme are their own. The
 *  reader refuses larger (commands/card-read.ts), so the writer does too. */
export const MAX_CARD_BYTES = 65_536

const isSig = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

export type CardCommit = { readonly ok: true } | { readonly ok: false; readonly error: string }

/** The tile's card record as the card page reads it: the first one that
 *  names its details, else the first at all — or null when it has none. */
export async function cardRecordAt(segments: readonly string[]): Promise<{ sig: string; payload: Record<string, unknown> } | null> {
  return pick(await listDecorations<Record<string, unknown>>({ kind: CARD_DATA_KIND, segments }))
}

const pick = (all: readonly { sig: string; record: { payload: Record<string, unknown> } }[]): { sig: string; payload: Record<string, unknown> } | null => {
  const found = all.find(({ record }) => isSig(record.payload?.['dataSig'])) ?? all[0]
  if (!found) return null
  const payload = found.record.payload && typeof found.record.payload === 'object' ? found.record.payload : {}
  return { sig: found.sig, payload }
}

/** Why `text` is not a card's JSON, or null when it is one: one JSON object. */
export function cardJsonRefusal(text: string): string | null {
  if (new TextEncoder().encode(text).byteLength > MAX_CARD_BYTES) return `a card's JSON is at most ${MAX_CARD_BYTES} bytes`
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'a card\'s JSON is one object, { … }'
    return null
  } catch (error) {
    return `the card is not JSON: ${error instanceof Error ? error.message : 'it does not parse'}`
  }
}

/** A card's JSON names at most this many further resources. */
export const MAX_CARD_NAMED = 48

type LocalStore = { getResourceLocal?(sig: string): Promise<Blob | null> }

/**
 * THE BYTES A CARD'S JSON NAMES. The record's payload holds one signature for
 * the details and one for the theme, and a record's references are read from
 * its payload, so a signature INSIDE that JSON was never followed: the card's
 * page is framed with the bytes its records declare and nothing else, and a
 * publish carries the same set. A model linked four creations' pictures into
 * the card's details by signature and none of them reached the page
 * (business-card.jwize.com, 2026-11-15).
 *
 * So the writer, who knows its own closure, declares it: every signature in
 * the details and the theme that THIS DEVICE holds as a resource, and, where
 * one is a pointer to a resource, the resource it points at. Asked of this
 * device only, never a host: a signature that names no bytes here is an
 * address or a key, and declaring it would send every reader after bytes
 * that do not exist.
 */
export async function cardNamedSigs(payload: Readonly<Record<string, unknown>>): Promise<string[]> {
  const store = window.ioc.get<LocalStore>('@hypercomb.social/Store')
  if (!store?.getResourceLocal) return []
  const local = async (sig: string): Promise<Blob | null> => store.getResourceLocal!(sig).catch(() => null)
  const jsonOf = async (blob: Blob | null): Promise<unknown> => {
    if (!blob || blob.size > MAX_CARD_BYTES) return undefined
    try { return JSON.parse(await blob.text()) as unknown } catch { return undefined }
  }
  const own = new Set(Object.values(CARD_FIELD).map(field => payload[field]).filter(isSig))
  const named = new Set<string>()
  for (const sig of own) {
    for (const candidate of collectSigsDeep(await jsonOf(await local(sig)))) {
      if (named.size >= MAX_CARD_NAMED) break
      if (own.has(candidate) || named.has(candidate)) continue
      const blob = await local(candidate)
      if (!blob) continue
      named.add(candidate)
      // A pointer names the resource it stands for; both travel.
      const pointer = await jsonOf(blob)
      const target = isMetaEnvelope(pointer) ? metaPayloadOf(pointer) : null
      if (target?.kind === 'resource' && !named.has(target.sig) && await local(target.sig)) named.add(target.sig)
    }
  }
  return [...named]
}

/** Does the card's record already declare everything its JSON names? A card
 *  written before the writer declared them does not, and neither does one
 *  whose pictures arrived on this device after it was written: writing the
 *  same JSON again must still carry them. */
export async function cardDeclaresItsNames(segments: readonly string[]): Promise<boolean> {
  const all = await listDecorations<Record<string, unknown>>({ kind: CARD_DATA_KIND, segments })
  const found = all.find(({ record }) => isSig(record.payload?.['dataSig'])) ?? all[0]
  if (!found) return true
  const declared = new Set((found.record.refs ?? []).map(ref => String(ref).toLowerCase()))
  const payload = found.record.payload && typeof found.record.payload === 'object' ? found.record.payload : {}
  return (await cardNamedSigs(payload)).every(sig => declared.has(sig))
}

/** Point the tile at `segments`'s card to `sig` for `part`. */
export async function commitCardSig(segments: readonly string[], part: CardPart, sig: string): Promise<CardCommit> {
  if (!isSig(sig)) return { ok: false, error: 'the card was not stored' }
  const all = await listDecorations<Record<string, unknown>>({ kind: CARD_DATA_KIND, segments })
  const kept = pick(all)?.payload ?? {}
  if (part === 'theme' && !isSig(kept['dataSig'])) {
    return { ok: false, error: `/${segments.join('/')} has no card yet, and a theme needs one: write card /${segments.join('/')} first` }
  }
  const payload = { ...kept, [CARD_FIELD[part]]: sig }
  const refs = await cardNamedSigs(payload)
  for (const prior of all) await removeDecorationAndWait({ sig: prior.sig, segments })
  await writeDecoration({
    kind: CARD_DATA_KIND,
    appliesTo: segments,
    payload,
    segments,
    mark: 'persistent',
    ...(refs.length ? { refs } : {}),
  })
  return { ok: true }
}
