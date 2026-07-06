// diamondcoreprocessor.com/files/files-attachment.ts
//
// Files ride the existing `decorations` slot (see commands/decoration-
// manifest.ts) as two decoration kinds — no new layer slot, no new
// sync substrate. Reusing decorations gives us the resource pipeline,
// host/DCP backup, peer sharing, and the synchronous decoration-kind
// index (commands/decoration-kind-index.ts → `hasDecorationKind`, which
// the overlay icon's `visibleWhen` reads) for free.
//
//   files:dropbox     — capability placed on a CONTAINER. payload.accept
//                       lists the extensions it takes. Resolved by walking
//                       the lineage upward (DropboxService), so a tile is
//                       droppable when the decoration is found on it OR any
//                       ancestor (cascading, top-down).
//   files:attachment  — a concrete downloadable file placed on ONE tile.
//                       payload points at the raw bytes saved via
//                       Store.putResource → a content sig file at the flat
//                       OPFS root (legacy `__resources__/<sig>` is a read-fallback).

import {
  writeDecoration,
  removeDecoration,
  listDecorations,
} from '../commands/decoration-manifest.js'

export const FILES_DROPBOX_KIND = 'files:dropbox'
export const FILES_ATTACHMENT_KIND = 'files:attachment'

/** Capability record: which files this subtree accepts. */
export interface DropboxPayload {
  /** Lowercase extensions, or `['any']` for the wildcard. */
  readonly accept: readonly string[]
}

/** A single attached file. `sig` is the bytes resource signature. */
export interface AttachmentPayload {
  readonly name: string
  readonly mime: string
  readonly size: number
  readonly sig: string
}

// ── Dropbox capability ────────────────────────────────────────────

/** Mark `segments` (a container) as a typed dropbox. Cascades to all
 *  descendants. Persistent so it survives a layer rewrite. */
export function writeDropbox(segments: readonly string[], accept: readonly string[]): Promise<string> {
  return writeDecoration<DropboxPayload>({
    kind: FILES_DROPBOX_KIND,
    appliesTo: segments,
    payload: { accept },
    segments,
    mark: 'persistent',
  })
}

/** Dropbox decoration(s) declared AT this exact location (not cascading). */
export function listDropboxHere(segments: readonly string[]): Promise<Array<{ sig: string; record: { payload: DropboxPayload } }>> {
  return listDecorations<DropboxPayload>({ kind: FILES_DROPBOX_KIND, segments }) as Promise<
    Array<{ sig: string; record: { payload: DropboxPayload } }>
  >
}

/** Remove the dropbox capability declared at this location. */
export function removeDropbox(sig: string, segments: readonly string[]): void {
  removeDecoration({ sig, segments })
}

// ── Attachments ───────────────────────────────────────────────────

/** Attach a file (already saved as a resource) to the tile at `segments`. */
export function writeAttachment(segments: readonly string[], payload: AttachmentPayload): Promise<string> {
  return writeDecoration<AttachmentPayload>({
    kind: FILES_ATTACHMENT_KIND,
    appliesTo: segments,
    payload,
    segments,
  })
}

/** All files attached to the tile at `segments`. */
export async function listAttachments(segments: readonly string[]): Promise<Array<{ sig: string; payload: AttachmentPayload }>> {
  const found = await listDecorations<AttachmentPayload>({ kind: FILES_ATTACHMENT_KIND, segments })
  return found.map(({ sig, record }) => ({ sig, payload: record.payload }))
}

/** Detach a file from the tile at `segments` (content bytes stay at the flat
 *  OPFS root — content-addressed, may be shared). */
export function removeAttachment(sig: string, segments: readonly string[]): void {
  removeDecoration({ sig, segments })
}
