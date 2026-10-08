// commands/card-read.ts
//
// THE CARD AT A HEAD. A published card's head layer wears a `card:data` record (card-wear.ts) naming the card's
// JSON by signature, and optionally its theme and picture. The card page reads the same chain from its own tile;
// this reads it from any head, so a card held by its address can be read at the version you took
// (documentation/using-a-creation.md, "Holding a published item").
//
// Pure: bytes come from the io, which checks each against its signature. The head and anything it steps through
// are layers; the record and the card are resources.

import { readThrough } from '../sharing/static-peers.js'
import { CARD_DATA_KIND, CARD_PAGE_KIND } from './card-wear.js'

const SIG = /^[0-9a-f]{64}$/
const MAX_CARD = 65_536

export interface CardReadIo {
  layer: (sig: string) => Promise<Uint8Array | null>
  resource: (sig: string) => Promise<Uint8Array | null>
}

export interface CardAtHead {
  /** The card's JSON, as bytes named by dataSig. */
  dataSig: string
  text: string
  themeSig?: string
  artSig?: string
}

const sigOf = (v: unknown): string | undefined => { const s = String(v ?? '').toLowerCase(); return SIG.test(s) ? s : undefined }

export async function cardAtHead(head: string, io: CardReadIo): Promise<CardAtHead | null> {
  const layer = await readThrough(head, { bytes: io.layer })
  if (!layer) return null
  const slot = Array.isArray(layer.record['decorations']) ? layer.record['decorations'] : []
  for (const ref of slot) {
    const found = await readThrough(String(ref ?? ''), { bytes: io.resource })
    if (!found || found.record['kind'] !== CARD_DATA_KIND) continue
    const payload = found.record['payload'] && typeof found.record['payload'] === 'object' ? found.record['payload'] as Record<string, unknown> : {}
    const dataSig = sigOf(payload['dataSig'])
    if (!dataSig) continue
    const bytes = await io.resource(dataSig)
    if (!bytes || bytes.byteLength > MAX_CARD) return null   // a card is a few hundred bytes; the picture and theme are their own
    const text = new TextDecoder().decode(bytes)
    try {
      const card = JSON.parse(text) as unknown
      if (!card || typeof card !== 'object' || Array.isArray(card)) continue
    } catch { continue }
    return { dataSig, text, themeSig: sigOf(payload['themeSig']), artSig: sigOf(payload['artSig']) }
  }
  return null
}

/** THE PAGE AT A HEAD — the card page (`visual:website:page` → htmlSig) the head's card tile wears, or null when it
 *  wears none. What an app address's entrance follows: a publisher's newer page is a newer htmlSig here
 *  (documentation/using-a-creation.md, "Powers are off by default, and the participant turns them on"). Only the
 *  layer and its record are read; the page's own bytes are not. */
export async function pageAtHead(head: string, io: CardReadIo): Promise<string | null> {
  const layer = await readThrough(head, { bytes: io.layer })
  if (!layer) return null
  const slot = Array.isArray(layer.record['decorations']) ? layer.record['decorations'] : []
  for (const ref of slot) {
    const found = await readThrough(String(ref ?? ''), { bytes: io.resource })
    if (!found || found.record['kind'] !== CARD_PAGE_KIND) continue
    const payload = found.record['payload'] && typeof found.record['payload'] === 'object' ? found.record['payload'] as Record<string, unknown> : {}
    const htmlSig = sigOf(payload['htmlSig'])
    if (htmlSig) return htmlSig
  }
  return null
}
