// diamondcoreprocessor.com/notes/notes.drone.ts
//
// Notes on tiles. Each tile's notes are stored as a single signature-addressed
// resource containing the full array; replacing the set writes a new resource
// and updates the per-cell pointer in `hc:notes-index`. LayerCommitter reads
// that index on `synchronize` and folds it into the next LayerContent
// snapshot under `notesByCell`, so notes are part of the canonical layer
// signature and ride the same preload pipeline as everything else.
//
// History is never rewritten — every committed layer remains, so scrub-back
// replays past note sets losslessly. Compaction is a separate, explicit
// transaction and out of scope here.
import { EffectBus, SignatureService, hypercomb } from '@hypercomb/core'

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

/** localStorage key holding `{ [cellLabel]: noteSetSig }` for the active session. */
const NOTES_INDEX_KEY = 'hc:notes-index'

export class NotesService extends EventTarget {

  #queue: Promise<void> = Promise.resolve()

  /** In-memory cache of decoded note sets keyed by setSig. Populated on warmup. */
  readonly #setCache = new Map<string, NoteSet>()

  constructor() {
    super()
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
   * Read the current note set signature for a cell from the index.
   * Returns "" if the cell has no notes.
   */
  public readonly setSigFor = (cellLabel: string): string => {
    const index = this.#readIndex()
    return index[cellLabel] ?? ''
  }

  /**
   * Read the entire `cell -> setSig` index — what LayerCommitter folds into
   * `notesByCell` on the next snapshot.
   */
  public readonly readIndex = (): Record<string, string> => {
    return { ...this.#readIndex() }
  }

  /**
   * Resolve the current notes for a cell. Hits the warm in-memory cache when
   * possible; otherwise loads the resource and caches it.
   */
  public readonly getNotes = async (cellLabel: string): Promise<Note[]> => {
    const sig = this.setSigFor(cellLabel)
    if (!sig) return []
    const set = await this.#loadSet(sig)
    return set?.notes ?? []
  }

  /**
   * Synchronous read from the warm cache. Returns an empty array if the
   * cell has no notes or its set has not been decoded yet (call warmup()
   * first or `getNotes` async to populate). UI code that needs to render
   * without async should rely on `notes:changed` to re-read after writes.
   */
  public readonly notesFor = (cellLabel: string): Note[] => {
    const sig = this.setSigFor(cellLabel)
    if (!sig) return []
    const set = this.#setCache.get(sig)
    return set?.notes ?? []
  }

  /**
   * Pre-decode every note set referenced by the current layer head so the UI
   * can read synchronously from the cache. Called by the warmup lifecycle.
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

    const priorSig = this.setSigFor(cellLabel)
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

    // Update the per-cell pointer. LayerCommitter reads this on `synchronize`
    // and the new sig appears in the next layer's `notesByCell`.
    const index = this.#readIndex()
    index[cellLabel] = resourceSig
    this.#writeIndex(index)

    // Cache the decoded set so subsequent reads are synchronous.
    this.#setCache.set(resourceSig, snapshot)

    this.dispatchEvent(new CustomEvent('change', { detail: { cellLabel, count: snapshot.notes.length } }))
    EffectBus.emit('notes:changed', { cellLabel, count: snapshot.notes.length })

    void new hypercomb().act()
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
