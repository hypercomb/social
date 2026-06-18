// diamondcoreprocessor.com/contact/contact-card.ts
//
// Contact storage has two parts, each plugged into the layer system the
// canonical way (LayerSlotRegistry / decorations) so both get undo-redo,
// time-travel, cross-browser sync, passivation, and content-addressed reuse:
//
//   • CAPABILITY — `visual:contact:enabled`, a cascading decoration placed on
//     a CONTAINER by `/contact`. Resolved by walking the lineage upward
//     (ContactService), so every descendant tile shows the contact icon. It's
//     a marker (presence is the signal), so the generic `decorations` slot is
//     the right home — same as `files:dropbox`.
//
//   • CARD DATA — a tile's contacts live in a DEDICATED first-class layer slot,
//     `contacts`: a flat list of card signatures (registered via
//     LayerSlotRegistry, trigger `contacts:changed`). Each card is a content-
//     addressed resource (so identical cards dedup and can be reused/shared),
//     and every add/remove is ONE committed marker the LayerCommitter cascades
//     to root — undoable and time-travelable like any other slot. This is the
//     "contacts list that registers into the layer system" — not a generic
//     decoration bag. (Recursive-composition rule: structured data attaches as
//     an extra flat-sig slot, never by extending the layer primitive's shape.)

import { EffectBus } from '@hypercomb/core'
import {
  writeDecoration,
  removeDecoration,
  listDecorations,
} from '../commands/decoration-manifest.js'
import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'

export const CONTACT_ENABLED_KIND = 'visual:contact:enabled'

/** The dedicated layer slot holding a tile's list of contact-card sigs. */
export const CONTACTS_SLOT = 'contacts'
/** Slot-delta trigger. Emit `{ segments, op, sig }`; LayerCommitter folds it
 *  into the `contacts` slot and commits one undoable marker (cascading up). */
export const CONTACTS_TRIGGER = 'contacts:changed'

const SIG_RE = /^[0-9a-f]{64}$/

/** Empty payload — presence of the decoration is the whole signal. Kept a
 *  stable shape so the same location always hashes to the same sig (dedup). */
export type ContactEnabledPayload = Record<string, never>

/** A single contact card. All fields optional except `name`. Stored CLOSED-
 *  SHAPE: the writer omits empty fields, so the serialized card carries only
 *  what's filled (no empty artifacts) — see ContactDrone.#saveContact. */
export interface ContactPayload {
  readonly name: string
  readonly organization?: string
  readonly title?: string
  readonly phone?: string
  readonly email?: string
  readonly website?: string
  readonly address?: string
  readonly note?: string
}

type StoreLike = {
  putResource(blob: Blob): Promise<string>
  getResource(signature: string): Promise<Blob | null>
}
type HistoryLike = {
  sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ contacts?: unknown } | null>
}

const ioc = (): { get?: <T>(k: string) => T | undefined } | undefined =>
  (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc

/** Read a tile's `contacts` slot → array of card sigs (no resource fetch). */
async function contactSigsAt(segments: readonly string[]): Promise<string[]> {
  const history = ioc()?.get?.<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
  if (!history) return []
  const locSig = await history.sign({ explorerSegments: () => segments })
  const layer = await history.currentLayerAt(locSig).catch(() => null)
  const slot = (layer as { contacts?: unknown })?.contacts
  return Array.isArray(slot) ? slot.map(s => String(s)).filter(s => SIG_RE.test(s)) : []
}

// ── Capability (the `/contact` marker — set by the parent) ─────────

/** Mark `segments` (a container) as contact-enabled. Cascades to every
 *  descendant via ContactService, so its children show the contact icon.
 *  Persistent so it survives a layer rewrite. Mirrors `writeDropbox`. */
export function enableContact(segments: readonly string[]): Promise<string> {
  return writeDecoration<ContactEnabledPayload>({
    kind: CONTACT_ENABLED_KIND,
    appliesTo: segments,
    payload: {},
    segments,
    mark: 'persistent',
  })
}

/** Contact-enabled capability decoration(s) declared AT this exact location. */
export function listContactEnabledHere(
  segments: readonly string[],
): Promise<Array<{ sig: string; record: { payload: ContactEnabledPayload } }>> {
  return listDecorations<ContactEnabledPayload>({ kind: CONTACT_ENABLED_KIND, segments }) as Promise<
    Array<{ sig: string; record: { payload: ContactEnabledPayload } }>
  >
}

/** Remove a contact-enabled capability (existing cards on descendants stay). */
export function removeContactEnabled(sig: string, segments: readonly string[]): void {
  removeDecoration({ sig, segments })
}

// ── Cards (the "list contact" — a dedicated `contacts` layer slot) ──

/**
 * Append a contact card to the tile at `segments`. The card is written as a
 * content-addressed resource (identical cards dedup / are reusable), then its
 * sig is folded into the tile's `contacts` slot via the `contacts:changed`
 * trigger — one undoable, cascading commit. Returns the card sig.
 */
export async function writeContact(segments: readonly string[], payload: ContactPayload): Promise<string> {
  const store = ioc()?.get?.<StoreLike>('@hypercomb.social/Store')
  if (!store?.putResource) throw new Error('[contact-card] Store / putResource not available')
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  const sig = await store.putResource(blob)
  EffectBus.emit(CONTACTS_TRIGGER, { segments, op: 'append', sig })
  return sig
}

/** Every contact card on the tile at `segments` — read from its `contacts`
 *  slot (the layer is the source of truth), resolving each sig to its payload. */
export async function listContacts(
  segments: readonly string[],
): Promise<Array<{ sig: string; payload: ContactPayload }>> {
  const store = ioc()?.get?.<StoreLike>('@hypercomb.social/Store')
  if (!store?.getResource) return []
  const sigs = await contactSigsAt(segments)
  const out: Array<{ sig: string; payload: ContactPayload }> = []
  for (const sig of sigs) {
    try {
      const blob = await store.getResource(sig)
      if (!blob) continue
      out.push({ sig, payload: JSON.parse(await blob.text()) as ContactPayload })
    } catch { /* malformed / missing resource — skip */ }
  }
  return out
}

/** True iff the tile at `segments` has at least one card in its `contacts`
 *  slot. Cheap (no resource fetch) — feeds ContactService's sync presence. */
export async function hasContactsAt(segments: readonly string[]): Promise<boolean> {
  return (await contactSigsAt(segments)).length > 0
}

/** Remove one card from the tile's `contacts` slot (the resource stays in the
 *  content store — it's addressable and may be reused elsewhere). */
export function removeContact(sig: string, segments: readonly string[]): void {
  EffectBus.emit(CONTACTS_TRIGGER, { segments, op: 'removeSig', sig })
}

// ── Slot registration ──────────────────────────────────────────────
//
// Register the `contacts` slot once LayerSlotRegistry is available (load-order
// independent). The active trigger makes the slot self-cascading: write a card
// resource, emit `contacts:changed`, and LayerCommitter folds the sig into the
// layer and commits — the same mechanical path as `decorations` / `notes`.

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<LayerSlotRegistry>(
  '@diamondcoreprocessor.com/LayerSlotRegistry',
  (slotRegistry) => {
    slotRegistry.register({ slot: CONTACTS_SLOT, triggers: [CONTACTS_TRIGGER] })
  },
)
