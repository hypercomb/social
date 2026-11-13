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

import { listDecorations, removeDecorationAndWait, writeDecoration } from '../commands/decoration-manifest.js'
import { CARD_DATA_KIND } from '../commands/card-wear.js'

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

/** Point the tile at `segments`'s card to `sig` for `part`. */
export async function commitCardSig(segments: readonly string[], part: CardPart, sig: string): Promise<CardCommit> {
  if (!isSig(sig)) return { ok: false, error: 'the card was not stored' }
  const all = await listDecorations<Record<string, unknown>>({ kind: CARD_DATA_KIND, segments })
  const kept = pick(all)?.payload ?? {}
  if (part === 'theme' && !isSig(kept['dataSig'])) {
    return { ok: false, error: `/${segments.join('/')} has no card yet, and a theme needs one: write card /${segments.join('/')} first` }
  }
  for (const prior of all) await removeDecorationAndWait({ sig: prior.sig, segments })
  await writeDecoration({
    kind: CARD_DATA_KIND,
    appliesTo: segments,
    payload: { ...kept, [CARD_FIELD[part]]: sig },
    segments,
    mark: 'persistent',
  })
  return { ok: true }
}
