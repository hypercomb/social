// assistant/harness.ts
//
// THE HARNESS IS CONTENT (documentation/agent-harness.md, step 1). The agent
// loop's policy — how long a leg runs, what a request may spend, how much a
// provider that asks read by read may read, how a leg hands over — used to
// be constants in the chat window. Now it is a `harness@1` record in the
// `harness` pool of meaning: signed, sig-addressed, one file per harness,
// with the shipped values minted as `default` at boot exactly the way a
// theme is seeded. The window reads the ACTIVE record and keeps today's
// numbers only as the fallback for an older essentials build.
//
// Step 1 changes no behaviour: the default record IS today's values. What
// it changes is where they live — a participant, a domain or a community
// can now hand the loop a different policy by dropping a record in the
// pool, and the device points at it. Steps, instruction and doctrine are
// named here so a record can carry them; the loop reads them from step 3.
//
// What a harness may not do is decided at parse: it may narrow, it may not
// widen past what the participant holds. A record that auto-runs a held
// kind is refused the way a provider spec that smuggles an endpoint is.

import { declarePoolKind, SignatureService, get, isSignature } from '@hypercomb/core'

/** A colon meaning: a SYSTEM pool no tile should name, like `llm:providers`
 *  and `context:basket`; a tile called "harness" keeps its own molecule. */
export const HARNESS_POOL = 'agent:harness'
declarePoolKind(HARNESS_POOL, 'set')

export const HARNESS_IOC_KEY = '@hypercomb.social/Harness'
/** The device's chosen harness: a signature in the pool, or unset = shipped. */
export const HARNESS_DEVICE_KEY = 'hc:harness'

export type HarnessRecord = {
  readonly kind: 'harness@1'
  readonly name: string
  /** Step bees by signature, in order; absent = the shipped loop (step 3). */
  readonly steps?: readonly string[]
  /** The work instruction, by signature; absent = the shipped text. */
  readonly instruction?: string
  /** Doctrine sections by signature, applied under the participant's own. */
  readonly doctrine?: readonly string[]
  readonly leg: { readonly rounds: number; readonly reserveTokens: number; readonly keepVerbatim: number }
  readonly budget: { readonly rounds: number; readonly tokens: number }
  readonly reads: { readonly pageChars: number; readonly roundsWhenAsked: number; readonly charsWhenAsked: number }
  readonly handover: { readonly fence: string; readonly resumeSeconds: number; readonly proseFallback: boolean }
  /** The Execution window's default per kind. May only HOLD more, never auto-run more. */
  readonly review: { readonly auto: readonly string[]; readonly held: readonly string[] }
  /** Narrows the census for this harness; never widens past the grant. */
  readonly vocabulary: { readonly allow: readonly string[]; readonly deny: readonly string[] }
  readonly delegates: readonly string[]
}

/** Today's loop, as a record. These ARE the values the chat window shipped
 *  with; the fallback in the window must stay equal to them. */
export const DEFAULT_HARNESS: HarnessRecord = Object.freeze({
  kind: 'harness@1',
  name: 'default',
  leg: { rounds: 12, reserveTokens: 8_000, keepVerbatim: 4 },
  budget: { rounds: 400, tokens: 6_000_000 },
  reads: { pageChars: 48_000, roundsWhenAsked: 6, charsWhenAsked: 24_000 },
  handover: { fence: 'hypercomb-continue', resumeSeconds: 3_600, proseFallback: true },
  review: { auto: [], held: ['do', 'write'] },
  vocabulary: { allow: [], deny: [] },
  delegates: ['handoff', 'bridge', 'peer'],
}) as HarnessRecord

const KINDS_THAT_CHANGE = new Set(['do', 'write', 'table'])

const num = (value: unknown, fallback: number, min = 1): number => {
  const n = Number(value)
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback
}
const words = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(v => String(v ?? '').trim()).filter(Boolean) : []
const sigs = (value: unknown): string[] => words(value).filter(isSignature)

/** Read a record, filling what it leaves out from the default and refusing
 *  what it may not say. Throws with the reason, so an import can name it. */
export const parseHarness = (json: unknown): HarnessRecord => {
  const raw = (typeof json === 'string' ? JSON.parse(json) : json) as Record<string, unknown> | null
  if (!raw || typeof raw !== 'object') throw new Error('a harness is a JSON object')
  if (raw['kind'] !== 'harness@1') throw new Error('not a harness@1 record')
  const name = String(raw['name'] ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!name || !/^[a-z]/.test(name)) throw new Error('a harness needs a name: lowercase letters, digits and hyphens, starting with a letter')
  const d = DEFAULT_HARNESS
  const leg = (raw['leg'] ?? {}) as Record<string, unknown>
  const budget = (raw['budget'] ?? {}) as Record<string, unknown>
  const reads = (raw['reads'] ?? {}) as Record<string, unknown>
  const handover = (raw['handover'] ?? {}) as Record<string, unknown>
  const review = (raw['review'] ?? {}) as Record<string, unknown>
  const vocabulary = (raw['vocabulary'] ?? {}) as Record<string, unknown>
  const auto = words(review['auto'])
  const widened = auto.filter(kind => KINDS_THAT_CHANGE.has(kind))
  if (widened.length) throw new Error(`a harness may not auto-run ${widened.join(', ')}: those are the participant's to hold`)
  const instruction = typeof raw['instruction'] === 'string' && isSignature(raw['instruction']) ? raw['instruction'] : undefined
  const steps = sigs(raw['steps'])
  const doctrine = sigs(raw['doctrine'])
  return {
    kind: 'harness@1',
    name,
    ...(steps.length ? { steps } : {}),
    ...(instruction ? { instruction } : {}),
    ...(doctrine.length ? { doctrine } : {}),
    leg: {
      rounds: num(leg['rounds'], d.leg.rounds),
      reserveTokens: num(leg['reserveTokens'], d.leg.reserveTokens, 0),
      keepVerbatim: num(leg['keepVerbatim'], d.leg.keepVerbatim, 0),
    },
    budget: { rounds: num(budget['rounds'], d.budget.rounds), tokens: num(budget['tokens'], d.budget.tokens) },
    reads: {
      pageChars: num(reads['pageChars'], d.reads.pageChars, 1_024),
      roundsWhenAsked: num(reads['roundsWhenAsked'], d.reads.roundsWhenAsked),
      charsWhenAsked: num(reads['charsWhenAsked'], d.reads.charsWhenAsked, 1_500),
    },
    handover: {
      fence: String(handover['fence'] ?? d.handover.fence).trim() || d.handover.fence,
      resumeSeconds: num(handover['resumeSeconds'], d.handover.resumeSeconds, 0),
      proseFallback: handover['proseFallback'] === undefined ? d.handover.proseFallback : !!handover['proseFallback'],
    },
    review: { auto, held: [...new Set([...d.review.held, ...words(review['held'])])] },
    vocabulary: { allow: words(vocabulary['allow']), deny: words(vocabulary['deny']) },
    delegates: words(raw['delegates']).length ? words(raw['delegates']) : [...d.delegates],
  }
}

/** The bytes a record is signed over: its canonical JSON, keys as written
 *  by the parser so the same policy always has the same signature. */
export const harnessBytes = (record: HarnessRecord): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(record, null, 2)).buffer as ArrayBuffer

type FileLike = { readonly size: number; text(): Promise<string> }
type WritableLike = { write(chunk: ArrayBuffer): Promise<void>; close(): Promise<void> }
type FileHandleLike = {
  readonly kind: string
  getFile?(): Promise<FileLike>
  createWritable?(): Promise<WritableLike>
}
type DirLike = {
  entries(): AsyncIterable<readonly [string, FileHandleLike]>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>
}
type StoreLike = {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<DirLike | null | undefined>
}

const readDevice = (key: string): string => {
  try { return String(globalThis.localStorage?.getItem(key) ?? '').trim() } catch { return '' }
}
const writeDevice = (key: string, value: string): void => {
  try {
    if (value) globalThis.localStorage?.setItem(key, value)
    else globalThis.localStorage?.removeItem(key)
  } catch { /* private mode: the choice lasts the session */ }
}

/** The pool, read and written. `active` is what the loop reads; it is the
 *  device's chosen record while that record is in the pool, else the
 *  shipped default. A `change` event says the choice or the pool moved. */
export class HarnessStore extends EventTarget {
  readonly #records = new Map<string, HarnessRecord>()
  #defaultSig = ''
  #resolveStore: () => StoreLike | undefined

  constructor(resolveStore: () => StoreLike | undefined = () => get<StoreLike>('@hypercomb.social/Store')) {
    super()
    this.#resolveStore = resolveStore
  }

  /** The record the loop runs under right now. */
  get active(): HarnessRecord {
    const chosen = readDevice(HARNESS_DEVICE_KEY)
    return (chosen ? this.#records.get(chosen) : undefined) ?? DEFAULT_HARNESS
  }

  /** Its signature, '' while the pool has not been read (the shipped values
   *  answer meanwhile, unsigned). */
  get activeSig(): string {
    const chosen = readDevice(HARNESS_DEVICE_KEY)
    return chosen && this.#records.has(chosen) ? chosen : this.#defaultSig
  }

  get defaultSig(): string { return this.#defaultSig }

  list(): { readonly sig: string; readonly record: HarnessRecord; readonly active: boolean }[] {
    const active = this.activeSig
    return [...this.#records].map(([sig, record]) => ({ sig, record, active: sig === active }))
  }

  /** Choose by signature; '' returns to the shipped default. Only a record
   *  the pool holds can be chosen, so a stale pointer never runs blind. */
  use(sig: string): boolean {
    const wanted = String(sig ?? '').trim()
    if (wanted && !this.#records.has(wanted)) return false
    writeDevice(HARNESS_DEVICE_KEY, wanted)
    this.dispatchEvent(new Event('change'))
    return true
  }

  async #pool(): Promise<DirLike | null> {
    const store = this.#resolveStore()
    if (!store?.getPool) return null
    try { await store.initialize?.() } catch { /* boot handles its own failure */ }
    try { return (await store.getPool(HARNESS_POOL)) ?? null } catch { return null }
  }

  /** Read every record the pool holds. Unreadable members are skipped and
   *  named; the roster is whatever parsed. */
  async sweep(): Promise<number> {
    const dir = await this.#pool()
    if (!dir) return 0
    let read = 0
    try {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'file' || !isSignature(name) || !handle.getFile) continue
        try {
          const file = await handle.getFile()
          if (!file.size) continue
          this.#records.set(name, parseHarness(await file.text()))
          read++
        } catch (error) {
          console.warn(`[harness] skipping pool member ${name.slice(0, 12)}…:`, error)
        }
      }
    } catch { /* pool unreadable — the shipped default answers */ }
    if (read) this.dispatchEvent(new Event('change'))
    return read
  }

  /** Mint the shipped default into the pool when it is not there. Content-
   *  addressed, so a second boot writes nothing and a changed default is a
   *  NEW member beside the old one — a record is never overwritten. */
  async seed(): Promise<string> {
    const bytes = harnessBytes(DEFAULT_HARNESS)
    const sig = await SignatureService.sign(bytes)
    this.#defaultSig = sig
    if (!this.#records.has(sig)) {
      this.#records.set(sig, DEFAULT_HARNESS)
      const dir = await this.#pool()
      if (dir) {
        try {
          let present = false
          try { present = !!(await dir.getFileHandle(sig)) } catch { present = false }
          if (!present) {
            const handle = await dir.getFileHandle(sig, { create: true })
            const writable = await handle.createWritable?.()
            if (writable) { try { await writable.write(bytes) } finally { await writable.close() } }
          }
        } catch (error) {
          console.warn('[harness] the default was not persisted:', error)
        }
      }
      this.dispatchEvent(new Event('change'))
    }
    return sig
  }

  /** Bring a record in: parse, sign, persist, and answer its signature. */
  async import(json: unknown): Promise<string> {
    const record = parseHarness(json)
    const bytes = harnessBytes(record)
    const sig = await SignatureService.sign(bytes)
    if (!this.#records.has(sig)) {
      this.#records.set(sig, record)
      const dir = await this.#pool()
      if (dir) {
        try {
          const handle = await dir.getFileHandle(sig, { create: true })
          const writable = await handle.createWritable?.()
          if (writable) { try { await writable.write(bytes) } finally { await writable.close() } }
        } catch (error) {
          console.warn(`[harness] "${record.name}" read but not persisted:`, error)
        }
      }
      this.dispatchEvent(new Event('change'))
    }
    return sig
  }
}

export const harness = new HarnessStore()

// THE BEE WIRES, THE DEPENDENCY EXPORTS. chat.drone publishes this store
// under HARNESS_IOC_KEY and calls `bootHarness` when the Store is ready;
// this module registers nothing itself. The boot is once, and it polls for
// the Store for a bounded while in case the ready signal came and went
// before the bee was loaded (the same door provider discovery uses).
const BOOT_POLL_MS = 500
const BOOT_GIVE_UP_MS = 30_000
let booted = false
const bootOnce = (): void => {
  if (booted) return
  booted = true
  void (async () => {
    await harness.sweep()
    await harness.seed()
  })()
}
export const bootHarness = (): void => {
  if (typeof window === 'undefined') return
  const started = Date.now()
  const tick = (): void => {
    if (booted) return
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (store?.getPool) { bootOnce(); return }
    if (Date.now() - started > BOOT_GIVE_UP_MS) return
    setTimeout(tick, BOOT_POLL_MS)
  }
  tick()
}
