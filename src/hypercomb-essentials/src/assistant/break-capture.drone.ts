// assistant/break-capture.drone.ts
//
// THE BREAK QUEUE'S WRITER — every client-side break goes into `breaks:queue`
// for the break repair loop (documentation/break-repair-loop.md).
//
// The shells put the listeners on first thing, so a break during boot is held
// (`window.__hcBreaks`) before this module exists. This module takes the buffer
// over and becomes the sink (`window.__hcBreak`). A shell that installs nothing
// gets the same listeners from here. The array is the flag: whichever side runs
// first installs the listeners, and never both.
//
// WARNINGS ride the same path one severity down: a console.warn that carries an
// Error is queued as a `warning`; one without is not — the tree warns in
// hundreds of places about conditions it expects. Warnings are fenced so they
// can never crowd out a break: they have their own, smaller budget of distinct
// warnings per page load, and a warning is written only while the queue still
// has the room reserved for breaks.
//
// Nothing here may break the page it is watching. Every path is caught, and
// writes are coalesced per break: the first lands a few seconds after it
// happens, and each later write for the SAME break waits twice as long as the
// one before, so a throw on every frame costs a record every fifteen minutes,
// not sixty a second. The queue is capped too — a hive nobody folds (a
// visitor's, say) holds a bounded amount of breakage, never an unbounded one.

import { appendBreak, describeBreak, fingerprintBreak, queuedCount, type BreakRecord, type BreakSample } from './breaks.js'

type BreakSink = (kind: string, detail: unknown, at: number) => void

interface Burst {
  readonly sample: BreakSample
  count: number
  firstAt: number
  lastAt: number
  dueAt: number
  delay: number
}

const FIRST_DELAY_MS = 5_000
const MAX_DELAY_MS = 15 * 60_000
/** A page that breaks in more distinct ways than this is reporting one
 *  underlying failure many times over; the first ones are the ones to read. */
const MAX_BREAKS = 200
/** Distinct warnings kept per page load — a budget of their own, so a noisy
 *  page cannot spend the breaks' share. */
const MAX_WARNINGS = 50
/** Records the queue may hold before new ones are dropped until a fold. */
const QUEUE_CAP = 500
/** A warning is written only while the queue holds fewer records than this,
 *  so breaks always keep the rest of the room. */
const WARNING_QUEUE_CAP = 200

const host = globalThis as typeof globalThis & { __hcBreaks?: unknown[]; __hcBreak?: BreakSink }

const session = typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
const sessionAt = Math.round(performance.timeOrigin)

const bursts = new Map<string, Burst>()
let warningBursts = 0
let timer: ReturnType<typeof setTimeout> | undefined
let timerAt = Infinity
let flushing = false
/** Room left in the queue — counted afresh by each flush that writes, then
 *  kept locally for the rest of that flush. A fold drains the queue without
 *  telling this page, so a count kept any longer goes stale and ends up
 *  refusing records the queue has room for. */
let room: number | undefined
/** A hide-time flush that arrived while another flush was running. It runs
 *  the moment that one ends, rather than being lost with the page. */
let flushAllPending = false

const schedule = (): void => {
  let soonest = Infinity
  for (const burst of bursts.values()) if (burst.count > 0 && burst.dueAt < soonest) soonest = burst.dueAt
  if (soonest >= timerAt) return
  if (timer !== undefined) clearTimeout(timer)
  timerAt = soonest
  if (soonest === Infinity) { timer = undefined; return }
  timer = setTimeout(() => { timer = undefined; timerAt = Infinity; void flush(false) }, Math.max(0, soonest - Date.now()))
}

const flush = async (all: boolean): Promise<void> => {
  if (flushing) { if (all) flushAllPending = true; return }
  flushing = true
  room = undefined
  try {
    const now = Date.now()
    for (const [fingerprint, burst] of bursts) {
      if (burst.count === 0 || (!all && burst.dueAt > now)) continue
      const count = burst.count
      // The room this severity may not dip below: a break may fill the queue,
      // a warning only its share.
      const floor = burst.sample.type === 'warning' ? QUEUE_CAP - WARNING_QUEUE_CAP : 0
      let written = false
      try {
        if (room === undefined) {
          const queued = await queuedCount()
          // null means the store is not up yet — never that the queue is full.
          if (queued !== null) room = QUEUE_CAP - queued
        }
        if (room !== undefined && room <= floor) {
          written = true // no room for this severity until a fold drains the queue: drop, and back off
        } else if (room !== undefined) {
          const record: BreakRecord = {
            kind: 'break@1', fingerprint, ...burst.sample,
            origin: location.origin, route: location.pathname,
            session, sessionAt, count, firstAt: burst.firstAt, lastAt: burst.lastAt,
          }
          written = await appendBreak(record)
          if (written) room--
          else room = undefined
        }
      } catch { room = undefined }
      burst.delay = Math.min(burst.delay * 2, MAX_DELAY_MS)
      burst.dueAt = now + burst.delay
      if (!written) continue
      burst.count -= count
      burst.firstAt = burst.lastAt
    }
  } finally {
    flushing = false
    if (flushAllPending) { flushAllPending = false; void flush(true) }
    else schedule()
  }
}

const isErrorObject = (value: unknown): value is object =>
  value instanceof Error || (
    !!value && typeof value === 'object'
    && typeof (value as { stack?: unknown }).stack === 'string'
    && typeof (value as { message?: unknown }).message === 'string'
  )

/** The Error objects already taken, by severity. One throw reaches two
 *  listeners in an Angular shell — the window `error` event AND the
 *  ErrorHandler reporting it through console.error — and that is one break,
 *  not two issues. A warning never hides a later break of the same Error:
 *  code that warned about an error and then let it throw has broken, and the
 *  break is the record that matters. */
const takenBreaks = new WeakSet<object>()
const takenWarnings = new WeakSet<object>()
/** The window error events already judged. Angular re-reports an event that
 *  carried no Error as a NEW Error whose cause is that event — identity catches
 *  the echo here, and describeBreak recognises its shape for the case where
 *  the event itself never reached this sink. */
const takenEvents = new WeakSet<object>()

const errorOf = (kind: string, detail: unknown): unknown =>
  kind === 'error' ? (detail as { error?: unknown } | null)?.error
    : kind === 'rejection' ? detail
      : Array.isArray(detail) ? detail.find(isErrorObject) : undefined

const take: BreakSink = (kind, detail, at) => {
  let sample: BreakSample | null = null
  try {
    if (kind === 'error' && detail && typeof detail === 'object') takenEvents.add(detail)
    const err = errorOf(kind, detail)
    if (isErrorObject(err)) {
      const cause = (err as { cause?: unknown }).cause
      if (kind !== 'error' && cause && typeof cause === 'object' && takenEvents.has(cause)) return
      if (kind === 'warned') {
        if (takenBreaks.has(err) || takenWarnings.has(err)) return
        takenWarnings.add(err)
      } else {
        if (takenBreaks.has(err)) return
        takenBreaks.add(err)
      }
    }
    sample = describeBreak(kind, detail)
  } catch { return }
  if (!sample) return
  const seen = sample
  const warning = seen.type === 'warning'
  void fingerprintBreak(seen).then(fingerprint => {
    const burst = bursts.get(fingerprint)
    if (burst) {
      if (burst.count === 0) burst.firstAt = at
      burst.count++
      burst.lastAt = Math.max(burst.lastAt, at)
    } else {
      if (warning ? warningBursts >= MAX_WARNINGS : bursts.size - warningBursts >= MAX_BREAKS) return
      if (warning) warningBursts++
      bursts.set(fingerprint, { sample: seen, count: 1, firstAt: at, lastAt: at, dueAt: at + FIRST_DELAY_MS, delay: FIRST_DELAY_MS })
    }
    schedule()
  }).catch(() => { /* the break path never breaks */ })
}

const install = (): void => {
  if (typeof window === 'undefined') return
  if (!Array.isArray(host.__hcBreaks)) {
    host.__hcBreaks = []
    const forward = (kind: string, detail: unknown): void => {
      try { host.__hcBreak?.(kind, detail, Date.now()) } catch { /* the break path never breaks */ }
    }
    window.addEventListener('error', event => forward('error', event), true)
    window.addEventListener('unhandledrejection', event => forward('rejection', event.reason))
    const report = console.error.bind(console)
    console.error = (...args: unknown[]) => { report(...args); forward('reported', args) }
    const warn = console.warn.bind(console)
    console.warn = (...args: unknown[]) => { warn(...args); forward('warned', args) }
  }
  host.__hcBreak = take
  for (const held of host.__hcBreaks.splice(0)) {
    const [kind, detail, at] = held as [string, unknown, number]
    take(kind, detail, at)
  }
  // A page being put away may not come back; land what it has while it can.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush(true)
  })
}

install()
