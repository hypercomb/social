// revolucionstyle.com/journal/journal.service.ts
import { EffectBus } from '@hypercomb/core'
import type { Cigar, CigarRatings, FlavorProfile, JournalEntry, Pairing } from './journal-entry.js'
import { emptyEntry } from './journal-entry.js'

type Store = {
  current: FileSystemDirectoryHandle
  putResource: (blob: Blob) => Promise<string>
  getResource: (sig: string) => Promise<Blob | null>
}

export class JournalService extends EventTarget {

  static readonly #INDEX_KEY = 'hc:journal-index'

  #mode: 'idle' | 'editing' = 'idle'
  #entry: JournalEntry = emptyEntry()
  #entrySig: string | null = null

  // ── getters ────────────────────────────────────────────────────

  get mode(): 'idle' | 'editing' { return this.#mode }
  get entry(): JournalEntry { return this.#entry }
  get entrySig(): string | null { return this.#entrySig }
  get isNew(): boolean { return this.#entrySig === null }

  // ── open / close ───────────────────────────────────────────────

  readonly open = (entry?: JournalEntry, sig?: string): void => {
    this.#entry = entry ? structuredClone(entry) : emptyEntry()
    this.#entrySig = sig ?? null
    this.#mode = 'editing'
    this.#emit()
    EffectBus.emit('journal:mode', { active: true })
  }

  readonly close = (): void => {
    this.#mode = 'idle'
    this.#entry = emptyEntry()
    this.#entrySig = null
    this.#emit()
    EffectBus.emit('journal:mode', { active: false })
  }

  // ── field mutators ─────────────────────────────────────────────

  readonly setCigar = (cigar: Partial<Cigar>): void => {
    Object.assign(this.#entry.cigar, cigar)
    this.#emit()
  }

  readonly setRating = (field: keyof CigarRatings, value: number): void => {
    this.#entry.ratings[field] = Math.max(0, Math.min(5, value))
    this.#emit()
  }

  readonly setNotes = (notes: string): void => {
    this.#entry.notes = notes
    this.#emit()
  }

  readonly setFlavors = (profile: FlavorProfile): void => {
    this.#entry.flavors = { ...profile }
    this.#emit()
  }

  readonly addPairing = (pairing: Pairing): void => {
    this.#entry.pairings.push(pairing)
    this.#emit()
  }

  readonly removePairing = (index: number): void => {
    this.#entry.pairings.splice(index, 1)
    this.#emit()
  }

  readonly setOccasion = (occasion: string): void => {
    this.#entry.occasion = occasion
    this.#emit()
  }

  readonly setDuration = (minutes: number): void => {
    this.#entry.durationMinutes = minutes
    this.#emit()
  }

  readonly addPhoto = async (blob: Blob): Promise<void> => {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    if (!store) return
    const sig = await store.putResource(blob)
    this.#entry.photoSigs.push(sig)
    this.#emit()
  }

  readonly removePhoto = (index: number): void => {
    this.#entry.photoSigs.splice(index, 1)
    this.#emit()
  }

  // ── save ───────────────────────────────────────────────────────

  readonly save = async (): Promise<string | null> => {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    if (!store) return null

    const json = JSON.stringify(this.#entry, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const sig = await store.putResource(blob)

    // persist index so we can enumerate entries later
    const index: string[] = JSON.parse(localStorage.getItem(JournalService.#INDEX_KEY) ?? '[]')
    if (!index.includes(sig)) {
      index.push(sig)
      localStorage.setItem(JournalService.#INDEX_KEY, JSON.stringify(index))
    }

    const savedCigar = structuredClone(this.#entry.cigar)
    this.close()
    EffectBus.emit('journal:saved', { sig, cigar: savedCigar })
    return sig
  }

  // ── load ───────────────────────────────────────────────────────

  readonly loadEntry = async (sig: string): Promise<JournalEntry | null> => {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    if (!store) return null

    try {
      const blob = await store.getResource(sig)
      if (!blob) return null
      const text = await blob.text()
      return JSON.parse(text) as JournalEntry
    } catch {
      return null
    }
  }

  // ── list ───────────────────────────────────────────────────────

  readonly listEntries = async (): Promise<{ sig: string; entry: JournalEntry }[]> => {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    if (!store) return []

    const index: string[] = JSON.parse(localStorage.getItem(JournalService.#INDEX_KEY) ?? '[]')
    const entries: { sig: string; entry: JournalEntry }[] = []

    for (const sig of index) {
      try {
        const blob = await store.getResource(sig)
        if (!blob) continue
        const text = await blob.text()
        entries.push({ sig, entry: JSON.parse(text) })
      } catch { /* skip corrupted */ }
    }

    entries.sort((a, b) => b.entry.smokedAt - a.entry.smokedAt)
    return entries
  }

  // ── internal ───────────────────────────────────────────────────

  #emit(): void {
    this.dispatchEvent(new CustomEvent('change'))
  }
}

window.ioc.register(
  '@revolucionstyle.com/JournalService',
  new JournalService(),
)
