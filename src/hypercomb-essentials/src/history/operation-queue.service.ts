// history/operation-queue.service.ts — every structural act waits its turn.
//
// jwize, 2026-11-04: "we always just put the eggs in and put the operation in
// a queue so that the stuff is durable and we don't cross paths. If a move or
// operation finds conflicting difference it should cancel and say the tile
// was already moved. The context should always be immediate at click time
// entered into the queue so nothing about the structure is lost."
//
// So an operation is captured WHOLE at the click — where it was made, which
// tiles it names, and the signature each of those tiles had at that moment —
// and written down before it runs. Then it waits on ONE lane that every
// structural act shares (moves, re-seats, adopt folds), so no two of them
// ever interleave their read-and-write. When its turn comes it compares what
// it captured with what is live; any difference means someone else got there
// first, and the act CANCELS whole and says so. Nothing is half-applied.
//
// Durable: the owed operations live in a pool of meaning, so a reload replays
// them. A replay of an act that already landed (the page closed between the
// write and the bookkeeping) finds its tiles gone from where it captured them
// and cancels — the conflict check is what makes a replay safe.
//
// Participant-local INTENT, never truth: nothing references this pool, and
// losing it costs a re-click.

const OPERATIONS_POOL = 'operations:queue'

/** What a tile looked like at the click: its signature, or '' when only its
 *  presence was known (a re-seat names tiles by what is on screen). */
export type Expectation = Readonly<Record<string, string>>

export interface QueuedOperation {
  id: string
  kind: string
  /** The page the act was made on, bound at the click. */
  at: readonly string[]
  /** The tiles it names and what each was at the click. */
  expect: Expectation
  /** Everything else the act needs to run again from cold. JSON only. */
  args: unknown
  /** Epoch ms of the click. */
  madeAt: number
}

/** The tiles whose live state differs from what the click captured — gone
 *  from the page, or a different tile now wearing the name. */
export const conflictsOf = (expect: Expectation, live: ReadonlyMap<string, string | undefined>): string[] => {
  const out: string[] = []
  for (const [label, sig] of Object.entries(expect)) {
    if (!live.has(label)) { out.push(label); continue }
    if (sig && live.get(label) && live.get(label) !== sig) out.push(label)
  }
  return out
}

/** A handler runs one operation of its kind on the lane. It returns whatever
 *  the caller awaits; a replay after a reload has no caller. */
export type OperationHandler = (op: QueuedOperation) => Promise<unknown>

type PoolStore = {
  getPool(meaning: string): Promise<FileSystemDirectoryHandle | null>
  getPoolDoc(pool: FileSystemDirectoryHandle, subKey?: string): Promise<ArrayBuffer | null>
  putPoolDoc(pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }): Promise<string | null>
}

export class OperationQueue extends EventTarget {

  #pending: QueuedOperation[] = []
  #handlers = new Map<string, OperationHandler>()
  #lane: Promise<unknown> = Promise.resolve()
  #seq = 0
  #hydrated = false
  /** Ops read back from the pool whose kind has no handler yet. */
  #waiting: QueuedOperation[] = []

  get pending(): readonly QueuedOperation[] { return this.#pending }

  /** Run `task` on the shared lane, after everything already waiting. Every
   *  structural act goes through here so none of them ever crosses another.
   *  A task must never wait on the lane itself — that would wait forever. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const ran = this.#lane.then(task)
    this.#lane = ran.then(() => undefined, () => undefined)
    return ran
  }

  /** Say how an operation of `kind` runs. Ops of that kind left over from an
   *  earlier session are replayed now, in the order they were made. */
  handle(kind: string, handler: OperationHandler): void {
    this.#handlers.set(kind, handler)
    void this.#hydrate().then(() => {
      const mine = this.#waiting.filter(op => op.kind === kind)
      this.#waiting = this.#waiting.filter(op => op.kind !== kind)
      for (const op of mine) void this.#runOwed(op).catch(() => undefined)
    })
  }

  /** Write the act down, then run it on the lane. Resolves with the
   *  handler's answer once it has run. */
  async submit<T>(kind: string, at: readonly string[], expect: Expectation, args: unknown): Promise<T> {
    if (!this.#handlers.has(kind)) throw new Error(`[operation-queue] no handler for "${kind}"`)
    const op: QueuedOperation = {
      id: `${Date.now().toString(36)}-${(++this.#seq).toString(36)}`,
      kind,
      at: [...at],
      expect: { ...expect },
      args,
      madeAt: Date.now(),
    }
    this.#pending.push(op)
    this.#changed()
    void this.#persist()
    return this.#runOwed(op) as Promise<T>
  }

  #runOwed(op: QueuedOperation): Promise<unknown> {
    const handler = this.#handlers.get(op.kind)!
    return this.run(async () => {
      try { return await handler(op) }
      finally {
        this.#pending = this.#pending.filter(p => p.id !== op.id)
        this.#changed()
        void this.#persist()
      }
    })
  }

  #changed(): void { this.dispatchEvent(new CustomEvent('change')) }

  #store(): PoolStore | undefined {
    return (window as any).ioc?.get?.('@hypercomb.social/Store') as PoolStore | undefined
  }

  /** Read the owed ops once. Retried briefly: the store comes up after the
   *  first bees register. */
  #hydrating: Promise<void> | null = null
  #hydrate(): Promise<void> {
    this.#hydrating ??= this.#read()
    return this.#hydrating
  }

  async #read(): Promise<void> {
    // Not before the hive is up: a store that answers before its storage is
    // open reads every pool as empty, and "nothing owed" would be a lie. The
    // processor's first pass means the store and the pages are live — which
    // a replayed move needs anyway. A late-loaded bee doesn't wait forever.
    await new Promise<void>(resolve => {
      const done = (): void => { window.removeEventListener('synchronize', done); resolve() }
      window.addEventListener('synchronize', done)
      setTimeout(done, 10_000)
    })
    for (let attempt = 0; attempt < 12 && !this.#hydrated; attempt++) {
      const store = this.#store()
      if (store?.getPool) {
        try {
          const pool = await store.getPool(OPERATIONS_POOL)
          const bytes = pool ? await store.getPoolDoc(pool) : null
          const read = bytes ? JSON.parse(new TextDecoder().decode(bytes)) : []
          const owed = (Array.isArray(read) ? read : []).filter(isOperation)
          const known = new Set(this.#pending.map(p => p.id))
          for (const op of owed) if (!known.has(op.id)) { this.#pending.push(op); this.#waiting.push(op) }
          this.#hydrated = true
          if (owed.length) this.#changed()
          return
        } catch { /* unreadable — the owed ops cost a re-click, never data */ this.#hydrated = true; return }
      }
      await new Promise(r => setTimeout(r, 250 * Math.min(attempt + 1, 8)))
    }
  }

  #writing: Promise<unknown> = Promise.resolve()

  #persist(): Promise<unknown> {
    const write = async (): Promise<void> => {
      // Never write before the owed ops are read: the write is the whole
      // list, and it would drop what an earlier session left owed.
      await this.#hydrate()
      const store = this.#store()
      if (!store?.getPool) return
      try {
        const pool = await store.getPool(OPERATIONS_POOL)
        if (!pool) return
        const bytes = new TextEncoder().encode(JSON.stringify(this.#pending))
        await store.putPoolDoc(pool, bytes.buffer as ArrayBuffer, undefined, { keep: 'current' })
      } catch (err) { console.warn('[operation-queue] could not write the owed operations', err) }
    }
    this.#writing = this.#writing.then(write, write)
    return this.#writing
  }
}

const isOperation = (value: unknown): value is QueuedOperation => {
  const op = value as QueuedOperation
  return !!op && typeof op.id === 'string' && typeof op.kind === 'string'
    && Array.isArray(op.at) && !!op.expect && typeof op.expect === 'object'
}

export const OPERATION_QUEUE_KEY = '@diamondcoreprocessor.com/OperationQueue'
