// notes/notes.drone.ts
//
// A note is a content-addressed JSON blob with the shape:
//
//     { "children": ["<sub-note-sig>", ...], "note": "<the note text>" }
//
// `note` is the body text inline; `children` is a flat array of sub-note
// layer sigs (recursive — sub-notes are notes too). No name field, no id
// field, no createdAt, no tags. The blob's signature IS the note's
// identity for the lifetime of those exact bytes — edit the text or any
// child sig → new canonical JSON → new sig → swap in the parent's slot.
//
// The owning cell carries the top-level notes in its `notes` slot
// (`notes: [<note-sig>, ...]`). Sub-notes live in each note's own
// `children` slot. Both arrays hold the same kind of value — note layer
// sigs — but the slot names differ because the containers differ (cells
// call them `notes`; notes call their sub-notes `children`).
//
// Storage: note blobs are content-addressed resources — sig-named files
// at the flat OPFS root (legacy `__resources__/<sig>` is a read-fallback),
// alongside other resources. No per-note history bag — the note is
// just its bytes. Per-note edit history is reconstructed by walking the
// owning cell's layer history and looking at which sig occupied each
// position at each revision.
//
// Cascade: when a note is added / edited / deleted, NotesService emits
// `notes:changed` with `{ segments, op, sig }`. The `notes` slot is
// registered with LayerSlotRegistry under that trigger, so LayerCommitter
// picks up the event and folds the change into the cell's layer, which
// propagates to root via the standard merkle cascade.

import { EffectBus } from '@hypercomb/core'
import { writeNotesFacet } from './notes-facet.js'
import {
  addChildInTree,
  insertAsChild,
  insertAtIndex,
  isNoteTag,
  normalizeMark,
  normalizeShape,
  normalizeTags,
  removeFromTree,
  setMarkInTree,
  setTagInTree,
  setTextInTree,
  splitInTree,
  subtreeContains,
  type Note,
  type NoteLayer,
  type NotePart,
  type ShapeId,
} from './note-tree.js'

// Re-exported so consumers keep importing the note shapes from the module
// that owns the service. The definitions live in note-tree.ts because the
// tree algebra needs them and must stay importable without booting
// NotesService (this module registers into window.ioc at import time).
export type { Note, NotePart, ShapeId } from './note-tree.js'

const NOTES_TRIGGER = 'notes:changed'
const NOTES_SLOT = 'notes'

const SIG_REGEX = /^[a-f0-9]{64}$/

type Lineage = {
  explorerSegments?: () => readonly string[]
}

type HistoryServiceLike = {
  sign: (lineage: Lineage) => Promise<string>
  currentLayerAt: (locSig: string) => Promise<{ [k: string]: unknown } | null>
  peekCurrentLayer: (locSig: string) => { [k: string]: unknown } | null
  getLayerBySig: (sig: string) => Promise<{ [k: string]: unknown } | null>
}

type StoreLike = {
  putResource: (blob: Blob) => Promise<string>
  getResource: (sig: string) => Promise<Blob | null>
  resolve: <T = unknown>(sig: string) => Promise<T>
}

type LayerCommitterLike = {
  update: (
    segments: readonly string[],
    layer: { name?: string; [slot: string]: unknown },
    nameSlots?: ReadonlySet<string>,
  ) => Promise<string>
}

type LayerSlotRegistryLike = {
  register: (slot: { slot: string; triggers: readonly string[] }) => void
}

/**
 * NotesService — content-addressed notes attached to cells.
 *
 * Cells carry top-level notes in their `notes` slot (sigs pointing at
 * note blobs — root sig files; legacy `__resources__/` is a read-fallback).
 * Notes carry sub-notes in their own
 * `children` slot. No HiveParticipant base class; this service stands
 * on its own (cells and notes are independent shapes that happen to
 * share `children` as a hierarchy slot — they don't implement a common
 * interface).
 */
export class NotesService {

  readonly slot = NOTES_SLOT
  readonly triggerName = NOTES_TRIGGER

  // Decoded note layers, keyed by layer sig. Populated lazily on read,
  // and on write right after we mint a layer.
  readonly #cache = new Map<string, NoteLayer>()

  // Latest shape staged by the strip's toolbar via `notes:active-shape`.
  // Written into the layer at commit time, so the strip's UI choice
  // travels through the command-line's text-only payload without
  // entering the command-line's surface. Reset to null on capture exit.
  #activeShape: ShapeId | null = null

  // Latest MARK staged by the strip's icon rail via `notes:active-mark`.
  // Same channel as #activeShape: the strip's visual choice rides along
  // with the text-only commit payload. Null = the note carries no mark.
  #activeMark: string | null = null

  // Memoized cell-locationSig keyed by `parent/cellLabel`. Cleared on
  // lineage navigation (same cellLabel resolves to a different location
  // depending on the current folder).
  readonly #cellLocSigCache = new Map<string, string>()

  constructor() {
    // Drop the previous notes-system localStorage key. The new system
    // is fully content-addressed — anything legacy is cruft.
    this.#purgeLegacyKey('hc:notes-index')

    // Register the `notes` slot as PASSIVE — no triggers — because we
    // drive the cascade ourselves via LayerCommitter.update() so we can
    // await it and emit `notes:changed` for UI consumers strictly AFTER
    // the cell layer has settled. If we registered with triggers here,
    // LayerCommitter would also queue the change asynchronously and the
    // UI listener would race the cascade.
    window.ioc.whenReady<LayerSlotRegistryLike>(
      '@diamondcoreprocessor.com/LayerSlotRegistry',
      (registry) => {
        registry.register({ slot: NOTES_SLOT, triggers: [] })
      },
    )

    // Lineage navigation invalidates the per-cell locationSig cache —
    // same cellLabel resolves to a different location depending on the
    // current folder.
    const lineage = get<EventTarget>('@hypercomb.social/Lineage') as unknown as EventTarget | undefined
    lineage?.addEventListener?.('change', () => this.#cellLocSigCache.clear())

    // (The per-tile "note" overlay icon was removed — superseded by the
    // notes-strip, which owns `note:capture`. There is no longer a
    // tile-overlay affordance for adding a note.)

    // ── EffectBus wiring ──────────────────────────────────────────────

    // `note:capture` is now handled entirely by the notes-strip: it opens
    // the in-panel form for the target cell. The drone no longer bridges it
    // into a command-line capture — the command line stays free for a future
    // explicit quick-note syntax (which can emit `command:enter-mode` with
    // mode 'note-capture' directly).

    // The strip emits this whenever the user picks / clears a shape
    // in the toolbar, OR when capture mode opens (so we get the
    // pre-filled shape for an in-flight edit). Last-value wins.
    EffectBus.on<{ shape?: unknown }>('notes:active-shape', (payload) => {
      this.#activeShape = normalizeShape(payload?.shape)
    })

    // Mark counterpart of `notes:active-shape` — the icon rail emits this
    // whenever the user picks or clears a mark. Last-value wins.
    EffectBus.on<{ mark?: unknown }>('notes:active-mark', (payload) => {
      this.#activeMark = normalizeMark(payload?.mark)
    })

    EffectBus.on<{ cellLabel: string; text: string; shape?: unknown; mark?: unknown; editId?: string }>('note:commit', (payload) => {
      const text = (payload?.text ?? '').trim()
      if (!payload?.cellLabel || !text) return
      // Prefer an explicit shape on the payload (rare — most paths route
      // the choice through `notes:active-shape`). Fall back to the
      // cached active shape staged by the strip.
      const payloadShape = normalizeShape(payload.shape)
      const shape = payloadShape ?? this.#activeShape
      // The mark rides the payload directly (the strip always sends the
      // rail's current pick, including an explicit null to CLEAR it), so a
      // payload that carries the key at all wins over the staged value.
      const mark = 'mark' in (payload as object) ? normalizeMark(payload.mark) : this.#activeMark
      void this.#commit(payload.cellLabel, text, shape, mark, payload.editId)
    })

    // Add ONE new sub-note under an existing note — the list interface's
    // whole write gesture (a list is built a line at a time, and every line
    // is a child of the list's root). `note:commit` can only append at the
    // TOP LEVEL, so without this a list item costs a commit plus a nest.
    EffectBus.on<{ cellLabel: string; parentId: string; text: string; mark?: unknown }>(
      'note:add-child',
      (payload) => {
        if (!payload?.cellLabel || !payload?.parentId) return
        const text = (payload.text ?? '').trim()
        if (!text) return
        const mark = 'mark' in (payload as object) ? normalizeMark(payload.mark) : null
        void this.#addChild(payload.cellLabel, payload.parentId, text, mark)
      },
    )

    // Retext a note AT ANY DEPTH, keeping its children, its position, its
    // pheromones and (unless the payload names one) its mark. The
    // `note:commit` edit path can't: it rewrites the cell's top-level slot,
    // so a nested note edited through it silently doesn't change and a
    // parent edited through it loses its subtree.
    EffectBus.on<{ cellLabel: string; noteId: string; text: string; mark?: unknown }>(
      'note:retext',
      (payload) => {
        if (!payload?.cellLabel || !payload?.noteId) return
        const text = (payload.text ?? '').trim()
        if (!text) return
        const mark = 'mark' in (payload as object) ? normalizeMark(payload.mark) : undefined
        void this.#retext(payload.cellLabel, payload.noteId, text, mark)
      },
    )

    EffectBus.on<{ cellLabel: string; noteId: string }>('note:delete', (payload) => {
      if (!payload?.cellLabel || !payload?.noteId) return
      void this.#deleteByCellLabel(payload.cellLabel, payload.noteId)
    })

    // Reorder a cell's notes by moving `sourceId` to a new index. The
    // strip's drag-handle UI fires this; under the hood it's just a
    // permutation of the existing `notes` slot's sig array — no new
    // resource bytes get written.
    EffectBus.on<{ cellLabel: string; sourceId: string; targetIndex: number }>(
      'note:reorder',
      (payload) => {
        if (!payload?.cellLabel || !payload?.sourceId) return
        if (typeof payload.targetIndex !== 'number') return
        void this.#reorderByCellLabel(payload.cellLabel, payload.sourceId, payload.targetIndex)
      },
    )

    // Nest `sourceId` under `targetParentId`. Both must already exist in
    // the cell's tree (any depth). The full tree is read, mutated, and
    // re-materialized from leaves up — unchanged subtrees hit the
    // Store's content-address dedup and produce identical sigs.
    EffectBus.on<{ cellLabel: string; sourceId: string; targetParentId: string }>(
      'note:nest',
      (payload) => {
        if (!payload?.cellLabel || !payload?.sourceId || !payload?.targetParentId) return
        if (payload.sourceId === payload.targetParentId) return
        void this.#moveNote(payload.cellLabel, payload.sourceId, payload.targetParentId)
      },
    )

    // Un-nest `sourceId` — move it back to the cell's top level.
    // Equivalent to `#moveNote(cellLabel, sourceId, null)`.
    EffectBus.on<{ cellLabel: string; sourceId: string }>(
      'note:unnest',
      (payload) => {
        if (!payload?.cellLabel || !payload?.sourceId) return
        void this.#moveNote(payload.cellLabel, payload.sourceId, null)
      },
    )

    // Move `sourceId` to a PLACE: among `parentId`'s children (or among the
    // roots, with a null parent) at `index`. One op for everything a
    // hierarchy needs — reorder among siblings AT ANY DEPTH, nest, un-nest —
    // which `note:reorder` (top level only) and `note:nest` (append) could
    // not express between them. The index is read against the tree with the
    // source already plucked out, which is the order the move happens in.
    EffectBus.on<{ cellLabel: string; sourceId: string; parentId?: string | null; index?: number }>(
      'note:move',
      (payload) => {
        if (!payload?.cellLabel || !payload?.sourceId) return
        const parentId = payload.parentId ?? null
        if (parentId === payload.sourceId) return
        const index = typeof payload.index === 'number' ? payload.index : undefined
        void this.#moveNote(payload.cellLabel, payload.sourceId, parentId, index)
      },
    )

    // Drop a mark from the strip's icon rail onto an existing note. Only
    // the mark changes: the tree is read, the node found at ANY depth, its
    // mark replaced, and the tree re-materialized from leaves up — so a
    // marked parent keeps its children and its position. (The `note:commit`
    // edit path can't express this: it writes a childless layer into the
    // TOP-LEVEL slot.) A null mark clears it.
    EffectBus.on<{ cellLabel: string; noteId: string; mark?: unknown }>(
      'note:mark',
      (payload) => {
        if (!payload?.cellLabel || !payload?.noteId) return
        void this.#markNote(payload.cellLabel, payload.noteId, normalizeMark(payload.mark))
      },
    )

    // Drop a PHEROMONE from the Pheromones panel onto a note in the reader.
    // Same tree-rewrite shape as `note:mark` and for the same reason: the
    // node can be at any depth and must keep its children and its position.
    // `add` is the direction — omit it (or send true) to put the keyword on,
    // send false to take it off. Toggling is the CALLER's decision, so a
    // second drop of the same keyword is an idempotent no-op rather than a
    // surprise removal.
    EffectBus.on<{ cellLabel: string; noteId: string; tag: string; add?: boolean }>(
      'note:tag',
      (payload) => {
        if (!payload?.cellLabel || !payload?.noteId) return
        if (!isNoteTag(payload.tag)) return
        void this.#tagNote(
          payload.cellLabel,
          payload.noteId,
          String(payload.tag).trim(),
          payload.add !== false,
        )
      },
    )

    // Break one note into a one-line head plus a sub-note per part, in
    // place. The note keeps its position, its mark and any children it
    // already had. One layer for the whole split — see `splitAtSegments`.
    EffectBus.on<{ cellLabel: string; noteId: string; head: string; parts?: unknown }>(
      'note:split',
      (payload) => {
        if (!payload?.cellLabel || !payload?.noteId) return
        if (!Array.isArray(payload.parts)) return
        void this.#splitNote(
          payload.cellLabel,
          payload.noteId,
          payload.head,
          payload.parts as readonly (string | NotePart)[],
        )
      },
    )
  }

  /** Move the sig identified by `sourceId` to `targetIndex` within the
   *  cell's notes slot. Out-of-range indices are clamped. If sourceId
   *  is already at the target index it's a no-op. */
  async #reorderByCellLabel(cellLabel: string, sourceId: string, targetIndex: number): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) return
    await this.#commitCellNotes(resolved.segments, (prior) => {
      const current = prior.findIndex(s => s === sourceId)
      if (current === -1) return prior  // sourceId not in this cell; ignore
      const without = prior.filter(s => s !== sourceId)
      const idx = Math.max(0, Math.min(targetIndex, without.length))
      if (idx === current) return prior  // no-op
      return [...without.slice(0, idx), sourceId, ...without.slice(idx)]
    })
  }

  // ── Public read API ───────────────────────────────────────────────

  /**
   * Synchronous notes for a cell at the user's current lineage. Reads
   * from the peek cache (populated by the preloader walk and by writes).
   * Returns an empty array if the cell hasn't been touched yet — call
   * `getNotes()` for the async hydrating read.
   */
  public readonly notesFor = (cellLabel: string): Note[] => {
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return []
    const locSig = this.#cellLocationSigSync(cellLabel)
    if (!locSig) return []
    const layer = history.peekCurrentLayer(locSig)
    if (!layer) return []
    const sigs = (layer as Record<string, unknown>)[NOTES_SLOT]
    if (!Array.isArray(sigs)) return []
    const out: Note[] = []
    for (const sig of sigs) {
      if (typeof sig !== 'string' || !SIG_REGEX.test(sig)) continue
      const cached = this.#cache.get(sig)
      if (cached) out.push(this.#hydrate(sig, cached))
    }
    return out
  }

  /**
   * Async-resolving notes for a cell at the user's current lineage.
   * Walks OPFS as needed so reads at first selection match what writes
   * see.
   */
  public readonly getNotes = async (cellLabel: string): Promise<Note[]> => {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) return []
    return this.#readAtLocation(resolved.locationSig)
  }

  /**
   * Async-resolving notes for an EXPLICIT segments path — bypasses the
   * user's current lineage. Used by renderers walking a tree (e.g. the
   * website surface) without temporarily navigating the user.
   */
  public readonly getNotesAtSegments = async (segments: readonly string[]): Promise<Note[]> => {
    const cleaned = (segments ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    if (cleaned.length === 0) return []
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return []
    const locSig = await history.sign({ explorerSegments: () => cleaned })
    return this.#readAtLocation(locSig)
  }

  // ── Public write API ──────────────────────────────────────────────

  /**
   * Append a top-level note at an explicit cell location. Used by the
   * bridge for headless note authoring during imports / scripted hive
   * builds.
   */
  public async addAtSegments(
    parentSegments: readonly string[],
    cellLabel: string,
    text: string,
    shape: ShapeId | null = null,
    mark: string | null = null,
  ): Promise<void> {
    const cleanedParents = (parentSegments ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const cleanedLabel = String(cellLabel ?? '').trim()
    const cleanedText = String(text ?? '').trim()
    if (!cleanedLabel || !cleanedText) return
    const segments = [...cleanedParents, cleanedLabel]
    const sig = await this.#writeNoteLayer(cleanedText, normalizeShape(shape), normalizeMark(mark), [])
    await this.#commitCellNotes(segments, (prior) => [...prior, sig])
  }

  /**
   * Remove a note by its layer sig at an explicit cell location. Works
   * for top-level AND nested notes — walks the tree, drops the node
   * (and its entire subtree), then re-materializes from leaves. Used
   * by the `note:delete` EffectBus handler and headless callers.
   */
  public async deleteAtSegments(
    parentSegments: readonly string[],
    cellLabel: string,
    noteId: string,
  ): Promise<void> {
    const cleanedParents = (parentSegments ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const cleanedLabel = String(cellLabel ?? '').trim()
    const cleanedSig = String(noteId ?? '').trim()
    if (!cleanedLabel || !cleanedSig) return
    const segments = [...cleanedParents, cleanedLabel]
    await this.#deleteFromTree(segments, cleanedSig)
  }

  /**
   * Nest `sourceId` under `targetParentId` at an explicit cell location.
   * Both must already exist in the cell's tree (any depth). Headless
   * equivalent of the `note:nest` EffectBus handler.
   */
  public async nestAtSegments(
    parentSegments: readonly string[],
    cellLabel: string,
    sourceId: string,
    targetParentId: string,
  ): Promise<void> {
    const cleanedParents = (parentSegments ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const cleanedLabel = String(cellLabel ?? '').trim()
    if (!cleanedLabel || !sourceId || !targetParentId) return
    if (sourceId === targetParentId) return
    const segments = [...cleanedParents, cleanedLabel]
    await this.#moveNoteAtSegments(segments, sourceId, targetParentId)
  }

  /**
   * Un-nest `sourceId` — move it back to the cell's top level. No-op
   * if it's already at the top level. Headless equivalent of
   * `note:unnest`.
   */
  public async unnestAtSegments(
    parentSegments: readonly string[],
    cellLabel: string,
    sourceId: string,
  ): Promise<void> {
    const cleanedParents = (parentSegments ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const cleanedLabel = String(cellLabel ?? '').trim()
    if (!cleanedLabel || !sourceId) return
    const segments = [...cleanedParents, cleanedLabel]
    await this.#moveNoteAtSegments(segments, sourceId, null)
  }

  /**
   * Move `sourceId` to a PLACE at an explicit cell location: among
   * `parentId`'s children (or among the roots, with a null parent) at
   * `index`. Omit the index to append, which is what `nestAtSegments` /
   * `unnestAtSegments` do. Headless equivalent of the `note:move` handler.
   */
  public async moveAtSegments(
    parentSegments: readonly string[],
    cellLabel: string,
    sourceId: string,
    parentId: string | null,
    index?: number,
  ): Promise<void> {
    const cleanedParents = (parentSegments ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const cleanedLabel = String(cellLabel ?? '').trim()
    if (!cleanedLabel || !sourceId) return
    if (sourceId === parentId) return
    const segments = [...cleanedParents, cleanedLabel]
    await this.#moveNoteAtSegments(segments, sourceId, parentId ?? null, index)
  }

  /**
   * Set (or clear, with `null`) the MARK of `noteId` at an explicit cell
   * location. Works at any depth and preserves the note's text, children
   * and position. Headless equivalent of the `note:mark` handler.
   */
  public async markAtSegments(
    parentSegments: readonly string[],
    cellLabel: string,
    noteId: string,
    mark: string | null,
  ): Promise<void> {
    const cleanedParents = (parentSegments ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const cleanedLabel = String(cellLabel ?? '').trim()
    const cleanedSig = String(noteId ?? '').trim()
    if (!cleanedLabel || !cleanedSig) return
    await this.#markNoteAtSegments([...cleanedParents, cleanedLabel], cleanedSig, normalizeMark(mark))
  }

  /**
   * Put a pheromone on (or take it off) `noteId` at an explicit cell
   * location. Works at any depth and preserves the note's text, mark,
   * children and position. Headless equivalent of the `note:tag` handler.
   */
  public async tagAtSegments(
    parentSegments: readonly string[],
    cellLabel: string,
    noteId: string,
    tag: string,
    add = true,
  ): Promise<void> {
    const cleanedParents = (parentSegments ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const cleanedLabel = String(cellLabel ?? '').trim()
    const cleanedSig = String(noteId ?? '').trim()
    if (!cleanedLabel || !cleanedSig || !isNoteTag(tag)) return
    await this.#tagNoteAtSegments(
      [...cleanedParents, cleanedLabel],
      cleanedSig,
      String(tag).trim(),
      add,
    )
  }

  /**
   * Append ONE new sub-note under `parentId` at an explicit cell location.
   * Headless equivalent of the `note:add-child` handler — the write a list
   * makes for every line it grows by.
   */
  public async addChildAtSegments(
    parentSegments: readonly string[],
    cellLabel: string,
    parentId: string,
    text: string,
    mark: string | null = null,
  ): Promise<void> {
    const cleanedParents = (parentSegments ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const cleanedLabel = String(cellLabel ?? '').trim()
    const cleanedParent = String(parentId ?? '').trim()
    const cleanedText = String(text ?? '').trim()
    if (!cleanedLabel || !cleanedParent || !cleanedText) return
    await this.#addChildAtSegments(
      [...cleanedParents, cleanedLabel],
      cleanedParent,
      cleanedText,
      normalizeMark(mark),
    )
  }

  /**
   * Replace the TEXT of `noteId` at an explicit cell location, at any
   * depth, keeping its children, position, pheromones and (unless `mark`
   * is passed) its mark. Headless equivalent of the `note:retext` handler.
   */
  public async retextAtSegments(
    parentSegments: readonly string[],
    cellLabel: string,
    noteId: string,
    text: string,
    mark?: string | null,
  ): Promise<void> {
    const cleanedParents = (parentSegments ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const cleanedLabel = String(cellLabel ?? '').trim()
    const cleanedSig = String(noteId ?? '').trim()
    const cleanedText = String(text ?? '').trim()
    if (!cleanedLabel || !cleanedSig || !cleanedText) return
    await this.#retextAtSegments(
      [...cleanedParents, cleanedLabel],
      cleanedSig,
      cleanedText,
      mark === undefined ? undefined : normalizeMark(mark),
    )
  }

  /**
   * Break `noteId` into a one-line head plus one sub-note per part, at an
   * explicit cell location. Headless equivalent of the `note:split`
   * EffectBus handler, and the call a bulk breakdown pass makes.
   *
   * The note is replaced IN PLACE: it keeps its slot position, its mark,
   * its legacy shape, and every child it already had (the parts land
   * ahead of them). One awaited cascade, so a split is ONE layer in
   * history no matter how many parts it produced.
   *
   * No-op when the note isn't in this cell, when `head` is blank, or
   * when no part survives trimming — see `splitInTree` for why each of
   * those refuses rather than guesses.
   */
  public async splitAtSegments(
    parentSegments: readonly string[],
    cellLabel: string,
    noteId: string,
    head: string,
    parts: readonly (string | NotePart)[],
  ): Promise<void> {
    const cleanedParents = (parentSegments ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const cleanedLabel = String(cellLabel ?? '').trim()
    const cleanedSig = String(noteId ?? '').trim()
    if (!cleanedLabel || !cleanedSig) return
    await this.#splitNoteAtSegments([...cleanedParents, cleanedLabel], cleanedSig, head, parts)
  }

  // ── Internal: commit + delete + tree-move flows ──────────────────

  async #commit(cellLabel: string, text: string, shape: ShapeId | null, mark: string | null, editId?: string): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) {
      console.warn('[notes] cannot resolve cell location for', cellLabel)
      return
    }
    const { segments } = resolved
    // An edit REPLACES the note's bytes, so anything the old bytes carried
    // has to be carried over explicitly or it is dropped. Pheromones travel:
    // the participant put them on this note, and re-typing its text is not a
    // request to strip them. (Children still don't survive an edit — this
    // path writes a childless layer into the TOP-LEVEL slot, which is the
    // same limitation `note:mark` and `note:split` were built to route
    // around, and is unchanged here.)
    const priorTags = editId && SIG_REGEX.test(editId)
      ? normalizeTags((await this.#loadNoteLayer(editId))?.tags)
      : []
    const newSig = await this.#writeNoteLayer(text, shape, mark, [], priorTags)
    if (editId && SIG_REGEX.test(editId)) {
      await this.#commitCellNotes(segments, (prior) => prior.map(s => s === editId ? newSig : s))
    } else {
      await this.#commitCellNotes(segments, (prior) => [...prior, newSig])
    }
  }

  async #deleteByCellLabel(cellLabel: string, noteId: string): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) return
    await this.#deleteFromTree(resolved.segments, noteId)
  }

  /**
   * Delete `noteId` from the cell's tree — top-level OR any nested
   * position. Cascade-deletes its subtree (children go with the parent).
   * Reads the current tree, walks once to drop the node, re-materializes
   * the surviving nodes from leaves up, then commits the cell layer.
   * No-op when the node isn't found.
   */
  async #deleteFromTree(segments: readonly string[], noteId: string): Promise<void> {
    const locSig = await this.#locSig(segments)
    const tree = await this.#readAtLocation(locSig)
    const { tree: nextTree, removed } = removeFromTree(tree, noteId)
    if (!removed) return  // node wasn't in this cell — leave layer alone
    const rootSigs: string[] = []
    for (const node of nextTree) {
      rootSigs.push(await this.#materializeNote(node))
    }
    await this.#commitCellNotes(segments, () => rootSigs)
  }

  /**
   * Move `sourceId` into `targetParentId`'s children (or to the cell's
   * top level when `targetParentId` is null). The full tree is read,
   * the source node + its subtree relocated, then everything is
   * re-materialized from leaves up. Content-addressed storage dedups
   * unchanged subtrees so only branches touched by the move yield new
   * sigs.
   *
   * Cycle prevention: if `targetParentId` lives inside `sourceId`'s
   * own subtree, the move is rejected (would create a cycle).
   */
  async #moveNote(
    cellLabel: string,
    sourceId: string,
    targetParentId: string | null,
    index?: number,
  ): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) return
    await this.#moveNoteAtSegments(resolved.segments, sourceId, targetParentId, index)
  }

  async #moveNoteAtSegments(
    segments: readonly string[],
    sourceId: string,
    targetParentId: string | null,
    index?: number,
  ): Promise<void> {
    const locSig = await this.#locSig(segments)
    const tree = await this.#readAtLocation(locSig)

    // 1. Locate the source node and pluck it (with its subtree) out
    //    of wherever it currently lives.
    const { tree: withoutSource, removed: source } = removeFromTree(tree, sourceId)
    if (!source) return  // source wasn't in this cell's tree

    // 2. Cycle check: target must not be inside source's subtree.
    if (targetParentId && subtreeContains(source, targetParentId)) {
      console.warn('[notes] refused nest — would create a cycle', { sourceId, targetParentId })
      return
    }

    // 3. Place the source back into the tree at its new home. Without an
    //    index the node APPENDS (nest / un-nest, unchanged); with one it
    //    lands at that position among its new siblings.
    let nextTree: readonly Note[]
    if (index === undefined && targetParentId === null) {
      // Un-nest: append to top level.
      nextTree = [...withoutSource, source]
    } else if (index === undefined) {
      const placed = insertAsChild(withoutSource, targetParentId!, source)
      if (!placed.placed) {
        console.warn('[notes] refused nest — target parent not found', { targetParentId })
        return
      }
      nextTree = placed.tree
    } else {
      const placed = insertAtIndex(withoutSource, targetParentId, source, index)
      if (!placed.placed) {
        console.warn('[notes] refused move — target parent not found', { targetParentId })
        return
      }
      nextTree = placed.tree
    }

    // 4. Re-materialize the surviving tree from leaves up. The Store
    //    dedups by content sig, so unchanged subtrees produce identical
    //    sigs and don't write new bytes.
    const rootSigs: string[] = []
    for (const node of nextTree) {
      rootSigs.push(await this.#materializeNote(node))
    }
    await this.#commitCellNotes(segments, () => rootSigs)
  }

  async #addChild(cellLabel: string, parentId: string, text: string, mark: string | null): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) return
    await this.#addChildAtSegments(resolved.segments, parentId, text, mark)
  }

  /**
   * Grow one node's children by one. Same shape as every other tree flow:
   * read, transform purely, re-materialize from leaves up so untouched
   * subtrees dedup back to their existing sigs, commit once — so a list
   * grown a line at a time reads as one entry per line in history.
   */
  async #addChildAtSegments(
    segments: readonly string[],
    parentId: string,
    text: string,
    mark: string | null,
  ): Promise<void> {
    const locSig = await this.#locSig(segments)
    const tree = await this.#readAtLocation(locSig)
    const { tree: nextTree, changed } = addChildInTree(tree, parentId, text, mark)
    if (!changed) return  // parent isn't in this cell
    const rootSigs: string[] = []
    for (const node of nextTree) {
      rootSigs.push(await this.#materializeNote(node))
    }
    await this.#commitCellNotes(segments, () => rootSigs)
  }

  async #retext(
    cellLabel: string,
    noteId: string,
    text: string,
    mark: string | null | undefined,
  ): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) return
    await this.#retextAtSegments(resolved.segments, noteId, text, mark)
  }

  /**
   * Retext one node of the cell's tree. Text (and optionally the mark) is
   * all that changes: children, position, pheromones and legacy shape
   * travel — the guarantee `#markNoteAtSegments` gives, and the reason the
   * `note:commit` edit path can't serve a nested note.
   */
  async #retextAtSegments(
    segments: readonly string[],
    noteId: string,
    text: string,
    mark: string | null | undefined,
  ): Promise<void> {
    const locSig = await this.#locSig(segments)
    const tree = await this.#readAtLocation(locSig)
    const { tree: nextTree, changed } = setTextInTree(tree, noteId, text, mark)
    if (!changed) return  // node not in this cell, or already reads exactly that
    const rootSigs: string[] = []
    for (const node of nextTree) {
      rootSigs.push(await this.#materializeNote(node))
    }
    await this.#commitCellNotes(segments, () => rootSigs)
  }

  async #markNote(cellLabel: string, noteId: string, mark: string | null): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) return
    await this.#markNoteAtSegments(resolved.segments, noteId, mark)
  }

  /**
   * Re-mark one node in the cell's tree. Everything else about the note —
   * text, legacy shape, children, position — travels unchanged, and the
   * re-materialization dedups every untouched subtree back to its existing
   * sig, so only the marked node's branch mints new bytes.
   */
  async #markNoteAtSegments(
    segments: readonly string[],
    noteId: string,
    mark: string | null,
  ): Promise<void> {
    const locSig = await this.#locSig(segments)
    const tree = await this.#readAtLocation(locSig)
    const { tree: nextTree, changed } = setMarkInTree(tree, noteId, mark)
    if (!changed) return  // node not in this cell, or already carries that mark
    const rootSigs: string[] = []
    for (const node of nextTree) {
      rootSigs.push(await this.#materializeNote(node))
    }
    await this.#commitCellNotes(segments, () => rootSigs)
  }

  async #tagNote(cellLabel: string, noteId: string, tag: string, add: boolean): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) return
    await this.#tagNoteAtSegments(resolved.segments, noteId, tag, add)
  }

  /**
   * Put one pheromone on (or take it off) a single node in the cell's tree.
   * Text, mark, legacy shape, children and position all travel unchanged —
   * the same guarantee `#markNoteAtSegments` gives, and for the same reason:
   * a tagged parent must keep its subtree.
   */
  async #tagNoteAtSegments(
    segments: readonly string[],
    noteId: string,
    tag: string,
    add: boolean,
  ): Promise<void> {
    const locSig = await this.#locSig(segments)
    const tree = await this.#readAtLocation(locSig)
    const { tree: nextTree, changed } = setTagInTree(tree, noteId, tag, add)
    if (!changed) return  // node not in this cell, or already in that state
    const rootSigs: string[] = []
    for (const node of nextTree) {
      rootSigs.push(await this.#materializeNote(node))
    }
    await this.#commitCellNotes(segments, () => rootSigs)
  }

  async #splitNote(
    cellLabel: string,
    noteId: string,
    head: string,
    parts: readonly (string | NotePart)[],
  ): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) return
    await this.#splitNoteAtSegments(resolved.segments, noteId, head, parts)
  }

  /**
   * Split one node of the cell's tree. Same shape as `#markNoteAtSegments`:
   * read the tree, transform it purely, re-materialize from leaves up so
   * every untouched subtree dedups back to its existing sig, commit once.
   * Only the split node's branch mints new bytes.
   */
  async #splitNoteAtSegments(
    segments: readonly string[],
    noteId: string,
    head: string,
    parts: readonly (string | NotePart)[],
  ): Promise<void> {
    const locSig = await this.#locSig(segments)
    const tree = await this.#readAtLocation(locSig)
    const { tree: nextTree, changed } = splitInTree(tree, noteId, head, parts)
    if (!changed) return  // node not in this cell, blank head, or no usable parts
    const rootSigs: string[] = []
    for (const node of nextTree) {
      rootSigs.push(await this.#materializeNote(node))
    }
    await this.#commitCellNotes(segments, () => rootSigs)
  }

  /**
   * Recursively write `note` and every descendant as a content-addressed
   * resource. Returns the sig of the freshly-written (or dedup-matched)
   * resource for this node. Walks bottom-up so children are sigged
   * before their parent's `children` array gets materialized.
   */
  async #materializeNote(note: Note): Promise<string> {
    const childSigs: string[] = []
    for (const child of note.children) {
      childSigs.push(await this.#materializeNote(child))
    }
    return await this.#writeNoteLayer(note.text, note.shape, note.mark, childSigs, note.tags)
  }

  /** Resolve a segments array to its locationSig. Used by tree-mutating
   *  flows that need direct access (not the segments path). */
  async #locSig(segments: readonly string[]): Promise<string> {
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history) throw new Error('[notes] HistoryService missing on ioc')
    return await history.sign({ explorerSegments: () => [...segments] })
  }

  /**
   * Read the cell's current `notes` slot, apply a transform to get the
   * next list, and commit the entire cell layer with the new list via
   * LayerCommitter. Awaits the cascade so the cell layer + every
   * ancestor up to root is at its new sig by the time we resolve.
   * Emits `notes:changed` once the cascade has settled so UI consumers
   * read fresh state.
   */
  async #commitCellNotes(
    segments: readonly string[],
    transform: (priorSigs: readonly string[]) => readonly string[],
  ): Promise<void> {
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    const committer = get<LayerCommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    if (!history || !committer) {
      throw new Error('[notes] HistoryService / LayerCommitter missing on ioc')
    }
    const locSig = await history.sign({ explorerSegments: () => segments })
    const priorLayer = await history.currentLayerAt(locSig)
    const priorNotes = Array.isArray(priorLayer?.[NOTES_SLOT])
      ? (priorLayer[NOTES_SLOT] as readonly unknown[]).filter((s): s is string => typeof s === 'string')
      : []
    const nextNotes = transform(priorNotes)
    const base: { name?: string; [k: string]: unknown } = priorLayer
      ? { ...priorLayer }
      : { name: segments[segments.length - 1] ?? '' }
    base[NOTES_SLOT] = nextNotes.slice()
    // `nameSlots: new Set()` is critical. The default `new Set(['children'])`
    // is for callers passing children as NAMES (e.g. the `#add` path which
    // emits `cell:added` events that the committer translates to a name
    // delta). Here, `priorLayer.children` are already SIGS read from the
    // current head — feeding them through name→sig resolution treats each
    // sig as a phantom cell name, mints empty markers at fake lineages,
    // and replaces every child with the phantom-bag sig. The render then
    // shows the original sigs as tile labels (because the phantom layer's
    // `name` is the sig string). Passing an empty nameSlots set leaves
    // every value verbatim.
    await committer.update(segments, base, new Set())
    EffectBus.emit(NOTES_TRIGGER, {
      segments: [...segments],
      op: 'set' as const,
      sigs: nextNotes.slice(),
    })
    // THE FACET, ALONGSIDE (decided 2026-09-04). The same list lands on the
    // tile's word — sign('notes:' + moleculeAddress(name)) — as envelopes, a
    // succession atom and a signed head in this author's bucket. A forward
    // commit beside the slot above, never a gate on it, and never an identity
    // minted for a note: without a cached key it simply does not happen.
    void writeNotesFacet(segments[segments.length - 1] ?? '', nextNotes).then(r => {
      if (!r.ok && r.reason !== 'no identity') console.warn('[notes] facet not written:', r.reason, r.detail ?? '')
    })
  }

  // ── Internal: note layer write ────────────────────────────────────

  async #writeNoteLayer(
    text: string,
    shape: ShapeId | null,
    mark: string | null,
    children: readonly string[],
    tags: readonly string[] = [],
  ): Promise<string> {
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store) throw new Error('[notes] Store missing on ioc')
    const clean = normalizeTags(tags)
    // `tags` is spread in ONLY when non-empty — see the NoteLayer comment in
    // note-tree.ts. An untagged note must sign to the same bytes it always
    // did, or every re-materialization would re-sign the whole tree.
    const layer: NoteLayer = clean.length
      ? { children: children.slice(), mark, note: text, shape, tags: clean }
      : { children: children.slice(), mark, note: text, shape }
    const json = canonicalJSON(layer)
    const sig = await store.putResource(new Blob([json], { type: 'application/json' }))
    this.#cache.set(sig, layer)
    return sig
  }

  // ── Internal: read paths ──────────────────────────────────────────

  /**
   * Async-hydrating tree read. Top-level sigs are loaded first, then
   * each note is recursively walked via `#hydrateAsync` so every
   * descendant is loaded from storage and parked in `#cache`. After
   * this resolves, the sync `notesFor` path sees the full tree because
   * every node's bytes are now in the cache.
   *
   * Before this consolidation there was a separate sync-hydrate path
   * that dropped uncached descendants on initial reads — so the
   * strip's chevron could disappear after a refresh even when the
   * parent layer's `children` array carried valid sigs. Tree-mutating
   * flows (move, cascade-delete) also use this method so the source's
   * full subtree travels with the operation.
   */
  async #readAtLocation(locationSig: string): Promise<Note[]> {
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return []
    const layer = await history.currentLayerAt(locationSig)
    if (!layer) return []
    const sigs = (layer as Record<string, unknown>)[NOTES_SLOT]
    if (!Array.isArray(sigs)) return []
    const out: Note[] = []
    for (const sig of sigs) {
      if (typeof sig !== 'string' || !SIG_REGEX.test(sig)) continue
      const node = await this.#hydrateAsync(sig)
      if (node) out.push(node)
    }
    return out
  }

  /** Async, recursive hydrate — resolves every descendant from storage.
   *  Returns null when a sig fails to load (corrupt / missing); the
   *  callers' tree walks treat null as "skip this branch". */
  async #hydrateAsync(sig: string): Promise<Note | null> {
    const layer = await this.#loadNoteLayer(sig)
    if (!layer) return null
    const children: Note[] = []
    for (const childSig of layer.children) {
      const child = await this.#hydrateAsync(childSig)
      if (child) children.push(child)
    }
    return {
      id: sig,
      text: layer.note,
      shape: layer.shape,
      mark: layer.mark,
      tags: normalizeTags(layer.tags),
      children,
    }
  }

  async #loadNoteLayer(sig: string): Promise<NoteLayer | null> {
    const cached = this.#cache.get(sig)
    if (cached) return cached
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store) return null

    // New shape: the sig points at a content-addressed resource holding
    // canonical JSON `{ note, shape, children }`. Try the resource path first.
    // Legacy resources without `shape`/`mark` parse as null for both.
    const parsed = await store.resolve<unknown>(sig)
    if (parsed && typeof parsed === 'object') {
      const p = parsed as { note?: unknown; shape?: unknown; mark?: unknown; children?: unknown; tags?: unknown }
      if (typeof p.note === 'string') {
        const children = Array.isArray(p.children)
          ? p.children.filter((c): c is string => typeof c === 'string' && SIG_REGEX.test(c))
          : []
        // Keep the slot ABSENT when the note carries no pheromones, so the
        // cached layer round-trips to the same bytes it was read from.
        const tags = normalizeTags(p.tags)
        const layer: NoteLayer = tags.length
          ? { children, mark: normalizeMark(p.mark), note: p.note, shape: normalizeShape(p.shape), tags }
          : { children, mark: normalizeMark(p.mark), note: p.note, shape: normalizeShape(p.shape) }
        this.#cache.set(sig, layer)
        return layer
      }
    }

    // Back-compat shim: legacy notes were stored as HiveParticipant
    // layers in history bags with shape `{ name: noteId, body: [bodySig] }`,
    // where the body resource held `{ id, text, createdAt, tags }`.
    // Read it through HistoryService, extract the text, and surface as
    // the new shape (empty children — legacy notes were flat). Writes
    // never produce the legacy shape; this is read-only compatibility.
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null
    const legacy = await history.getLayerBySig(sig)
    const body = legacy && Array.isArray(legacy['body']) ? legacy['body'] : null
    const bodySig = body && body.length === 1 && typeof body[0] === 'string' ? body[0] : null
    if (!bodySig) return null
    const bodyParsed = await store.resolve<unknown>(bodySig)
    if (!bodyParsed || typeof bodyParsed !== 'object') return null
    const text = (bodyParsed as { text?: unknown }).text
    if (typeof text !== 'string') return null
    const layer: NoteLayer = { children: [], mark: null, note: text, shape: null }
    this.#cache.set(sig, layer)
    return layer
  }

  #hydrate(sig: string, layer: NoteLayer): Note {
    // Children are resolved sync from cache only — async children
    // populate on subsequent reads after warmup walks them. This keeps
    // the sync notesFor() truly synchronous for the rendered surface.
    const children: Note[] = []
    for (const childSig of layer.children) {
      const cached = this.#cache.get(childSig)
      if (cached) children.push(this.#hydrate(childSig, cached))
    }
    return {
      id: sig,
      text: layer.note,
      shape: layer.shape,
      mark: layer.mark,
      tags: normalizeTags(layer.tags),
      children,
    }
  }

  // ── Internal: cell-location resolution ────────────────────────────

  async #resolveCellLocation(cellLabel: string): Promise<{ locationSig: string; segments: string[] } | null> {
    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    const history = get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history) return null

    const parentSegments = (lineage.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const segments = [...parentSegments, String(cellLabel ?? '').trim()].filter(Boolean)
    if (segments.length === 0) return null

    const cacheKey = segments.join('/')
    const cached = this.#cellLocSigCache.get(cacheKey)
    if (cached) return { locationSig: cached, segments }

    const locationSig = await history.sign({ explorerSegments: () => segments })
    this.#cellLocSigCache.set(cacheKey, locationSig)
    return { locationSig, segments }
  }

  #cellLocationSigSync(cellLabel: string): string {
    const lineage = get<Lineage>('@hypercomb.social/Lineage')
    if (!lineage) return ''
    const parentSegments = (lineage.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const segments = [...parentSegments, String(cellLabel ?? '').trim()].filter(Boolean)
    if (segments.length === 0) return ''
    return this.#cellLocSigCache.get(segments.join('/')) ?? ''
  }

  // ── Internal: legacy cleanup ──────────────────────────────────────

  #purgeLegacyKey(key: string): void {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key) !== null) {
      localStorage.removeItem(key)
    }
  }
}

function canonicalJSON(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k]
      return sorted
    }
    return v
  })
}

const _notesService = new NotesService()
window.ioc.register('@diamondcoreprocessor.com/NotesService', _notesService)
