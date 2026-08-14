// diamondcoreprocessor.com/link/google-docs-sync.ts
// Pure reconciliation between the participant's Drive and the hive's mirror —
// no class, no IoC, no storage. Decides WHAT should happen; a worker does it.
//
// Split out from google-docs.ts because this is the part with teeth: it is the
// only thing standing between "the hive holds the canonical body" and silently
// overwriting a document someone edited in Google.

import type { GoogleDocSummary } from './google-docs.js'

/**
 * The decoration kind a mirrored Doc tile carries, so render and behaviour
 * resolve from the mark rather than from a per-feature branch — same shape as
 * ROOM_PAGE_KIND / TUTOR_DECK_KIND.
 */
export const GOOGLE_DOC_KIND = 'visual:google:doc'

/**
 * What the hive remembers about one mirrored Doc. Lives in the
 * sign('google:docs') pool — state, not derived cache: a cold client cannot
 * rebuild "which Doc this tile mirrors" from layers alone, so this must never
 * be minted from the optimize phase.
 */
export type GoogleDocRecord = {
  id: string
  /** Drive's version counter at the moment the hive last pulled. */
  pulledVersion: string | null
  /**
   * Signature of the body AS EXPORTED BY GOOGLE — never of the bytes we sent.
   *
   * The round trip is NOT byte-identical (verified against a live deployment):
   * pushing `...**paragraph**.\n` exports back as `...**paragraph**.  \n`,
   * because the converter re-emits markdown from the Doc's structure rather
   * than storing our source. Recording the SENT bytes here would make
   * `currentSig !== pulledSig` true forever, so every document would report
   * unpushed edits immediately after a successful push, and every reconcile
   * would return `push` in an endless loop.
   *
   * So a push must be followed by a re-read, and THAT content's signature is
   * what lands here.
   */
  pulledSig: string
  /** Signature of the hive's body NOW. Differs from pulledSig once edited here. */
  currentSig: string
}

/**
 * What should happen to one document.
 *
 * `conflict` is the case that earns this module. Both sides moved: the hive has
 * edits that were never pushed AND Google's version advanced past what we
 * pulled. Pushing destroys their edit, pulling destroys ours. Neither is a
 * decision code gets to make quietly, so it becomes a thing the participant is
 * shown.
 */
export type GoogleDocAction =
  | { action: 'add'; doc: GoogleDocSummary }
  | { action: 'pull'; doc: GoogleDocSummary; record: GoogleDocRecord }
  | { action: 'push'; doc: GoogleDocSummary; record: GoogleDocRecord }
  | { action: 'conflict'; doc: GoogleDocSummary; record: GoogleDocRecord }
  | { action: 'unchanged'; doc: GoogleDocSummary; record: GoogleDocRecord }
  | { action: 'vanished'; record: GoogleDocRecord }

/** A remote doc moved since we pulled it. Missing versions read as "moved". */
const remoteMoved = (doc: GoogleDocSummary, record: GoogleDocRecord, version: string | null): boolean => {
  if (record.pulledVersion === null || version === null) return true
  return String(version) !== String(record.pulledVersion)
}

/** The hive edited its copy and has not pushed it back. */
const locallyEdited = (record: GoogleDocRecord): boolean =>
  record.currentSig !== record.pulledSig

/**
 * Compare Drive against the hive's records and say what each document needs.
 *
 * `versionOf` supplies the remote version per doc — it is passed in rather than
 * read from the summary because `list` does not carry version stamps; a caller
 * that has only modification times can hand those over instead, and a caller
 * that knows nothing gets the safe answer (everything reads as moved).
 *
 * A doc the hive tracks but Drive no longer returns is `vanished`, never
 * deleted implicitly: it may have been trashed, unshared, or simply missed by
 * a partial page, and destroying the participant's tile over an ambiguous
 * absence is not recoverable.
 */
export function reconcileGoogleDocs(
  remote: readonly GoogleDocSummary[],
  records: readonly GoogleDocRecord[],
  versionOf: (doc: GoogleDocSummary) => string | null = () => null,
): GoogleDocAction[] {
  const byId = new Map(records.map(record => [record.id, record]))
  const plan: GoogleDocAction[] = []

  for (const doc of remote) {
    const record = byId.get(doc.id)
    if (!record) {
      plan.push({ action: 'add', doc })
      continue
    }

    byId.delete(doc.id)

    const moved = remoteMoved(doc, record, versionOf(doc))
    const edited = locallyEdited(record)

    if (moved && edited) plan.push({ action: 'conflict', doc, record })
    else if (moved) plan.push({ action: 'pull', doc, record })
    else if (edited) plan.push({ action: 'push', doc, record })
    else plan.push({ action: 'unchanged', doc, record })
  }

  // Whatever is left was tracked but not returned by Drive this sweep.
  for (const record of byId.values()) plan.push({ action: 'vanished', record })

  return plan
}

/**
 * The Drive folders a pulled set sits in, with how many docs each holds.
 *
 * This is deliberately NOT a mark. Folder names are imported as *data* the
 * participant can choose to mark from — the hive regroups by pheromone, and a
 * doc can then belong to several groupings at once, which is the thing a Drive
 * folder cannot do. Minting marks from folder names in code would hardcode a
 * classification that belongs on the tiles.
 */
export function driveFolderCandidates(
  docs: readonly GoogleDocSummary[],
): { id: string; name: string; count: number }[] {
  const folders = new Map<string, { id: string; name: string; count: number }>()

  for (const doc of docs) {
    for (const parent of doc.parents) {
      const seen = folders.get(parent.id)
      if (seen) seen.count++
      else folders.set(parent.id, { id: parent.id, name: parent.name, count: 1 })
    }
  }

  return [...folders.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}
