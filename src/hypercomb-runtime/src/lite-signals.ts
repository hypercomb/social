// hypercomb-runtime/src/lite-signals.ts
//
// ANGULAR'S SIGNALS, LITE (jwize, 2026-11-12: "port it to not be using
// angular the output should be exactly the same", "the user interface hasn't
// changed only the code running it", "you mean to support the native angular
// stuff but lite version sure"). The chat window's logic is written against
// Angular's `signal`, `computed`, `effect` and `untracked`; this answers those
// four calls with the same behaviour, so that logic moves off Angular as
// written. Only what the chat uses is here — no `equal:` option, no
// linkedSignal, no effect options — and nothing in core: code that does not
// import this pays nothing for it.
//
// The behaviour the ported code depends on (found by mapping the chat window):
//   (a) an effect's first run is DEFERRED, never inside construction — a field
//       initializer's effect may read a field declared further down;
//   (b) an effect may write signals (Angular 19+);
//   (c) every synchronous read during a run is tracked, including reads inside
//       methods the run calls;
//   (d) a computed is lazy, memoised, and compares with Object.is;
//   (e) effects are batched and run once per flush, before views are
//       refreshed; views refresh after effects; after-render hooks run last.
//
// Disposal: an effect created while an OWNER is current belongs to it, and
// `owner.dispose()` destroys them all (Angular's DestroyRef, for a component).

export type Signal<T> = (() => T) & { readonly [SIGNAL]: true }
export type WritableSignal<T> = Signal<T> & {
  set(value: T): void
  update(fn: (value: T) => T): void
  asReadonly(): Signal<T>
}
export type EffectRef = { destroy(): void }

const SIGNAL = Symbol('signal')

// ── the graph ───────────────────────────────────────────────────────

/** Something read: a signal or a computed. */
type Producer = { version: number; consumers: Set<Consumer>; refresh?: () => void }
/** Something that reads: a computed, an effect or a view. */
type Consumer = { deps: Map<Producer, number>; notify(): void }

type Tracking = { current: Consumer | null }
type Queue = { jobs: Job[]; scheduled: boolean; flushing: boolean; justFlushed: boolean }
type Job = { priority: number; run(): void; queued: boolean; dead: boolean }

// PINNED ON globalThis, as window-session.ts and EffectBus are: the runtime is
// compiled into the Angular shell from source and bundled again into the shim,
// and a read in one copy must be seen by a run in the other.
const shared = ((globalThis as { __hypercombLiteSignals?: { tracking: Tracking; queue: Queue; owner: { current: Owner | null } } })
  .__hypercombLiteSignals ??= { tracking: { current: null }, queue: { jobs: [], scheduled: false, flushing: false, justFlushed: false }, owner: { current: null } })
const tracking = shared.tracking
const queue = shared.queue

function track(producer: Producer): void {
  const consumer = tracking.current
  if (!consumer) return
  consumer.deps.set(producer, producer.version)
  producer.consumers.add(consumer)
}

function unlink(consumer: Consumer): void {
  for (const producer of consumer.deps.keys()) producer.consumers.delete(consumer)
  consumer.deps.clear()
}

function changed(producer: Producer): void {
  producer.version++
  for (const consumer of [...producer.consumers]) consumer.notify()
}

/** Run `fn` with `consumer` collecting what it reads; its old reads are dropped first. */
function collect<T>(consumer: Consumer, fn: () => T): T {
  unlink(consumer)
  const previous = tracking.current
  tracking.current = consumer
  try { return fn() } finally { tracking.current = previous }
}

/** Has anything this consumer read moved since it last ran? Computeds are refreshed on the way. */
function stale(consumer: Consumer): boolean {
  for (const [producer, seen] of consumer.deps) {
    producer.refresh?.()
    if (producer.version !== seen) return true
  }
  return false
}

// ── signal ──────────────────────────────────────────────────────────

export function signal<T>(initial: T): WritableSignal<T> {
  let value = initial
  const node: Producer = { version: 0, consumers: new Set() }
  const read = (() => { track(node); return value }) as WritableSignal<T>
  Object.defineProperty(read, SIGNAL, { value: true })
  read.set = (next: T) => {
    if (Object.is(next, value)) return
    value = next
    changed(node)
  }
  read.update = (fn: (value: T) => T) => read.set(fn(value))
  read.asReadonly = () => {
    const ro = (() => read()) as Signal<T>
    Object.defineProperty(ro, SIGNAL, { value: true })
    return ro
  }
  return read
}

// ── computed ────────────────────────────────────────────────────────

const UNSET = Symbol('unset')

export function computed<T>(fn: () => T): Signal<T> {
  let value: T | typeof UNSET = UNSET
  let error: unknown = null
  let dirty = true
  const node: Producer & Consumer = {
    version: 0,
    consumers: new Set(),
    deps: new Map(),
    // Told something it read changed: it may now be stale, and so may anyone reading it.
    notify() {
      if (dirty) return
      dirty = true
      for (const consumer of [...node.consumers]) consumer.notify()
    },
    // Pulled: recompute only if a read actually moved; bump the version only if the value did.
    refresh() {
      if (!dirty) return
      dirty = false
      if (value !== UNSET && !error && !stale(node)) return
      let next: T | typeof UNSET = UNSET
      let failed: unknown = null
      try { next = collect(node, fn) } catch (e) { failed = e }
      if (failed) { error = failed; value = UNSET; node.version++; return }
      const was = value
      error = null
      value = next
      if (was === UNSET || !Object.is(was, next)) node.version++
    },
  }
  const read = (() => {
    node.refresh!()
    track(node)
    if (error) throw error
    return value as T
  }) as Signal<T>
  Object.defineProperty(read, SIGNAL, { value: true })
  return read
}

// ── untracked ───────────────────────────────────────────────────────

export function untracked<T>(fn: () => T): T {
  const previous = tracking.current
  tracking.current = null
  try { return fn() } finally { tracking.current = previous }
}

// ── the scheduler ───────────────────────────────────────────────────

/** Effects run before views, views before after-render hooks (Angular's order). */
export const PRIORITY = { effect: 0, view: 1, afterRender: 2 } as const

function enqueue(job: Job): void {
  if (job.queued || job.dead) return
  job.queued = true
  queue.jobs.push(job)
  if (queue.scheduled || queue.flushing) return
  queue.scheduled = true
  schedule(flush)
}

/** WHEN a flush runs is Angular's zoneless rule, so focus and event timing
 *  match: normally a setTimeout / requestAnimationFrame race (a macrotask —
 *  code that queues a microtask after a write runs BEFORE the refresh); in the
 *  one microtask right after a flush, a microtask (Angular's
 *  switchToMicrotaskScheduler). */
function schedule(run: () => void): void {
  if (queue.justFlushed) { queueMicrotask(run); return }
  let done = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let frame: number | undefined
  const once = (): void => {
    if (done) return
    done = true
    if (timeout !== undefined) clearTimeout(timeout)
    if (frame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    run()
  }
  timeout = setTimeout(once)
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(once)
}

/** Run everything queued, lowest priority number first, until nothing is left.
 *  A job that queues more work (an effect writing a signal) is picked up in
 *  the same flush. A runaway loop is stopped rather than freezing the page. */
export function flush(): void {
  queue.scheduled = false
  if (queue.flushing) return
  queue.flushing = true
  let rounds = 0
  try {
    while (queue.jobs.length) {
      if (++rounds > 10_000) {
        console.error('[lite-signals] effects did not settle; stopped')
        // Dropped, not dead: each may be scheduled again by its next change.
        for (const dropped of queue.jobs) dropped.queued = false
        queue.jobs.length = 0
        break
      }
      let at = 0
      for (let i = 1; i < queue.jobs.length; i++) if (queue.jobs[i]!.priority < queue.jobs[at]!.priority) at = i
      const job = queue.jobs.splice(at, 1)[0]!
      job.queued = false
      if (job.dead) continue
      try { job.run() } catch (error) { console.error(error) }
    }
  } finally {
    queue.flushing = false
    queue.justFlushed = true
    queueMicrotask(() => { queue.justFlushed = false })
  }
}

// ── owners (DestroyRef) ─────────────────────────────────────────────

export type Owner = { run<T>(fn: () => T): T; add(dispose: () => void): void; dispose(): void; readonly disposed: boolean }

export function createOwner(): Owner {
  const disposers: (() => void)[] = []
  let disposed = false
  const owner: Owner = {
    get disposed() { return disposed },
    run<T>(fn: () => T): T {
      const previous = shared.owner.current
      shared.owner.current = owner
      try { return fn() } finally { shared.owner.current = previous }
    },
    add(dispose) { if (disposed) dispose(); else disposers.push(dispose) },
    dispose() {
      if (disposed) return
      disposed = true
      for (const dispose of disposers.splice(0).reverse()) { try { dispose() } catch (error) { console.error(error) } }
    },
  }
  return owner
}

/** The owner effects created right now belong to, if any. */
export const currentOwner = (): Owner | null => shared.owner.current

// ── effect ──────────────────────────────────────────────────────────

/** A consumer that reruns as a scheduled job when what it read changes. */
export function scheduled(fn: () => void, priority: number): EffectRef & { readonly consumer: Consumer } {
  let first = true
  const job: Job = {
    priority,
    queued: false,
    dead: false,
    run() {
      if (!first && !stale(consumer)) return
      first = false
      collect(consumer, fn)
    },
  }
  const consumer: Consumer = { deps: new Map(), notify: () => enqueue(job) }
  const ref = {
    consumer,
    destroy() { job.dead = true; unlink(consumer) },
  }
  enqueue(job)
  return ref
}

export function effect(fn: () => void): EffectRef {
  const ref = scheduled(fn, PRIORITY.effect)
  currentOwner()?.add(() => ref.destroy())
  return { destroy: () => ref.destroy() }
}

/** Run `fn` once, after the next view refresh (Angular's afterNextRender). Queueing it schedules a flush. */
export function afterNextRender(fn: () => void): void {
  let done = false
  const job: Job = { priority: PRIORITY.afterRender, queued: false, dead: false, run() { if (done) return; done = true; untracked(fn) } }
  currentOwner()?.add(() => { job.dead = true })
  enqueue(job)
}

/** True for anything made by signal() or computed(). */
export const isSignal = (value: unknown): value is Signal<unknown> =>
  typeof value === 'function' && (value as { [SIGNAL]?: boolean })[SIGNAL] === true
