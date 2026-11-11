// dub/dub-bank.ts
//
// THE SOUNDBANK: a voice for a sentence, recorded in place.
//
// jwize, 2026-11-11: "replace the sound bites per sentence ... publish to our
// host pools our own dub so that people in the community can provide their
// own ... recorded in place by microphone then store them in our pool and make
// them the default soundbank for the presentation."
//
// A DUB BELONGS TO A SENTENCE, NOT TO A PAGE. The sentence's name is the
// SHA-256 of its words, spaces folded (the presentation's page builder spells
// the same fold: scripts/bridge/living-presentation/blocks/page.cjs). One take
// therefore answers that sentence on every page that says it, and a sentence
// reworded is a new sentence with no take yet — never a stale voice over new
// words.
//
// The take's bytes are a resource (sig-named at the root, stored once). What
// this pool holds is the small record that places the take on the sentence:
// one current record per sentence, earlier takes kept as versions.

import { SignatureService } from '@hypercomb/core'

/** Pool of meaning holding the records. Colon-carrying, per doctrine (P4). */
export const DUB_POOL = 'presentation:dubs'

/** A take placed on a sentence. `voice: ''` means "play what the page was built
 *  with" — the way a take is put down without deleting anything. */
export interface DubRecord {
  readonly kind: 'presentation:dub'
  readonly v: 1
  /** The sentence's name (sentenceKey). */
  readonly say: string
  /** The sentence's words as they are said now. The page's own words unless
   *  `reworded`, in which case these are shown and read in their place. */
  readonly text: string
  /** The words were edited in place: `text` replaces what the page was built with. */
  readonly reworded?: boolean
  /** The take: a resource signature, or '' for none. */
  readonly voice: string
  /** The take's media type, as the recorder made it. */
  readonly type: string
  readonly seconds: number
  readonly at: number
}

/** A whole bank as one document — what a host is offered, one member per
 *  dubber, so a published index never grows with the number of sentences. */
export interface Soundbank {
  readonly kind: 'presentation:soundbank'
  readonly v: 1
  readonly name: string
  readonly voices: Readonly<Record<string, { readonly voice: string; readonly type: string; readonly seconds: number; readonly text?: string }>>
  readonly at: number
}

/** The fold a sentence is named under: trimmed, runs of space as one. */
export const foldSentence = (say: string): string => String(say ?? '').trim().replace(/\s+/g, ' ')

/** A sentence's name. */
export const sentenceKey = async (say: string): Promise<string> =>
  SignatureService.sign(new TextEncoder().encode(foldSentence(say)).buffer as ArrayBuffer)

const SIG = /^[a-f0-9]{64}$/

/** A record read back, or null when it is not one this version wrote. */
export const asDubRecord = (value: unknown): DubRecord | null => {
  const record = value as Partial<DubRecord> | null
  if (!record || record.kind !== 'presentation:dub' || record.v !== 1) return null
  if (typeof record.say !== 'string' || !SIG.test(record.say)) return null
  if (typeof record.voice !== 'string' || (record.voice !== '' && !SIG.test(record.voice))) return null
  return {
    kind: 'presentation:dub',
    v: 1,
    say: record.say,
    text: String(record.text ?? ''),
    voice: record.voice,
    type: String(record.type ?? ''),
    seconds: Number(record.seconds) || 0,
    at: Number(record.at) || 0,
    ...(record.reworded === true && String(record.text ?? '').trim() ? { reworded: true } : {}),
  }
}

/** The bank a set of records makes: every sentence that has a take or new words. */
export const soundbankOf = (records: readonly DubRecord[], name: string, at: number): Soundbank => {
  const voices: Record<string, { voice: string; type: string; seconds: number; text?: string }> = {}
  for (const record of [...records].sort((a, b) => a.at - b.at)) {
    if (record.voice || record.reworded) {
      voices[record.say] = { voice: record.voice, type: record.type, seconds: record.seconds, ...(record.reworded ? { text: record.text } : {}) }
    } else delete voices[record.say]
  }
  return { kind: 'presentation:soundbank', v: 1, name, voices, at }
}

/** A bank read back, dropping any entry that does not name a take. */
export const asSoundbank = (value: unknown): Soundbank | null => {
  const bank = value as Partial<Soundbank> | null
  if (!bank || bank.kind !== 'presentation:soundbank' || bank.v !== 1 || !bank.voices || typeof bank.voices !== 'object') return null
  const voices: Record<string, { voice: string; type: string; seconds: number; text?: string }> = {}
  for (const [say, entry] of Object.entries(bank.voices)) {
    if (!SIG.test(say) || !entry) continue
    const voice = String(entry.voice ?? '')
    const text = typeof entry.text === 'string' ? foldSentence(entry.text) : ''
    // An entry is a take, new words, or both — never neither.
    if (voice ? !SIG.test(voice) : !text) continue
    voices[say] = { voice, type: String(entry.type ?? ''), seconds: Number(entry.seconds) || 0, ...(text ? { text } : {}) }
  }
  return { kind: 'presentation:soundbank', v: 1, name: String(bank.name ?? ''), voices, at: Number(bank.at) || 0 }
}

// ── the karaoke cursor ──────────────────────────────────────────────────────

export interface KaraokeWord {
  readonly word: string
  /** Seconds from the start at which the word is due, and when it is done. */
  readonly from: number
  readonly to: number
}

/** How long a sentence takes to read aloud, at the tour's pace. */
export const readingSeconds = (say: string): number => {
  const words = foldSentence(say).split(' ').filter(Boolean).length
  return Math.max(1.6, words / 2.6)
}

/** Each word with the time it is due: the words share the take in proportion
 *  to how long each takes to say (its letters, and a beat after punctuation). */
export const karaoke = (say: string, seconds: number): KaraokeWord[] => {
  const words = foldSentence(say).split(' ').filter(Boolean)
  if (!words.length) return []
  const weight = (word: string): number => word.replace(/[^\p{L}\p{N}]/gu, '').length + 1.5 + (/[.,;:!?]$/.test(word) ? 2 : 0)
  const total = words.reduce((sum, word) => sum + weight(word), 0)
  const span = Math.max(0.1, seconds)
  let at = 0
  return words.map(word => {
    const from = at
    at += span * weight(word) / total
    return { word, from, to: at }
  })
}

/** The word the cursor is on at `seconds` — the last word once past the end. */
export const wordAt = (words: readonly KaraokeWord[], seconds: number): number => {
  if (!words.length) return -1
  const index = words.findIndex(word => seconds < word.to)
  return index < 0 ? words.length - 1 : index
}

// ── the pool ────────────────────────────────────────────────────────────────

export type DubStore = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }) => Promise<string | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putResource?: (blob: Blob) => Promise<string>
  getResource?: (signature: string) => Promise<Blob | null>
}

/** The record held for a sentence, or null. */
export const readDub = async (store: DubStore | undefined, say: string): Promise<DubRecord | null> => {
  try {
    const pool = await store?.getPool?.(DUB_POOL)
    const bytes = pool ? await store?.getPoolDoc?.(pool, say) : null
    return bytes ? asDubRecord(JSON.parse(new TextDecoder().decode(bytes))) : null
  } catch { return null }
}

/** Place a take on its sentence. A take is a person's own save, so the take it
 *  replaces is kept as a version. True once the record is on disk. */
export const putDub = async (store: DubStore | undefined, record: DubRecord): Promise<boolean> => {
  try {
    const pool = await store?.getPool?.(DUB_POOL)
    if (!pool || !store?.putPoolDoc) return false
    const bytes = new TextEncoder().encode(JSON.stringify(record)).buffer as ArrayBuffer
    return !!(await store.putPoolDoc(pool, bytes, record.say, { keep: 'versions' }))
  } catch { return false }
}
