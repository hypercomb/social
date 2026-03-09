// revolucionstyle.com/journal/journal.service.ts
// Journal entry CRUD — reads/writes entries in OPFS.

import { EffectBus, SignatureService } from '@hypercomb/core'
import type { Cigar, CigarRatings, FlavorProfile, JournalEntry, Pairing } from './journal-entry.js'
import { emptyEntry, JOURNAL_PROPERTIES_FILE } from './journal-entry.js'

type Store = {
  current: FileSystemDirectoryHandle
  putResource: (blob: Blob) => Promise<string>
  getResource: (sig: string) => Promise<Blob | null>
}

export class JournalService extends EventTarget {

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

    let domainDir: FileSystemDirectoryHandle
    try {
      domainDir = await store.current.getDirectoryHandle('revolucionstyle.com', { create: true })
    } catch { return null }

    let journalDir: FileSystemDirectoryHandle
    try {
      journalDir = await domainDir.getDirectoryHandle('journal', { create: true })
    } catch { return null }

    const json = JSON.stringify(this.#entry, null, 2)
    const bytes = new TextEncoder().encode(json)
    const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)

    const entryDir = await journalDir.getDirectoryHandle(sig, { create: true })
    const fileHandle = await entryDir.getFileHandle(JOURNAL_PROPERTIES_FILE, { create: true })
    const writable = await fileHandle.createWritable()
    try {
      await writable.write(json)
    } finally {
      await writable.close()
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
      const domainDir = await store.current.getDirectoryHandle('revolucionstyle.com')
      const journalDir = await domainDir.getDirectoryHandle('journal')
      const entryDir = await journalDir.getDirectoryHandle(sig)
      const fileHandle = await entryDir.getFileHandle(JOURNAL_PROPERTIES_FILE)
      const file = await fileHandle.getFile()
      const text = await file.text()
      return JSON.parse(text) as JournalEntry
    } catch {
      return null
    }
  }

  // ── list ───────────────────────────────────────────────────────

  readonly listEntries = async (): Promise<{ sig: string; entry: JournalEntry }[]> => {
    const store = window.ioc.get<Store>('@hypercomb.social/Store')
    if (!store) return []

    const entries: { sig: string; entry: JournalEntry }[] = []

    try {
      const domainDir = await store.current.getDirectoryHandle('revolucionstyle.com')
      const journalDir = await domainDir.getDirectoryHandle('journal')

      for await (const [name, handle] of journalDir.entries()) {
        if (handle.kind !== 'directory') continue
        try {
          const fileHandle = await (handle as FileSystemDirectoryHandle).getFileHandle(JOURNAL_PROPERTIES_FILE)
          const file = await fileHandle.getFile()
          const text = await file.text()
          entries.push({ sig: name, entry: JSON.parse(text) })
        } catch { /* skip corrupted */ }
      }
    } catch { /* no journal dir yet */ }

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
