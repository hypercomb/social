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

/** Storage shape on disk — the canonical JSON every note blob holds. */
type NoteLayer = {
  note: string
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

    EffectBus.on<{ cellLabel: string; prefill?: string; editId?: string }>('note:capture', (payload) => {
      if (!payload?.cellLabel) return
      EffectBus.emit('command:enter-mode', {
        mode: CAPTURE_MODE,
        target: payload.cellLabel,
        prefill: payload.prefill ?? '',
        editId: payload.editId ?? '',
      })
    })

    EffectBus.on<{ cellLabel: string; text: string; editId?: string }>('note:commit', (payload) => {
      const text = (payload?.text ?? '').trim()
      if (!payload?.cellLabel || !text) return
      void this.#commit(payload.cellLabel, text, payload.editId)
    })

    EffectBus.on<{ cellLabel: string; noteId: string }>('note:delete', (payload) => {
      if (!payload?.cellLabel || !payload?.noteId) return
      void this.#deleteByCellLabel(payload.cellLabel, payload.noteId)
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
  ): Promise<void> {
    const cleanedParents = (parentSegments ?? [])
      .map(s => String(s ?? '').trim())
      .filter(Boolean)
    const cleanedLabel = String(cellLabel ?? '').trim()
    const cleanedText = String(text ?? '').trim()
    if (!cleanedLabel || !cleanedText) return
    const segments = [...cleanedParents, cleanedLabel]
    const sig = await this.#writeNoteLayer(cleanedText, [])
    await this.#commitCellNotes(segments, (prior) => [...prior, sig])
  }

  /**
   * Remove a top-level note by its layer sig at an explicit cell
   * location. Headless equivalent of the `note:delete` EffectBus
   * handler.
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
    await this.#commitCellNotes(segments, (prior) => prior.filter(s => s !== cleanedSig))
  }

  // ── Internal: commit + delete flows ───────────────────────────────

  async #commit(cellLabel: string, text: string, editId?: string): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) {
      console.warn('[notes] cannot resolve cell location for', cellLabel)
      return
    }
    const { segments } = resolved
    const newSig = await this.#writeNoteLayer(text, [])
    if (editId && SIG_REGEX.test(editId)) {
      await this.#commitCellNotes(segments, (prior) => prior.map(s => s === editId ? newSig : s))
    } else {
      await this.#commitCellNotes(segments, (prior) => [...prior, newSig])
    }
  }

  async #deleteByCellLabel(cellLabel: string, noteId: string): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) return
    await this.#commitCellNotes(resolved.segments, (prior) => prior.filter(s => s !== noteId))
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
  }

  // ── Internal: note layer write ────────────────────────────────────

  async #writeNoteLayer(text: string, children: readonly string[]): Promise<string> {
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store) throw new Error('[notes] Store missing on ioc')
    const layer: NoteLayer = { children: children.slice(), note: text }
    const json = canonicalJSON(layer)
    const sig = await store.putResource(new Blob([json], { type: 'application/json' }))
    this.#cache.set(sig, layer)
    return sig
  }

  // ── Internal: read paths ──────────────────────────────────────────

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
      const decoded = await this.#loadNoteLayer(sig)
      if (decoded) out.push(this.#hydrate(sig, decoded))
    }
    return out
  }

  async #loadNoteLayer(sig: string): Promise<NoteLayer | null> {
    const cached = this.#cache.get(sig)
    if (cached) return cached
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store) return null

    // New shape: the sig points at a content-addressed resource holding
    // canonical JSON `{ note, children }`. Try the resource path first.
    const parsed = await store.resolve<unknown>(sig)
    if (parsed && typeof parsed === 'object') {
      const p = parsed as { note?: unknown; children?: unknown }
      if (typeof p.note === 'string') {
        const children = Array.isArray(p.children)
          ? p.children.filter((c): c is string => typeof c === 'string' && SIG_REGEX.test(c))
          : []
        const layer: NoteLayer = { children, note: p.note }
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
    const layer: NoteLayer = { children: [], note: text }
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
    return { id: sig, text: layer.note, children }
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
