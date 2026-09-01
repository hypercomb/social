// commands/aliases/participant-aliases.ts
//
// PARTICIPANT ALIASES — the names YOU gave the behaviours.
//
// A behaviour has ONE name, its canonical `command`, and code never declares
// another (the doctrine ratchet in doctrine.spec.ts keeps alias declarations
// out of source for good). This is the other half of that doctrine: the seam
// the ratchet protects — `QueenBee.aliases`, `SlashBehaviour.aliases`, and
// all the fold/display plumbing — exists so the PARTICIPANT can give a
// behaviour their own names at runtime. This class is the giver's ledger.
//
// WHERE THEY LIVE. One content-addressed doc in the `sign('commands:aliases')`
// pool of meaning — colon-scoped per the known-location-pools doctrine, seeded
// in core's pool-registry so no root walker mistakes it for a lineage bag.
// A pool and not localStorage for the reason spoken habits next door are:
// a name that did not follow you to your other machine was not your name for
// it. localStorage still holds a mirror, but only as a BOOT CACHE — the
// census reads synchronously and cannot wait on an OPFS round trip.
//
// HOW TWO MACHINES AGREE. Newer entry wins, PER COMMAND. Habits merge by
// max-count because a habit is a tally; an alias set is a CHOICE, and a
// union-merge would resurrect every name you deliberately took away. So each
// command's entry carries the moment it was decided, and the later decision
// replaces the earlier one whole — removal sticks, and re-reading the same
// doc changes nothing.
//
// HOW THEY REACH THE LANGUAGE. Two seams, both already in place:
//   1. The queen instances — `queen.aliases` is a mutable array (readonly
//      binding, not frozen contents), and `applyToQueens()` rewrites it in
//      place. `QueenBee.matches()` (the common tongue's bare-word path) and
//      the auto-wrap provider (which captured the same array reference) both
//      follow for free.
//   2. The slash census — SlashBehaviourDrone folds `aliasesFor()` into every
//      name walk, which covers the manual providers no queen stands behind.

import { EffectBus } from '@hypercomb/core'

/** The pool this participant's given names live in. */
const ALIASES_POOL = 'commands:aliases'

/** Boot cache only — the pool is the truth. */
const STORAGE_KEY = 'hc:participant-aliases'

/** A name is a command-shaped word: what the bare-word path can run and the
 *  census can list. Anything else is refused with a reason, never mangled. */
const NAME_SHAPE = /^[a-z][a-z0-9-]*$/

type StoreLike = {
  getPool: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  putPoolDoc: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
  getPoolDoc: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
}

const store = (): StoreLike | undefined => {
  try {
    return (window as unknown as { ioc?: { get?: (k: string) => unknown } })
      .ioc?.get?.('@hypercomb.social/Store') as StoreLike | undefined
  } catch { return undefined }
}

/** Writes are coalesced — a flurry of picking in the panel is one pool
 *  write, not one per chip. */
const POOL_WRITE_DEBOUNCE_MS = 1200

/** command → the decision: which names, and when it was made. */
interface AliasEntry {
  names: string[]
  at: number
}

interface Stored {
  entries: Record<string, AliasEntry>
}

/** Why a name was refused — shown to the participant, never silent. */
export interface RefusedName {
  readonly name: string
  readonly reason: 'not-a-name' | 'is-the-command' | 'is-another-command' | 'taken'
}

export interface AliasSetResult {
  readonly kept: readonly string[]
  readonly refused: readonly RefusedName[]
}

/** A queen, as loosely as the auto-wrap sees one. */
interface QueenLike {
  command: string
  aliases?: unknown
  invoke: (args: string) => unknown
}

const isQueenLike = (value: unknown): value is QueenLike =>
  !!value
  && typeof (value as QueenLike).command === 'string'
  && typeof (value as QueenLike).invoke === 'function'

export class ParticipantAliases {
  #state: Stored = { entries: {} }
  #writeTimer: ReturnType<typeof setTimeout> | null = null
  #hydrated = false

  constructor() {
    this.#state = this.#load()
    this.applyToQueens()

    const ioc = (window as unknown as {
      ioc?: {
        get?: (k: string) => unknown
        whenReady?: (k: string, cb: (v: unknown) => void) => void
        onRegister?: (cb: (key: string, value: unknown) => void) => void
      }
    }).ioc

    // A queen that loads after this ledger still gets its given names —
    // the same late-arrival subscription the slash drone's auto-wrap keeps.
    ioc?.onRegister?.((_key, value) => { this.#applyToOne(value) })

    // BOOT ORDER — same lesson spoken-habits paid for: the Store may not be
    // in IoC yet, and being in IoC is not the same as being ready.
    if (ioc?.get?.('@hypercomb.social/Store')) void this.#hydrateWhenPossible()
    else ioc?.whenReady?.('@hypercomb.social/Store', () => { void this.#hydrateWhenPossible() })
  }

  async #hydrateWhenPossible(): Promise<void> {
    for (let attempt = 0; attempt < 12 && !this.#hydrated; attempt++) {
      await this.hydrate()
      if (this.#hydrated) return
      await new Promise(r => setTimeout(r, 250 * Math.min(attempt + 1, 8)))
    }
  }

  /** Fold the pooled doc in (newer entry per command wins), then push the
   *  union back so the other machine sees this one's decisions. */
  async hydrate(): Promise<void> {
    const s = store()
    if (!s) return
    try {
      const pool = await s.getPool(ALIASES_POOL)
      if (!pool) return
      const buf = await s.getPoolDoc(pool)
      if (buf) this.#merge(JSON.parse(new TextDecoder().decode(buf)) as Partial<Stored>)
      this.#hydrated = true
      await this.#writePool()
    } catch { /* an unreadable pool costs the travel, never the names */ }
  }

  /** NEWER ENTRY WINS, per command — an alias set is a choice, and a
   *  union-merge would resurrect every name deliberately taken away. */
  #merge(incoming: Partial<Stored>): void {
    const entries = incoming.entries && typeof incoming.entries === 'object' ? incoming.entries : {}
    let changed = false
    for (const [command, entry] of Object.entries(entries)) {
      if (!entry || !Array.isArray(entry.names)) continue
      const mine = this.#state.entries[command]
      if (mine && mine.at >= (entry.at ?? 0)) continue
      const names = entry.names.map(String).filter(n => NAME_SHAPE.test(n))
      if (names.length) this.#state.entries[command] = { names, at: entry.at ?? 0 }
      else delete this.#state.entries[command]
      changed = true
    }
    if (!changed) return
    this.#writeCache()
    this.applyToQueens()
    EffectBus.emit('aliases:changed', {})
  }

  get hydrated(): boolean { return this.#hydrated }

  /** The names this participant gave `command`. Empty when they gave none. */
  aliasesFor(command: string): readonly string[] {
    return this.#state.entries[String(command ?? '').toLowerCase()]?.names ?? []
  }

  /** Every christening held: command → names. Snapshot — do not mutate. */
  all(): ReadonlyMap<string, readonly string[]> {
    return new Map(Object.entries(this.#state.entries).map(([c, e]) => [c, e.names]))
  }

  /**
   * Decide `command`'s names — the whole set at once, replacing what stood.
   * An empty list is a real decision too: it takes every given name away.
   *
   * Each name is checked, and a refusal carries its reason: a name that is
   * not command-shaped, the command's own name (that one is not the
   * participant's to give or take), another behaviour's canonical name
   * (it would shadow a verb someone can already say), or a name already
   * given to a different behaviour.
   */
  set(command: string, names: readonly string[], at: number = Date.now()): AliasSetResult {
    const canonical = String(command ?? '').trim().toLowerCase()
    const kept: string[] = []
    const refused: RefusedName[] = []
    const commands = this.#canonicalNames()

    for (const raw of names) {
      const name = String(raw ?? '').trim().toLowerCase().replace(/^\//, '')
      if (!name || kept.includes(name)) continue
      if (!NAME_SHAPE.test(name)) { refused.push({ name, reason: 'not-a-name' }); continue }
      if (name === canonical) { refused.push({ name, reason: 'is-the-command' }); continue }
      if (commands.has(name)) { refused.push({ name, reason: 'is-another-command' }); continue }
      const owner = this.#ownerOf(name)
      if (owner && owner !== canonical) { refused.push({ name, reason: 'taken' }); continue }
      kept.push(name)
    }

    if (kept.length) this.#state.entries[canonical] = { names: kept, at }
    else delete this.#state.entries[canonical]

    this.#writeCache()
    this.#schedulePoolWrite()
    this.applyToQueens()
    EffectBus.emit('aliases:changed', {})
    return { kept, refused }
  }

  /** Which behaviour already answers to `name`, if any. */
  #ownerOf(name: string): string | undefined {
    for (const [command, entry] of Object.entries(this.#state.entries)) {
      if (entry.names.includes(name)) return command
    }
    return undefined
  }

  /** Every canonical command live right now — what a given name must not
   *  shadow. Read from the census when it is up, from the queens otherwise. */
  #canonicalNames(): ReadonlySet<string> {
    const names = new Set<string>()
    const ioc = (window as unknown as {
      ioc?: { get?: (k: string) => unknown; list?: () => string[] }
    }).ioc
    const drone = ioc?.get?.('@diamondcoreprocessor.com/SlashBehaviourDrone') as
      { entries?: () => { name: string }[] } | undefined
    for (const entry of drone?.entries?.() ?? []) names.add(entry.name.toLowerCase())
    for (const key of ioc?.list?.() ?? []) {
      const held = ioc?.get?.(key)
      if (isQueenLike(held)) names.add(held.command.toLowerCase())
    }
    return names
  }

  // ── the queen seam ────────────────────────────────────────────────────────

  /** Rewrite every queen's `aliases` array IN PLACE to this ledger. The
   *  binding is readonly; the contents are the seam. The auto-wrap provider
   *  captured the same array reference, so it follows without being told. */
  applyToQueens(): void {
    const ioc = (window as unknown as {
      ioc?: { get?: (k: string) => unknown; list?: () => string[] }
    }).ioc
    for (const key of ioc?.list?.() ?? []) this.#applyToOne(ioc?.get?.(key))
  }

  #applyToOne(value: unknown): void {
    if (!isQueenLike(value) || !Array.isArray(value.aliases)) return
    const given = this.aliasesFor(value.command)
    const held = value.aliases as string[]
    if (held.length === given.length && given.every((n, i) => held[i] === n)) return
    held.length = 0
    held.push(...given)
  }

  // ── persistence ───────────────────────────────────────────────────────────

  async #writePool(): Promise<void> {
    const s = store()
    if (!s) return
    try {
      const pool = await s.getPool(ALIASES_POOL)
      if (!pool) return
      const bytes = new TextEncoder().encode(JSON.stringify(this.#state)).buffer
      await s.putPoolDoc(pool, bytes)
    } catch { /* the cache still holds it; the next write will try again */ }
  }

  #schedulePoolWrite(): void {
    if (!store()) return
    if (this.#writeTimer) clearTimeout(this.#writeTimer)
    this.#writeTimer = setTimeout(() => {
      this.#writeTimer = null
      void this.#writePool()
    }, POOL_WRITE_DEBOUNCE_MS)
  }

  /** Persist now rather than on the timer. */
  async flush(): Promise<void> {
    if (this.#writeTimer) { clearTimeout(this.#writeTimer); this.#writeTimer = null }
    await this.#writePool()
  }

  #load(): Stored {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (!raw || typeof raw !== 'object') return { entries: {} }
      const entries = (raw as Partial<Stored>).entries
      if (!entries || typeof entries !== 'object') return { entries: {} }
      const clean: Record<string, AliasEntry> = {}
      for (const [command, entry] of Object.entries(entries)) {
        if (!entry || !Array.isArray(entry.names)) continue
        const names = entry.names.map(String).filter(n => NAME_SHAPE.test(n))
        if (names.length) clean[command] = { names, at: Number(entry.at) || 0 }
      }
      return { entries: clean }
    } catch { return { entries: {} } }
  }

  #writeCache(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#state)) }
    catch { /* a full or blocked store costs the cache, never the pool */ }
  }
}

window.ioc?.register?.('@diamondcoreprocessor.com/ParticipantAliases', new ParticipantAliases())
