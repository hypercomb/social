// commands/utterance/spoken-habits.ts
//
// SPOKEN HABITS — the line learns the words YOU actually use.
//
// The reader's lexicon is the census: every behaviour, spelled the one way its
// queen declares it. That is the shared tongue and it never bends to suit one
// participant. This is the other half, the private one. When an utterance
// RUNS, the phrasing that carried it is kept: the filler that led into an
// action is recorded against the behaviour it reached, so the next time you
// begin the same way, the ending you chose is already on offer.
//
//   say  "open providers"   →  `providers` runs; "open" was filler
//   later, type "open "     →  "open providers" is a completion
//   and   type "op"         →  "open" is a completion — as plain TEXT
//
// That last row is the WORD, not a command. The words a participant leads
// with — open, show, display — are discovered the same way the phrasings
// are, and offering them back is what lets the sentence be built a word at a
// time instead of remembered whole. Accepting one writes the word and a
// space and runs NOTHING; the space is what turns the phrasings on, so the
// ending arrives on the very next keystroke.
//
// ONLY EXECUTION TEACHES. Typing does not. Browsing the catalogue does not. An
// ambiguity you backed out of does not. A habit is evidence the participant
// wanted it that way, and that is the whole thing that makes an adaptive list
// safe to have: nothing enters it that was not deliberately run, so nothing
// has to be un-learned that was not deliberately done. `forget` empties it,
// wholesale or one lead-in at a time.
//
// Connectives are never lead-ins. "spotlight the snacks and fit" would
// otherwise teach that "and" leads to `fit`, which is true of the sentence and
// useless as a habit — the word carries no intent, it just joins.
//
// HABITS TRAVEL WITH THE PARTICIPANT. They live in the `sign('habits:spoken')`
// pool of meaning as one content-addressed document, so they move with the
// hive rather than with the browser — a habit that did not follow you to your
// other machine was not a habit. localStorage still holds a mirror, but only
// as a BOOT CACHE: completions are read from a synchronous computed signal and
// cannot wait on an OPFS round trip, so the cache answers the first keystroke
// and the pool answers for the participant.
//
// The two are reconciled by MERGE, never by overwrite. Counts and timestamps
// take the max of both sides, which makes hydration idempotent (re-reading the
// same record changes nothing) and makes two machines converge instead of one
// silently erasing the other's afternoon.

import { CONNECTIVES } from './utterance-reading.js'
import type { UtteranceReading } from './utterance-reading.js'

/** The pool this participant's habits live in. Colon-scoped, as every new
 *  pool meaning must be — a bare word could collide with a tile's own
 *  lineage bag at the root. Seeded in core's pool-registry so every root
 *  walker knows the address is a pool and never prunes it as a bag. */
const HABITS_POOL = 'habits:spoken'

/** Boot cache only — the pool is the truth. */
const STORAGE_KEY = 'hc:spoken-habits'

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

/** Writes are coalesced — a burst of utterances is one pool write, not one
 *  per word. Short enough that closing the tab after a command keeps it. */
const POOL_WRITE_DEBOUNCE_MS = 1200

/** A lead-in longer than this is a sentence, not a habit — it would never be
 *  retyped identically, so it would never fire and would only crowd the file. */
const MAX_LEAD_IN_WORDS = 4

/** Habits are a convenience, not a record. The least-used, least-recent fall
 *  off the end rather than growing localStorage without bound. */
const MAX_HABITS = 200

export interface SpokenHabit {
  /** The filler run immediately before the action, lowercased. `open` */
  readonly leadIn: string
  /** The behaviour it reached. `providers` */
  readonly command: string
  /** Times this exact phrasing was RUN — never merely typed. */
  count: number
  /** Last run, epoch ms. Recency breaks count ties and drives eviction. */
  at: number
}

export interface HabitPhrasing {
  /** What the dropdown offers, and what the line becomes: `open providers`. */
  readonly phrasing: string
  readonly command: string
  readonly count: number
}

export interface LeadInCompletion {
  /** The discovered word itself, exactly as it is said: `open`, `bring up`. */
  readonly leadIn: string
  /** The ending it most often reaches — what the row admits it leads to. */
  readonly command: string
  /** Runs across every ending this lead-in has ever carried. */
  readonly count: number
}

interface Stored {
  habits: SpokenHabit[]
  /** How often each behaviour was run, however it was said. Ranks the
   *  ordinary catalogue so the behaviours you live in rise to the top. */
  uses: Record<string, { count: number; at: number }>
}

const EMPTY: Stored = { habits: [], uses: {} }

/** One space between words, no edge whitespace — so "open   " and "open" are
 *  the same lead-in and the same key. */
const collapse = (s: string): string => s.trim().replace(/\s+/g, ' ')

export class SpokenHabits {
  #state: Stored = EMPTY
  #writeTimer: ReturnType<typeof setTimeout> | null = null
  #hydrated = false

  constructor() {
    // The cache answers instantly so the first keystroke after a reload
    // already has habits; the pool then merges in behind it.
    this.#state = this.#load()

    // BOOT ORDER. This module self-registers at import time, and on a cold
    // shell the Store is not in IoC yet — a straight hydrate() there finds no
    // store, returns, and the participant's pooled habits never arrive. The
    // cache hides it on the machine that wrote them and only the OTHER
    // machine, the one this feature exists for, comes up empty. So: try now
    // (a warm shell is already wired), and otherwise wait to be told.
    const ioc = (window as unknown as {
      ioc?: { get?: (k: string) => unknown; whenReady?: (k: string, cb: (v: unknown) => void) => void }
    }).ioc
    if (ioc?.get?.('@hypercomb.social/Store')) void this.#hydrateWhenPossible()
    else ioc?.whenReady?.('@hypercomb.social/Store', () => { void this.#hydrateWhenPossible() })
  }

  /**
   * Keep trying until the pool actually answers.
   *
   * Being in IoC is not the same as being READY: at boot the Store is
   * registered before its OPFS root is, so `getPool` comes back null and a
   * one-shot hydrate gives up — silently, because a missing pool is also what
   * a first-ever run looks like. The machine that wrote the habits never
   * noticed (its cache had them); the machine that needed them came up empty,
   * which is precisely the case this feature exists for. So retry, backing
   * off, and stop the moment the pool answers.
   */
  async #hydrateWhenPossible(): Promise<void> {
    for (let attempt = 0; attempt < 12 && !this.#hydrated; attempt++) {
      await this.hydrate()
      if (this.#hydrated) return
      await new Promise(r => setTimeout(r, 250 * Math.min(attempt + 1, 8)))
    }
  }

  /**
   * Merge the participant's pooled habits into memory, then write the union
   * back. Idempotent — max-merge means running it twice is running it once.
   * Awaited by the spec; fired and forgotten at construction, because nothing
   * on the completion path may block on OPFS.
   */
  async hydrate(): Promise<void> {
    const s = store()
    if (!s) return
    try {
      const pool = await s.getPool(HABITS_POOL)
      if (!pool) return
      const buf = await s.getPoolDoc(pool)
      if (buf) this.#merge(JSON.parse(new TextDecoder().decode(buf)) as Partial<Stored>)
      this.#hydrated = true
      // Push the union back so the other machine sees this one's afternoon.
      await this.#writePool()
    } catch { /* an unreadable pool costs the travel, never the habits */ }
  }

  /** Max-merge: the higher count and the later timestamp win on both sides,
   *  so neither machine can erase the other and re-reading changes nothing. */
  #merge(incoming: Partial<Stored>): void {
    for (const h of Array.isArray(incoming.habits) ? incoming.habits : []) {
      if (!h?.leadIn || !h.command) continue
      const mine = this.#state.habits.find(x => x.leadIn === h.leadIn && x.command === h.command)
      if (mine) { mine.count = Math.max(mine.count, h.count ?? 0); mine.at = Math.max(mine.at, h.at ?? 0) }
      else this.#state.habits.push({ leadIn: h.leadIn, command: h.command, count: h.count ?? 1, at: h.at ?? 0 })
    }
    const uses = incoming.uses && typeof incoming.uses === 'object' ? incoming.uses : {}
    for (const [command, u] of Object.entries(uses)) {
      const mine = this.#state.uses[command]
      this.#state.uses[command] = mine
        ? { count: Math.max(mine.count, u?.count ?? 0), at: Math.max(mine.at, u?.at ?? 0) }
        : { count: u?.count ?? 0, at: u?.at ?? 0 }
    }
    this.#evict()
    this.#writeCache()
  }

  async #writePool(): Promise<void> {
    const s = store()
    if (!s) return
    try {
      const pool = await s.getPool(HABITS_POOL)
      if (!pool) return
      const bytes = new TextEncoder().encode(JSON.stringify(this.#state)).buffer
      await s.putPoolDoc(pool, bytes)
    } catch { /* the cache still holds it; the next write will try again */ }
  }

  /** Coalesce a burst of learning into one pool write. */
  #schedulePoolWrite(): void {
    // No store (a spec, a shell still booting) — the cache already holds it
    // and hydrate() will push on the next run. Never leave a timer behind.
    if (!store()) return
    if (this.#writeTimer) clearTimeout(this.#writeTimer)
    this.#writeTimer = setTimeout(() => {
      this.#writeTimer = null
      void this.#writePool()
    }, POOL_WRITE_DEBOUNCE_MS)
  }

  /** Persist now rather than on the timer — used by the spec, and by any
   *  caller that must not lose the write. */
  async flush(): Promise<void> {
    if (this.#writeTimer) { clearTimeout(this.#writeTimer); this.#writeTimer = null }
    await this.#writePool()
  }

  /** True once the participant's pooled habits have been folded in. */
  get hydrated(): boolean { return this.#hydrated }

  #load(): Stored {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (!raw || typeof raw !== 'object') return { habits: [], uses: {} }
      const s = raw as Partial<Stored>
      return {
        habits: Array.isArray(s.habits) ? s.habits.filter(h => h && h.leadIn && h.command) : [],
        uses: s.uses && typeof s.uses === 'object' ? s.uses : {},
      }
    } catch { return { habits: [], uses: {} } }
  }

  /** The boot cache — written on every change so a reload is instant. */
  #writeCache(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#state)) }
    catch { /* a full or blocked store costs a habit, never a command */ }
  }

  /** Both halves: the cache now, the participant's pool shortly. */
  #save(): void {
    this.#writeCache()
    this.#schedulePoolWrite()
  }

  /**
   * Learn from an utterance that HAS RUN. Called after execution, never
   * before — see the header. Safe to call with any reading; a reading with no
   * actions teaches nothing.
   */
  learn(reading: UtteranceReading, at: number = Date.now()): void {
    const spans = reading.spans
    let touched = false

    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]
      if (span.role !== 'action' || !span.command) continue

      // Every run counts toward the behaviour's own weight, phrasing or not.
      const use = this.#state.uses[span.command] ?? { count: 0, at }
      use.count += 1
      use.at = at
      this.#state.uses[span.command] = use
      touched = true

      // The contiguous filler run immediately before this action IS the
      // lead-in. Anything further back belongs to an earlier action.
      const words: string[] = []
      for (let j = i - 1; j >= 0 && spans[j].role === 'residue'; j--) words.unshift(spans[j].text)

      // Connectives join, they do not lead — drop them from both edges.
      while (words.length && CONNECTIVES.has(words[0].toLowerCase())) words.shift()
      while (words.length && CONNECTIVES.has(words[words.length - 1].toLowerCase())) words.pop()
      if (!words.length || words.length > MAX_LEAD_IN_WORDS) continue

      const leadIn = collapse(words.join(' ')).toLowerCase()
      if (!leadIn) continue

      const existing = this.#state.habits.find(h => h.leadIn === leadIn && h.command === span.command)
      if (existing) { existing.count += 1; existing.at = at }
      else this.#state.habits.push({ leadIn, command: span.command, count: 1, at })
    }

    if (!touched) return
    this.#evict()
    this.#save()
  }

  /** Least-used, least-recent fall off the end. */
  #evict(): void {
    if (this.#state.habits.length <= MAX_HABITS) return
    this.#state.habits.sort((a, b) => b.count - a.count || b.at - a.at)
    this.#state.habits.length = MAX_HABITS
  }

  /**
   * Learned phrasings that begin with `fragment`, best first.
   *
   * Only ever consulted once the fragment holds a SPACE — a bare word is a
   * behaviour name being typed and belongs to the census, not to habit. That
   * keeps the ordinary catalogue exactly as it was and makes habits strictly
   * additive: they appear where nothing was on offer before.
   */
  phrasings(fragment: string): readonly HabitPhrasing[] {
    // The "is this a sentence yet?" test reads the RAW fragment. Collapsing
    // first would eat the trailing space of "open " and read it as the bare
    // word "open" — the exact moment habits are supposed to speak.
    if (!/\s/.test(fragment)) return []
    const q = collapse(fragment).toLowerCase()
    if (!q) return []
    // A trailing space is meaningful ("open " wants every ending), but
    // collapse() has eaten it — so match against the phrasing with its own
    // separator restored, and "open" reaches "open providers".
    const wantsAll = /\s$/.test(fragment)
    return this.#state.habits
      .map(h => ({ phrasing: `${h.leadIn} ${h.command}`, command: h.command, count: h.count, at: h.at }))
      .filter(p => (wantsAll ? p.phrasing.startsWith(q + ' ') || p.phrasing === q : p.phrasing.startsWith(q)))
      .sort((a, b) => b.count - a.count || b.at - a.at || a.phrasing.localeCompare(b.phrasing))
      .map(({ phrasing, command, count }) => ({ phrasing, command, count }))
  }

  /**
   * Discovered WORDS beginning with `fragment` — `op` → `open`, `sh` → `show`.
   *
   * {@link phrasings} answers once the line has become a sentence; this
   * answers before it has. A bare fragment is normally a behaviour name being
   * typed, so these rows are strictly ADDITIVE — the shell offers them after
   * the census and drops any word a real behaviour already spells — and
   * accepting one completes AS PLAIN TEXT: the word and a space, nothing run.
   * The ending then follows from `phrasings()`, which is exactly what the
   * space turns on. `op` → `open ` → `open providers`.
   *
   * A fragment holding a space is a sentence and belongs to `phrasings`; an
   * empty one is the whole catalogue Ctrl+Space asked for, and your filler is
   * not part of that. Both answer nothing.
   */
  leadInCompletions(fragment: string): readonly LeadInCompletion[] {
    if (/\s/.test(fragment)) return []
    const q = collapse(fragment).toLowerCase()
    if (!q) return []

    // One row per word, however many endings it carries — the row is the
    // WORD, so its weight is every run that ever went through it and the
    // ending it names is the one it reaches most.
    const grouped = new Map<string, SpokenHabit[]>()
    for (const h of this.#state.habits) {
      if (!h.leadIn.startsWith(q)) continue
      const held = grouped.get(h.leadIn)
      if (held) held.push(h)
      else grouped.set(h.leadIn, [h])
    }

    return [...grouped.entries()]
      .map(([leadIn, held]) => {
        const best = [...held].sort((a, b) => b.count - a.count || b.at - a.at)[0]
        return {
          leadIn,
          command: best.command,
          count: held.reduce((n, h) => n + h.count, 0),
          at: held.reduce((t, h) => Math.max(t, h.at), 0),
        }
      })
      .sort((a, b) => b.count - a.count || b.at - a.at || a.leadIn.localeCompare(b.leadIn))
      .map(({ leadIn, command, count }) => ({ leadIn, command, count }))
  }

  /** How often a behaviour has been run — the ranking weight for the
   *  ordinary catalogue. Unknown behaviour → 0, never a special case. */
  useCount(command: string): number {
    return this.#state.uses[command]?.count ?? 0
  }

  /**
   * Drop ONE phrasing — the row you are looking at, by the text it shows.
   *
   * This is the prune that matters in practice. A lead-in can carry several
   * endings, and a list you can only empty wholesale is one you stop trusting
   * the moment a single bad guess gets into it: the completion you did not
   * want reappears on every keystroke and the only cure removes the ones you
   * did. Shift+Delete on the highlighted row lands here.
   *
   * Returns true when something was actually dropped.
   */
  forgetPhrasing(phrasing: string): boolean {
    const key = collapse(phrasing).toLowerCase()
    const before = this.#state.habits.length
    this.#state.habits = this.#state.habits.filter(h => `${h.leadIn} ${h.command}` !== key)
    if (this.#state.habits.length === before) return false
    this.#save()
    return true
  }

  /** Every lead-in currently held, best first — what `forget` lists. */
  leadIns(): readonly string[] {
    return [...new Set(
      [...this.#state.habits]
        .sort((a, b) => b.count - a.count || b.at - a.at)
        .map(h => h.leadIn),
    )]
  }

  /**
   * Wipe. With a lead-in, only that one; with nothing, all of it — including
   * the use weights, because "forget how I talk" that left the ranking behind
   * would not be forgetting. Returns how many habits were dropped.
   */
  forget(leadIn?: string): number {
    const before = this.#state.habits.length
    if (leadIn && collapse(leadIn)) {
      const key = collapse(leadIn).toLowerCase()
      this.#state.habits = this.#state.habits.filter(h => h.leadIn !== key)
    } else {
      this.#state.habits = []
      this.#state.uses = {}
    }
    this.#save()
    return before - this.#state.habits.length
  }
}

window.ioc?.register?.('@diamondcoreprocessor.com/SpokenHabits', new SpokenHabits())
