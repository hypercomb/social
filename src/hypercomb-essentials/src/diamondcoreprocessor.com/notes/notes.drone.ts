// diamondcoreprocessor.com/notes/notes.drone.ts
//
// Notes on tiles. Each tile's notes are stored as a single signature-
// addressed resource containing the full array; replacing the set
// writes a new resource and emits `notes:changed` with the cell's
// FULL segments so the cascade triggers at the right place.
//
// ── Where notes live in the layer hierarchy ─────────────────────────
//
// Notes belong to the LAYER OF THE CLICKED CELL — i.e. the layer at
// `sign({ explorerSegments: parentSegments + [cellLabel] })` — not to
// the parent's `notesByCell` map. Reasoning: the cell IS a layer (cells
// and layers are the same merkle primitive at different zoom levels),
// and the notes are data ABOUT that cell, not data about its parent's
// view of it. Putting notes on the parent would mean the parent's
// signature owns all its children's note state — wrong invariant, and
// it bloats the parent's layer with metadata for every child.
//
// With notes on the child layer:
//   - cell's own layer carries `notes: '<noteSetSig>'` (a single field)
//   - parent's `children` array references the child's now-updated sig
//   - merkle cascade walks up automatically via LayerCommitter's
//     existing fallback path (re-snapshot every ancestor)
//   - notes for cell X at /a are unique from notes for cell X at /b
//     because the locationSig differs — no cross-lineage contamination
//
// ── Integration with history is mechanical via LayerSlotRegistry ────
//
//   - This file registers a `notes` slot with trigger `notes:changed`
//     (see bottom of file).
//   - LayerCommitter auto-subscribes the trigger and folds the slot's
//     `read(locationSig, segments)` result into every layer it commits.
//   - At the cell's location, `read` returns the noteSetSig stored
//     under that locationSig (or undefined → slot omitted from layer).
//   - Ancestors get re-snapshotted via the fallback path; their layers
//     get a new `children` array with the cell's new sig — no notes
//     bytes on ancestors, just sig propagation.
//
// Result: notes are part of the canonical layer signature for free.
// Cell layer changes when notes change → new cell sig → parent's
// children array changes → cascade to root. Undo at any depth restores
// the entire merkle subtree including notes.
//
// Cross-browser: the layer JSON IS the truth (notes refer to a sig-
// addressed NoteSet resource). The local `hc:notes-index` is just a
// hot cache — same setSig deterministically yields same content.
//
// History is never rewritten — every committed layer remains, so
// scrub-back replays past note sets losslessly. Compaction is a
// separate, explicit transaction and out of scope here.
import { EffectBus, SignatureService, hypercomb } from '@hypercomb/core'
// TYPE-ONLY import — the runtime instance is the single shared singleton
// registered with window.ioc by layer-slot-registry.ts. We obtain it
// via get() at module-load. Importing the class symbol non-type-only
// would bundle its definition into this bee, giving a different class
// identity from the shared instance and silently breaking the singleton
// (registrations on the bundled-in copy would be invisible to listeners
// on the shared copy — the exact bug we just fixed).
import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'

export type Note = {
  id: string
  text: string
  createdAt: number
  /** Last edit timestamp; absent on first creation. */
  updatedAt?: number
  /** Tags attached directly to this note. Sorted lexicographically when written. */
  tags?: string[]
}

export type NoteSet = {
  version: 1
  cellLabel: string
  notes: Note[]
  at: number
}

const CAPTURE_MODE = 'note-capture' as const

/**
 * localStorage key holding `{ [locationSig]: noteSetSig }` — keyed
 * by the cell's own merkle layer location, NOT by cellLabel. This
 * means cells with identical labels at different lineages have
 * independent notes (which is correct: notes are about THIS cell at
 * THIS path in the hierarchy, not about every cell sharing a name).
 *
 * The previous shape was `{ [cellLabel]: noteSetSig }` — a flat
 * global index where /a/x and /b/x shared notes. Migrating users:
 * old entries with non-64-hex keys are ignored on read; the next
 * write rebuilds the index in the new shape. Old NoteSet resources
 * remain readable (they're sig-addressed, content unchanged).
 */
const NOTES_INDEX_KEY = 'hc:notes-index'

const SIG_REGEX = /^[a-f0-9]{64}$/

type Lineage = {
  explorerSegments?: () => string[]
}

type HistoryServiceLike = {
  sign: (lineage: Lineage) => Promise<string>
}

export class NotesService extends EventTarget {

  #queue: Promise<void> = Promise.resolve()

  /** In-memory cache of decoded note sets keyed by setSig. Populated on warmup. */
  readonly #setCache = new Map<string, NoteSet>()

  /** Cache of computed cell locationSigs keyed by `parent/cellLabel` so we
   *  don't re-sign the same lineage on every UI tick. Cleared when Lineage
   *  changes (subscribed in constructor). */
  readonly #cellLocSigCache = new Map<string, string>()

  constructor() {
    super()
    // Lineage navigation invalidates the per-cell locationSig cache —
    // the same cellLabel resolves to a different location depending on
    // which folder the user is currently inside.
    const lineage = get<EventTarget>('@hypercomb.social/Lineage') as unknown as EventTarget | undefined
    lineage?.addEventListener?.('change', () => this.#cellLocSigCache.clear())

    // `note:capture` accepts:
    //   - { cellLabel }                              → start a fresh note
    //   - { cellLabel, prefill, editId }             → edit an existing note;
    //       the command line preloads `prefill` and the eventual commit
    //       round-trips `editId` so we replace in place rather than append.
    EffectBus.on<{ cellLabel: string; prefill?: string; editId?: string }>('note:capture', (payload) => {
      if (!payload?.cellLabel) return
      EffectBus.emit('command:enter-mode', {
        mode: CAPTURE_MODE,
        target: payload.cellLabel,
        prefill: payload.prefill ?? '',
        editId: payload.editId ?? '',
      })
    })

    // `note:commit` accepts:
    //   - { cellLabel, text }            → append a new note
    //   - { cellLabel, text, editId }    → replace the note with this id
    EffectBus.on<{ cellLabel: string; text: string; editId?: string }>('note:commit', (payload) => {
      const text = (payload?.text ?? '').trim()
      if (!payload?.cellLabel || !text) return
      this.#enqueueWrite(payload.cellLabel, (prior) => {
        const now = Date.now()
        if (payload.editId) {
          const idx = prior.findIndex(n => n.id === payload.editId)
          if (idx === -1) return [...prior, { id: cryptoRandomId(), text, createdAt: now }]
          const next = prior.slice()
          next[idx] = { ...prior[idx], text, updatedAt: now }
          return next
        }
        return [...prior, { id: cryptoRandomId(), text, createdAt: now }]
      })
    })

    // Delete a single note. Non-destructive — the prior set resource stays
    // on disk; we just write a new set that excludes this id, and the new
    // layer's `notesByCell` points at that. Undo rewinds back to the old
    // set signature automatically.
    EffectBus.on<{ cellLabel: string; noteId: string }>('note:delete', (payload) => {
      if (!payload?.cellLabel || !payload?.noteId) return
      this.#enqueueWrite(payload.cellLabel, (prior) => {
        // Prefer id match; fall back to a content+timestamp match so notes
        // that landed on disk without a stable id (legacy data) are still
        // deletable. Same-signature content guarantees the match is exact.
        let next = prior.filter(n => n.id !== payload.noteId)
        if (next.length === prior.length) {
          next = prior.filter(n => {
            const fallbackId = `${n.createdAt ?? ''}:${n.text ?? ''}`
            return fallbackId !== payload.noteId
          })
        }
        if (next.length === prior.length) {
          console.warn('[notes] delete: no matching note for id', payload.noteId, 'in cell', payload.cellLabel)
          return prior
        }
        return next
      })
    })

    // Tag attach/detach for a single note. Tags array is canonical-sorted.
    EffectBus.on<{ cellLabel: string; noteId: string; tag: string; remove?: boolean }>('note:tag', (payload) => {
      const tag = (payload?.tag ?? '').trim()
      if (!payload?.cellLabel || !payload?.noteId || !tag) return
      this.#enqueueWrite(payload.cellLabel, (prior) => {
        const idx = prior.findIndex(n => n.id === payload.noteId)
        if (idx === -1) return prior
        const note = prior[idx]
        const tags = new Set(note.tags ?? [])
        if (payload.remove) tags.delete(tag); else tags.add(tag)
        const next = prior.slice()
        next[idx] = { ...note, tags: [...tags].sort(), updatedAt: Date.now() }
        return next
      })
    })
  }

  /**
   * Read the current note set signature for a cell at the user's
   * current location. Returns "" if the cell has no notes. Resolves
   * the cell's full layer location internally — callers don't pass
   * segments; the lineage is implicit (same UI assumption as before).
   */
  public readonly setSigFor = (cellLabel: string): string => {
    const locSig = this.#cellLocationSigSync(cellLabel)
    if (!locSig) return ''
    const index = this.#readIndex()
    return index[locSig] ?? ''
  }

  /**
   * Slot-side read: given a layer's location sig, return the note set
   * sig stored under it (or "" / undefined). LayerSlotRegistry calls
   * this during snapshot assembly. Pure lookup — no lineage needed.
   */
  public readonly setSigForLocation = (locationSig: string): string => {
    const index = this.#readIndex()
    return index[locationSig] ?? ''
  }

  /**
   * Read the entire `locationSig -> setSig` index. For diagnostics
   * and potential bulk operations; the per-slot read goes through
   * setSigForLocation directly.
   */
  public readonly readIndex = (): Record<string, string> => {
    return { ...this.#readIndex() }
  }

  /**
   * Resolve the current notes for a cell at the user's current
   * location. Async — waits for the resource to load if not cached.
   */
  public readonly getNotes = async (cellLabel: string): Promise<Note[]> => {
    const sig = this.setSigFor(cellLabel)
    if (!sig) return []
    const set = await this.#loadSet(sig)
    return set?.notes ?? []
  }

  /**
   * Synchronous read from the warm cache. Returns an empty array if
   * the cell has no notes or its set has not been decoded yet (call
   * warmup() first or getNotes() async to populate). UI code re-reads
   * after `notes:changed`.
   */
  public readonly notesFor = (cellLabel: string): Note[] => {
    const sig = this.setSigFor(cellLabel)
    if (!sig) return []
    const set = this.#setCache.get(sig)
    return set?.notes ?? []
  }

  /**
   * Pre-decode every note set referenced by the index so the UI can
   * read synchronously from the cache. Called by the warmup lifecycle.
   */
  public readonly warmup = async (): Promise<void> => {
    const sigs = new Set(Object.values(this.#readIndex()).filter(Boolean))
    await Promise.all([...sigs].map(s => this.#loadSet(s)))
  }

  // ── internal ──────────────────────────────────────────────

  #readIndex(): Record<string, string> {
    try {
      const raw = localStorage.getItem(NOTES_INDEX_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {}
    } catch {
      return {}
    }
  }

  #writeIndex(next: Record<string, string>): void {
    localStorage.setItem(NOTES_INDEX_KEY, JSON.stringify(next))
  }

  #enqueueWrite(cellLabel: string, transform: (prior: Note[]) => Note[]): void {
    this.#queue = this.#queue
      .then(() => this.#write(cellLabel, transform))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        const stack = err instanceof Error ? err.stack : undefined
        console.error('[notes] write failed for cell', cellLabel, msg, stack ?? '')
      })
  }

  async #write(cellLabel: string, transform: (prior: Note[]) => Note[]): Promise<void> {
    const store = get<{
      putResource: (blob: Blob) => Promise<void>
      getResource: (sig: string) => Promise<Blob | null>
    }>('@hypercomb.social/Store')
    if (!store) return

    // Resolve the cell's full layer location. Notes belong to the
    // CLICKED cell's own layer at sign(parentSegments + [cellLabel]).
    // If we can't resolve (no lineage / no history service), bail —
    // we can't safely write notes against an unknown layer.
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) {
      console.warn('[notes] cannot resolve cell location for', cellLabel, '— skipping write')
      return
    }
    const { locationSig, segments } = resolved

    const priorSig = this.setSigForLocation(locationSig)
    const prior = priorSig ? (await this.#loadSet(priorSig))?.notes ?? [] : []
    const next = transform(prior)
    if (next === prior) return

    const snapshot: NoteSet = {
      version: 1,
      cellLabel,
      notes: next,
      at: Date.now(),
    }
    const json = canonicalJSON(snapshot)
    const blob = new Blob([json], { type: 'application/json' })
    const bytes = await blob.arrayBuffer()
    const resourceSig = await SignatureService.sign(bytes)

    // Resource first — idempotent by signature, so a partial run that fails
    // before the index update only leaves an orphan (safe).
    await store.putResource(blob)

    // Update the per-LOCATION pointer (NOT per-cellLabel — different
    // lineages with same-named cells must have independent notes).
    // LayerSlotRegistry's read fires during the next snapshot and the
    // setSig under this locationSig becomes the layer's `notes` field.
    const index = this.#readIndex()
    index[locationSig] = resourceSig
    this.#writeIndex(index)

    // Cache the decoded set so subsequent reads are synchronous.
    this.#setCache.set(resourceSig, snapshot)

    this.dispatchEvent(new CustomEvent('change', { detail: { cellLabel, count: snapshot.notes.length } }))

    // CRITICAL: emit with the CELL's full segments (parent + cellLabel),
    // not the parent's. LayerCommitter cascades from `segments` upward,
    // so emitting parent segments would commit the parent layer with
    // (slot.read at parent → undefined since the index is keyed by the
    // child's locationSig). The cell's layer would never be touched.
    // Emitting the cell's segments commits the cell's layer (where
    // notes:string lands), then ancestors get the cascade for free.
    EffectBus.emit('notes:changed', {
      cellLabel,
      segments,
      count: snapshot.notes.length,
    })

    void new hypercomb().act()
  }

  /**
   * Resolve the layer location of a cell clicked at the current
   * lineage. Returns segments = [...parent, cellLabel] and the sig.
   * Memoized per `parent/cellLabel` until the lineage changes.
   */
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

  /**
   * Synchronous best-effort sigFor — used by UI reads via setSigFor
   * and notesFor. Returns "" when the locationSig hasn't been computed
   * yet (e.g. first visit to a cell). The async getNotes path computes
   * and caches; subsequent sync calls hit the cache.
   *
   * Worst case: the UI shows "no notes" for one frame after navigation,
   * then re-renders on the next `notes:changed` or once getNotes() lands.
   */
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

  async #loadSet(resourceSig: string): Promise<NoteSet | null> {
    const cached = this.#setCache.get(resourceSig)
    if (cached) return cached

    const store = get<{ getResource: (sig: string) => Promise<Blob | null> }>('@hypercomb.social/Store')
    if (!store) return null

    try {
      const blob = await store.getResource(resourceSig)
      if (!blob) return null
      const text = await blob.text()
      const parsed = JSON.parse(text)
      if (parsed && parsed.version === 1 && Array.isArray(parsed.notes)) {
        // Legacy-shape tolerance: ensure every note has a non-empty id so
        // the UI can reference it for delete/edit. Notes without an id get
        // a synthetic content+timestamp one — unique enough within a set,
        // and matches the fallback match in the `note:delete` transform.
        const notes: Note[] = parsed.notes.map((n: Note) => {
          if (n && typeof n.id === 'string' && n.id) return n
          const fallbackId = `${n?.createdAt ?? ''}:${n?.text ?? ''}`
          return { ...n, id: fallbackId }
        })
        const set: NoteSet = { ...parsed, notes }
        this.#setCache.set(resourceSig, set)
        return set
      }
      return null
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[notes] failed to load set', resourceSig, msg)
      return null
    }
  }
}

function cryptoRandomId(): string {
  const c = (globalThis as any).crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '')
  const bytes = new Uint8Array(16)
  c?.getRandomValues?.(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
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

// Mechanical history integration: the `notes` slot. LayerCommitter
// auto-subscribes to `notes:changed` via the registry's trigger
// callback and folds this slot's read result into the layer at the
// trigger's location.
//
// Slot value: a single string — the noteSetSig for THIS location.
// Undefined when no notes exist at this location (slot omitted from
// the layer JSON, sparse-layer invariant preserved).
//
// The locationSig passed in IS the cell's own layer location (set by
// the trigger's `segments` payload in NotesService.#write). Per-cell
// scoping is therefore automatic: notes for /a/X live at sign(/a/X);
// notes for /b/X live at sign(/b/X); they cannot collide.
// Get the shared registry instance from ioc (registered at
// `@diamondcoreprocessor.com/LayerSlotRegistry` by layer-slot-registry.ts).
// If the registry hasn't loaded yet — extremely unlikely since the
// history namespace dep loads before the notes bee — we skip the
// registration; the slot would be invisible to history but writes
// still work. Defensive only.
const _slotRegistry = get<LayerSlotRegistry>('@diamondcoreprocessor.com/LayerSlotRegistry')
if (_slotRegistry) {
  _slotRegistry.register({
    slot: 'notes',
    triggers: ['notes:changed'],
    read: (locationSig) => {
      const setSig = _notesService.setSigForLocation(locationSig)
      return setSig || undefined
    },
  })
} else {
  console.warn('[notes] LayerSlotRegistry not available at module-load — notes will not be captured in history')
}
