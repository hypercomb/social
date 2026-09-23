// hypercomb-shared/ui/command-line/word-arrival.ts
//
// A WORD CAN BE ON ITS WAY. Since step 6 of the atomic-modules plan every word
// is a bee (documentation/atomic-modules-plan.md), and a bee registers its word
// only once it has loaded — most of them after the first paint. So for a moment
// after every reload the census answers "no such word" for words that are
// merely still arriving — and the census (slash-behaviour.drone.ts) is itself a
// bee, so for a while there is no census at all. The command line took the miss
// as final: `module commit …`, said over the bridge right after a reload while
// the module bee was still loading (2026-09-23, scripts/verify-hive-publish.cjs),
// fell through to the create default and became a tile named after the line.
//
// A miss is final only once the loader has settled. Until then a line whose
// lead word nothing claims yet WAITS — for the word to register, for the loader
// to say it has settled (`loader:bees-done`, the announcement MixedGroupBag
// already waits on), or for the patience to run out — and is then decided
// again, through the door it came in by, exactly as if it had been said a
// moment later. A word nothing claims after that is genuinely unknown and does
// what an unknown word always did: plain text still makes a tile.
//
// Nothing here knows any word. The census stays the one answer to "is this a
// word"; this only asks it again when there is something new to ask.

import { EffectBus } from '@hypercomb/core'

/** How long after the loader starts a line may wait for its word. Bounds the
 *  case where the loader never says it settled (a package with no bees, a late
 *  pulse that never returns): past this, a miss is final again. */
export const WORD_PATIENCE_MS = 20_000

const CENSUS_KEY = '@diamondcoreprocessor.com/SlashBehaviourDrone'

/** The shape of a behaviour name: letters and digits, hyphens inside. */
const WORD_RE = /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u

/**
 * The word a line leads with — the name a behaviour would answer to — or ''
 * when the line opens in a register of its own: a sigil (`[ ~ # ? > . @`), a
 * call or a tag (`name@view`, `name:tag`), a URL. Those never look a word up,
 * so they never wait for one. One leading slash is the command register and is
 * read through; trailing punctuation falls away, as the reader drops it.
 */
export function leadWordOf(line: string): string {
  const head = line.trimStart().replace(/^\//, '').split(/[\s([]/, 1)[0] ?? ''
  const word = head.replace(/[^\p{L}\p{N}-]+$/u, '').toLowerCase()
  return WORD_RE.test(word) ? word : ''
}

type BusLike = { on<T>(effect: string, handler: (payload: T) => void): () => void }
type IocLike = {
  get?(key: string): unknown
  onRegister?(cb: (key: string, value: unknown) => void): () => void
}

export interface WordArrivalOptions {
  readonly bus?: BusLike
  readonly ioc?: () => IocLike | undefined
  readonly now?: () => number
  readonly patienceMs?: number
}

export class WordArrival {
  readonly #ioc: () => IocLike | undefined
  readonly #now: () => number
  readonly #patienceMs: number
  readonly #waiting = new Set<() => void>()
  readonly #off: (() => void)[] = []
  #settled = false
  #since: number
  #disposed = false

  constructor(options: WordArrivalOptions = {}) {
    const bus = options.bus ?? EffectBus
    this.#ioc = options.ioc ?? ((): IocLike | undefined => (globalThis as { ioc?: IocLike }).ioc)
    this.#now = options.now ?? ((): number => performance.now())
    this.#patienceMs = options.patienceMs ?? WORD_PATIENCE_MS
    this.#since = this.#now()
    // Subscribed in the order the loader emits them. Last values replay on
    // subscribe, so a command line built after a wave began — or after it
    // settled — starts in the state that wave left.
    this.#off.push(bus.on('loader:bees-progress', () => {
      this.#settled = false
      this.#since = this.#now()
    }))
    this.#off.push(bus.on('loader:bees-done', () => {
      this.#settled = true
      this.#wake()
    }))
  }

  /**
   * True while `word` may still register: bees are still loading, the patience
   * has not run out, and nothing claims the word yet — the census itself is a
   * bee, so its absence claims nothing. `through` names the services a door
   * reads the word through (remote prose goes through the utterance reader):
   * until they have registered too, that door does not know the word.
   */
  mayStillArrive(word: string, through: readonly string[] = []): boolean {
    if (this.#disposed || this.#settled || !WORD_RE.test(word)) return false
    if (this.#now() - this.#since >= this.#patienceMs) return false
    const ioc = this.#ioc()
    const census = ioc?.get?.(CENSUS_KEY) as { has?(name: string): boolean } | undefined
    return census?.has?.(word) !== true || through.some(key => ioc?.get?.(key) === undefined)
  }

  /**
   * Resolves once `word` may be decided: it registered, the loader settled, or
   * the patience ran out. Resolves `false` only when this was disposed first —
   * the command line is gone, and nothing should run on its behalf.
   */
  arrival(word: string, through: readonly string[] = []): Promise<boolean> {
    if (!this.mayStillArrive(word, through)) return Promise.resolve(!this.#disposed)
    return new Promise<boolean>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let offRegister: (() => void) | undefined
      const check = (): void => {
        if (this.mayStillArrive(word, through)) return
        this.#waiting.delete(check)
        offRegister?.()
        clearTimeout(timer)
        resolve(!this.#disposed)
      }
      // The patience runs from the loader's start, which a new wave moves, so
      // the timer re-arms instead of trusting its first deadline.
      const arm = (): void => {
        const left = this.#patienceMs - (this.#now() - this.#since)
        timer = setTimeout(() => {
          check()
          if (this.#waiting.has(check)) arm()
        }, Math.max(0, left) + 1)
      }
      this.#waiting.add(check)
      // A queen joins the census from its own onRegister listener, so ask on
      // the next microtask — after every listener of this registration ran.
      offRegister = this.#ioc()?.onRegister?.(() => queueMicrotask(check))
      arm()
    })
  }

  /** Stop listening, and let every waiting line go without running. */
  dispose(): void {
    this.#disposed = true
    for (const off of this.#off.splice(0)) off()
    this.#wake()
  }

  #wake(): void {
    for (const check of [...this.#waiting]) check()
  }
}
