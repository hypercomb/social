// diamondcoreprocessor.com/notes/notes.drone.ts
//
// Notes participate in the merkle layer tree as first-class layers.
// One Note → one body resource (its canonical JSON content) → one
// participant layer at sign([...cellSegments, '__notes__', noteId])
// holding `{ name: noteId, body: [bodyResourceSig] }`.
//
// The clicked cell's layer carries `notes: [noteLayerSig, ...]` —
// the array of participant layer sigs. When a note changes:
//   1. Its body resource is hashed + persisted.
//   2. Its participant layer commits at its synthetic location (its own
//      bag, its own immutable history).
//   3. The notes index at the cell's locationSig updates with the new
//      participant layer sig array.
//   4. `notes:changed` fires with the cell's segments.
//   5. LayerCommitter cascades from the cell up to root: the cell's
//      `notes` slot reads the new sig array, cell layer sig changes,
//      every ancestor swaps the cell sig pair in its children.
//
// All five steps are mechanical — provided by HiveParticipant. The
// only NotesService-specific code is the Note shape, the EffectBus
// wiring (note:capture / commit / delete / tag), and the icon
// registration.

import { EffectBus } from '@hypercomb/core'
import type { LayerContent } from '../history/history.service.js'
import { HiveParticipant } from '../history/hive-participant.js'

const NOTE_ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12l4 4v12H4z"/><polyline points="16 4 16 8 20 8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="14" y2="16"/></svg>`

const NOTE_ACCENT = 0xffe14a

const CAPTURE_MODE = 'note-capture' as const

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
  explorerSegments?: () => string[]
}

type HistoryServiceLike = {
  sign: (lineage: Lineage) => Promise<string>
}

export type Note = {
  id: string
  text: string
  createdAt: number
  updatedAt?: number
  tags?: string[]
}

/**
 * NotesService — the canonical participant for tile notes.
 *
 * The clicked tile is the OWNER (parent for HiveParticipant purposes).
 * Notes belong to the tile's own layer — the tile's `notes` slot holds
 * the sig array of note participant layers. Cells at different lineages
 * with the same label have independent notes (the parent locationSig
 * differs).
 */
export class NotesService extends HiveParticipant<Note> {

  readonly slot = 'notes'
  readonly triggerName = 'notes:changed'
  readonly version = 1

  // Memoized cell-locationSig keyed by `parent/cellLabel`. Cleared
  // when Lineage changes (the same cellLabel resolves to a different
  // location depending on which folder the user is in).
  readonly #cellLocSigCache = new Map<string, string>()

  idOf(note: Note): string { return note.id }

  sortKey(note: Note): number { return note.createdAt }

  canonicalizeBody(note: Note): string {
    return canonicalJSON(note)
  }

  decodeBody(text: string): Note {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('[notes] body did not parse to an object')
    }
    if (typeof parsed.id !== 'string' || typeof parsed.text !== 'string' || typeof parsed.createdAt !== 'number') {
      throw new Error('[notes] body is missing required fields {id, text, createdAt}')
    }
    return parsed as Note
  }

  layerFor(note: Note, bodySig: string): LayerContent {
    return { name: note.id, body: [bodySig] }
  }

  constructor() {
    super()

    // Drop the previous notes-system localStorage key, fully and
    // explicitly. The new system uses HiveParticipant's namespaced
    // index — the legacy entry would just sit there as cruft.
    this.purgeLegacyKey('hc:notes-index')

    // Lineage navigation invalidates the per-cell locationSig cache —
    // the same cellLabel resolves to a different location depending on
    // which folder the user is currently inside.
    const lineage = get<EventTarget>('@hypercomb.social/Lineage') as unknown as EventTarget | undefined
    lineage?.addEventListener?.('change', () => this.#cellLocSigCache.clear())

    // Self-register the 'note' tile icon. Toggle this drone off in DCP
    // → constructor never runs → icon never reaches the arranger →
    // never appears on the hex.
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

    // ── EffectBus wiring ────────────────────────────────────────────
    //
    // `note:capture` accepts `{ cellLabel, prefill?, editId? }`. UI
    // event — drives the command line into capture mode. No data
    // mutation here.
    EffectBus.on<{ cellLabel: string; prefill?: string; editId?: string }>('note:capture', (payload) => {
      if (!payload?.cellLabel) return
      EffectBus.emit('command:enter-mode', {
        mode: CAPTURE_MODE,
        target: payload.cellLabel,
        prefill: payload.prefill ?? '',
        editId: payload.editId ?? '',
      })
    })

    // `note:commit` — append a new note OR replace the note with `editId`.
    EffectBus.on<{ cellLabel: string; text: string; editId?: string }>('note:commit', (payload) => {
      const text = (payload?.text ?? '').trim()
      if (!payload?.cellLabel || !text) return
      void this.#applyToCell(payload.cellLabel, async (prior) => {
        const now = Date.now()
        if (payload.editId) {
          const idx = prior.findIndex(n => n.id === payload.editId)
          if (idx >= 0) {
            const next = prior.slice()
            next[idx] = { ...prior[idx], text, updatedAt: now }
            return { upsert: [next[idx]] }
          }
        }
        return { upsert: [{ id: cryptoRandomId(), text, createdAt: now }] }
      })
    })

    // `note:delete` — remove a note by id from the cell.
    EffectBus.on<{ cellLabel: string; noteId: string }>('note:delete', (payload) => {
      if (!payload?.cellLabel || !payload?.noteId) return
      void this.#applyToCell(payload.cellLabel, async () => ({ remove: payload.noteId }))
    })

    // `note:tag` — attach or detach a tag on a single note.
    EffectBus.on<{ cellLabel: string; noteId: string; tag: string; remove?: boolean }>('note:tag', (payload) => {
      const tag = (payload?.tag ?? '').trim()
      if (!payload?.cellLabel || !payload?.noteId || !tag) return
      void this.#applyToCell(payload.cellLabel, async (prior) => {
        const note = prior.find(n => n.id === payload.noteId)
        if (!note) return null
        const tags = new Set(note.tags ?? [])
        if (payload.remove) tags.delete(tag); else tags.add(tag)
        return {
          upsert: [{ ...note, tags: [...tags].sort(), updatedAt: Date.now() }],
        }
      })
    })
  }

  // ── Public read API (back-compat with UI consumers) ───────────────

  /** Synchronous notes for a cell at the user's current lineage.
   *  Empty array if no notes (or the warm cache hasn't loaded yet —
   *  call getNotes() async or warmup() at boot to populate). */
  public readonly notesFor = (cellLabel: string): Note[] => {
    const locSig = this.#cellLocationSigSync(cellLabel)
    if (!locSig) return []
    return this.itemsAt(locSig)
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  /** Async-resolving notes for a cell. Awaits cell-loc resolution AND
   *  any cold cache loads. After this, notesFor() reads sync. */
  public readonly getNotes = async (cellLabel: string): Promise<Note[]> => {
    await this.warmup()
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) return []
    return this.itemsAt(resolved.locationSig)
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  // ── Internal: cell-location resolution + transform plumbing ───────

  /**
   * Apply a transform to a cell's notes. The transform returns either
   * `{ upsert: Note[] }` (add or replace items by id) or
   * `{ remove: string }` (drop a single note by id) or `null` (no-op).
   * Resolves the cell's full lineage segments internally.
   */
  async #applyToCell(
    cellLabel: string,
    transform: (prior: Note[]) => Promise<{ upsert?: Note[]; remove?: string } | null>,
  ): Promise<void> {
    const resolved = await this.#resolveCellLocation(cellLabel)
    if (!resolved) {
      console.warn('[notes] cannot resolve cell location for', cellLabel)
      return
    }
    const { segments, locationSig } = resolved
    const prior = this.itemsAt(locationSig)
    const result = await transform(prior)
    if (!result) return
    if (result.remove) {
      await this.remove(segments, result.remove)
    } else if (result.upsert && result.upsert.length > 0) {
      await this.upsert(segments, result.upsert)
    }
  }

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
}

function cryptoRandomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
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
