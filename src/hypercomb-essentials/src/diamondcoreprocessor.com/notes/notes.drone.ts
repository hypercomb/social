// diamondcoreprocessor.com/notes/notes.drone.ts
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
// Storage: note blobs live in `__resources__/<sig>` alongside other
// content-addressed resources. No per-note history bag — the note is
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

const NOTE_ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="white"><path d="M19 3H4.99c-1.11 0-1.98.9-1.98 2L3 19c0 1.1.89 2 2 2h10l6-6V5c0-1.1-.9-2-2-2zM7 8h10v2H7V8zm5 6H7v-2h5v2zm2 5.5V14h5.5L14 19.5z"/></svg>`

const NOTE_ACCENT = 0xffe14a
const NOTES_TRIGGER = 'notes:changed'
const NOTES_SLOT = 'notes'
const CAPTURE_MODE = 'note-capture' as const

const SIG_REGEX = /^[a-f0-9]{64}$/

type IconProvider = {
  name: string
  owner?: string
  svgMarkup: string
  profile: string
  hoverTint?: number
  tintWhen?: (ctx: { hasNotes?: boolean }) => number | null | undefined
  labelKey?: string
  descriptionKey?: string
}

type IconProviderRegistry = {
  add(p: IconProvider): void
  remove(name: string): void
}

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

/** Allowed shape tag values. Used as a presentation hint by the strip
 *  and viewer; null means "no tag, render as plain text only".
 *  Names are deliberately concrete (no `kind` / `category`) — they map
 *  1:1 to the CSS-drawn shape classes that paint the glyph. */
export type ShapeId = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon'

const SHAPE_IDS: ReadonlySet<string> = new Set<string>([
  'circle', 'square', 'triangle', 'diamond', 'star', 'hexagon',
])

function normalizeShape(value: unknown): ShapeId | null {
  return typeof value === 'string' && SHAPE_IDS.has(value) ? (value as ShapeId) : null
}

/** Storage shape on disk — the canonical JSON every note blob holds. */
type NoteLayer = {
  note: string
  shape: ShapeId | null
  children: string[]
}

/**
 * Consumer-facing note shape (notes-strip, notes-viewer, etc).
 *
 * `id` is the note's layer signature — stable for the lifetime of those
 * exact bytes. Edit the text → new layer → new sig → consumers will see
 * a different `id` for the edited version. There is no separate
 * "identity across edits" concept; each version is its own entity.
 */
export type Note = {
  id: string
  text: string
  shape: ShapeId | null
  children: Note[]
}

/**
 * NotesService — content-addressed notes attached to cells.
 *
 * Cells carry top-level notes in their `notes` slot (sigs pointing at
 * note blobs in `__resources__/`). Notes carry sub-notes in their own
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

    // Tile icon. Toggle this drone off in DCP → constructor never runs
    // → icon never reaches the arranger → never appears on the hex.
    const iconRegistry = get<IconProviderRegistry>('@hypercomb.social/IconProviderRegistry')
    iconRegistry?.add({
      name: 'note',
      owner: '@diamondcoreprocessor.com/NotesService',
      svgMarkup: NOTE_ICON_SVG,
      profile: 'private',
      hoverTint: NOTE_ACCENT,
      tintWhen: (ctx) => ctx.hasNotes ? NOTE_ACCENT : null,
      labelKey: 'action.note',
      descriptionKey: 'action.note.description',
    })

    // ── EffectBus wiring ──────────────────────────────────────────────

    EffectBus.on<{ cellLabel: string; prefill?: string; editId?: string; shape?: unknown }>('note:capture', (payload) => {
      if (!payload?.cellLabel) return
      EffectBus.emit('command:enter-mode', {
        mode: CAPTURE_MODE,
        target: payload.cellLabel,
        prefill: payload.prefill ?? '',
        editId: payload.editId ?? '',
        shape: normalizeShape(payload.shape),
      })
    })

    // The strip emits this whenever the user picks / clears a shape
    // in the toolbar, OR when capture mode opens (so we get the
    // pre-filled shape for an in-flight edit). Last-value wins.
    EffectBus.on<{ shape?: unknown }>('notes:active-shape', (payload) => {
      this.#activeShape = normalizeShape(payload?.shape)
    })

    EffectBus.on<{ cellLabel: string; text: string; shape?: unknown; editId?: string }>('note:commit', (payload) => {
      const text = (payload?.text ?? '').trim()
      if (!payload?.cellLabel || !text) return
      // Prefer an explicit shape on the payload (rare — most paths route
      // the choice through `notes:active-shape`). Fall back to the
      // cached active shape staged by the strip.
      const payloadShape = normalizeShape(payload.shape)
      const shape = payloadShape ?? this.#activeShape
      void this.#commit(payload.cellLabel, text, shape, payload.editId)
    })

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
  ): Promise<void> {
    const cleanedParents = (parentSegments ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const cleanedLabel = String(cellLabel ?? '').trim()
    const cleanedText = String(text ?? '').trim()
    if (!cleanedLabel || !cleanedText) return
    const segments = [...cleanedParents, cleanedLabel]
    const sig = await this.#writeNoteLayer(cleanedText, normalizeShape(shape), [])
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

  // ── Internal: commit + delete + tree-move flows ──────────────────

  async #commit(cellLabel: string, text: string, shape: ShapeId | null, editId?: string): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) {
      console.warn('[notes] cannot resolve cell location for', cellLabel)
      return
    }
    const { segments } = resolved
    const newSig = await this.#writeNoteLayer(text, shape, [])
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
  async #moveNote(cellLabel: string, sourceId: string, targetParentId: string | null): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) return
    await this.#moveNoteAtSegments(resolved.segments, sourceId, targetParentId)
  }

  async #moveNoteAtSegments(
    segments: readonly string[],
    sourceId: string,
    targetParentId: string | null,
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

    // 3. Place the source back into the tree at its new home.
    let nextTree: readonly Note[]
    if (targetParentId === null) {
      // Un-nest: append to top level.
      nextTree = [...withoutSource, source]
    } else {
      const placed = insertAsChild(withoutSource, targetParentId, source)
      if (!placed.placed) {
        console.warn('[notes] refused nest — target parent not found', { targetParentId })
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
    return await this.#writeNoteLayer(note.text, note.shape, childSigs)
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
    await committer.update(segments, base, new Set(['children']))
    EffectBus.emit(NOTES_TRIGGER, {
      segments: [...segments],
      op: 'set' as const,
      sigs: nextNotes.slice(),
    })
  }

  // ── Internal: note layer write ────────────────────────────────────

  async #writeNoteLayer(text: string, shape: ShapeId | null, children: readonly string[]): Promise<string> {
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store) throw new Error('[notes] Store missing on ioc')
    const layer: NoteLayer = { children: children.slice(), note: text, shape }
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
    return { id: sig, text: layer.note, shape: layer.shape, children }
  }

  async #loadNoteLayer(sig: string): Promise<NoteLayer | null> {
    const cached = this.#cache.get(sig)
    if (cached) return cached
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store) return null

    // New shape: the sig points at a content-addressed resource holding
    // canonical JSON `{ note, shape, children }`. Try the resource path first.
    // Legacy resources without `shape` parse with shape: null.
    const parsed = await store.resolve<unknown>(sig)
    if (parsed && typeof parsed === 'object') {
      const p = parsed as { note?: unknown; shape?: unknown; children?: unknown }
      if (typeof p.note === 'string') {
        const children = Array.isArray(p.children)
          ? p.children.filter((c): c is string => typeof c === 'string' && SIG_REGEX.test(c))
          : []
        const layer: NoteLayer = { children, note: p.note, shape: normalizeShape(p.shape) }
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
    const layer: NoteLayer = { children: [], note: text, shape: null }
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
    return { id: sig, text: layer.note, shape: layer.shape, children }
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

/**
 * Walk `tree` and return a new tree without the first occurrence of
 * `noteId`, alongside the removed node (if any). Operates immutably —
 * input arrays / objects are untouched. Used by tree-mutating flows
 * that re-materialize the modified tree afterwards.
 */
function removeFromTree(
  tree: readonly Note[],
  noteId: string,
): { tree: readonly Note[]; removed: Note | null } {
  let removed: Note | null = null
  const walk = (nodes: readonly Note[]): readonly Note[] => {
    const next: Note[] = []
    for (const n of nodes) {
      if (removed) {
        // Already found the target this walk; just copy the rest.
        next.push(n)
        continue
      }
      if (n.id === noteId) {
        removed = n
        continue  // drop this node
      }
      const newChildren = walk(n.children)
      if (newChildren !== n.children) {
        next.push({ ...n, children: newChildren as Note[] })
      } else {
        next.push(n)
      }
    }
    return next
  }
  const nextTree = walk(tree)
  return { tree: nextTree, removed }
}

/**
 * Insert `node` as the last child of the first occurrence of
 * `targetParentId` in `tree`. Returns the new tree and a flag
 * indicating whether the parent was found. Immutable — input arrays /
 * objects untouched.
 */
function insertAsChild(
  tree: readonly Note[],
  targetParentId: string,
  node: Note,
): { tree: readonly Note[]; placed: boolean } {
  let placed = false
  const walk = (nodes: readonly Note[]): readonly Note[] => {
    const next: Note[] = []
    for (const n of nodes) {
      if (placed) {
        next.push(n)
        continue
      }
      if (n.id === targetParentId) {
        placed = true
        next.push({ ...n, children: [...n.children, node] })
        continue
      }
      const newChildren = walk(n.children)
      if (newChildren !== n.children) {
        next.push({ ...n, children: newChildren as Note[] })
      } else {
        next.push(n)
      }
    }
    return next
  }
  const nextTree = walk(tree)
  return { tree: nextTree, placed }
}

/**
 * Whether `node` or any of its descendants has id `targetId`. Used to
 * reject nest operations that would create a cycle (moving a parent
 * underneath one of its own descendants).
 */
function subtreeContains(node: Note, targetId: string): boolean {
  if (node.id === targetId) return true
  for (const child of node.children) {
    if (subtreeContains(child, targetId)) return true
  }
  return false
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
