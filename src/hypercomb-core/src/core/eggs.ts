// hypercomb-core/src/core/eggs.ts
//
// AN EGG IS A SIGNATURE THAT HAS NOT ARRIVED YET, AT REST.
//
// Content is asked for by signature across every carried host, and a host that
// does not hold it answers 404 — the fair price of a source list that needs no
// trust argument (acquire.ts). The price was being paid over and over: nothing
// remembered the answer, so every repaint re-asked every host for the same
// missing bytes, and the console filled with the same 404s.
//
// So a miss is laid as an egg in its own pool, `eggs:dormant` — one file per
// missing signature, NAMED BY that signature, holding the hosts already asked
// that said no. A dormant egg means exactly one thing: do not ask those hosts
// again. It HATCHES — the file is removed — when the bytes arrive from
// anywhere. It WAKES only when a host it has never asked joins the set, and
// then only that host is asked. There is no timer: a miss is permanent
// relative to the hosts that produced it, so re-asking on a clock only spreads
// the same flood thinner.
//
// ONLY A DEFINITE "NOT HERE" LAYS AN EGG: 404/410, an HTML fallback page, or
// bytes that do not hash to the name. A network error, a timeout or a 5xx is
// the host being unreachable, not the host lacking the bytes — recording it
// would leave an offline laptop with an egg on every signature, dormant
// forever once it reconnects.
//
// Not the brood. The brood holds behaviours that arrived and are not yet
// trusted; an egg holds nothing but the fact that bytes have not arrived.
//
// The service workers (hypercomb.worker.js, web/dev/shim) cannot import this
// and keep the same record at the same address by hand — change the file shape
// here and there together.

import { EffectBus } from '../effect-bus.js'
import { registerPoolMeaning } from './pool-registry.js'

export const EGGS_MEANING = 'eggs:dormant'

/** What one host said about one signature. `unreachable` records nothing. */
export type EggProbe<T> = T | 'absent' | 'unreachable'

/** The file's shape: the host bases already asked that did not hold it. */
type EggRecord = { readonly tried: readonly string[] }

const SIG = /^[0-9a-f]{64}$/

// The session's own copy, so a repaint never touches storage to learn what it
// learned a second ago. Storage is what carries it across a reload. Pinned on
// globalThis because core evaluates twice in the shell (bundled + external).
const known: Map<string, Set<string>> = ((globalThis as { __hypercombEggs?: Map<string, Set<string>> }).__hypercombEggs ??= new Map())

const eggsDir = async (create: boolean): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const root = await globalThis.navigator?.storage?.getDirectory?.()
    if (!root) return null
    return await root.getDirectoryHandle(await registerPoolMeaning(EGGS_MEANING), { create })
  } catch { return null }
}

const readTried = async (sig: string): Promise<Set<string>> => {
  const held = known.get(sig)
  if (held) return held
  const tried = new Set<string>()
  try {
    const dir = await eggsDir(false)
    const file = dir && await (await dir.getFileHandle(sig)).getFile()
    const record = file ? JSON.parse(await file.text()) as EggRecord : null
    for (const base of record?.tried ?? []) if (typeof base === 'string' && base) tried.add(base)
  } catch { /* no egg — nothing asked yet */ }
  known.set(sig, tried)
  return tried
}

/** The hosts in `bases` this signature has not already been refused by. */
export const untriedHosts = async (sig: string, bases: readonly string[]): Promise<string[]> => {
  if (!SIG.test(sig)) return [...bases]
  const tried = await readTried(sig)
  return bases.filter(base => !tried.has(base))
}

/** Record that `refusedBy` do not hold `sig`. Complete-or-absent: the whole
 *  record is rewritten, never appended to. */
export const layEgg = async (sig: string, refusedBy: readonly string[]): Promise<void> => {
  if (!SIG.test(sig) || !refusedBy.length) return
  const tried = await readTried(sig)
  const before = tried.size
  for (const base of refusedBy) tried.add(base)
  if (tried.size === before) return
  try {
    const dir = await eggsDir(true)
    if (!dir) return
    const writable = await (await dir.getFileHandle(sig, { create: true })).createWritable()
    try { await writable.write(JSON.stringify({ tried: [...tried].sort() } satisfies EggRecord)) } finally { await writable.close() }
  } catch { /* the session copy still holds it */ }
}

/** The service workers keep their own session copy of the same record
 *  (hypercomb.worker.js, web/dev/shim). A hatch removes the file; this tells
 *  the worker to drop its copy too, or it keeps answering a stale miss until
 *  it is restarted. Same message in every copy — change them together. */
export const EGGS_HATCH_MESSAGE = 'hc:sw:eggs-hatch'

const tellWorker = (sigs: readonly string[] | null): void => {
  try {
    const controller = (globalThis.navigator as { serviceWorker?: { controller?: { postMessage(message: unknown): void } | null } } | undefined)
      ?.serviceWorker?.controller
    controller?.postMessage({ type: EGGS_HATCH_MESSAGE, sigs })
  } catch { /* no worker — nothing else holds a copy */ }
}

/**
 * HATCH MANY AT ONCE — "these may be asked again". The bytes arrived, or a
 * NEW HEAD reaches them: a host head-only serves (documentation/
 * hosted-tenants.md §4) answers a withdrawn old version as a plain 404, and a
 * revert or public history serves it again. A miss is permanent relative to
 * the head that produced it, never past a head move — so whoever takes a new
 * head hatches what it reaches. Session copy and disk alike: a worker can lay
 * an egg on disk this page's copy never saw, so the disk is always asked.
 * Returns the signatures that held an egg.
 */
export const hatchEggs = async (sigs: Iterable<string>): Promise<string[]> => {
  const wanted = [...new Set([...sigs].map(sig => String(sig ?? '').toLowerCase()).filter(sig => SIG.test(sig)))]
  if (!wanted.length) return []
  const hatched = new Set<string>()
  for (const sig of wanted) {
    if (known.get(sig)?.size) hatched.add(sig)
    known.set(sig, new Set())
  }
  try {
    const dir = await eggsDir(false)
    if (dir) {
      for (const sig of wanted) {
        try { await dir.removeEntry(sig); hatched.add(sig) } catch { /* no egg on disk */ }
      }
    }
  } catch { /* nothing laid */ }
  const out = wanted.filter(sig => hatched.has(sig))
  if (out.length) tellWorker(out)
  return out
}

/** A MODULE ASKS BY EFFECT, NOT BY IMPORT. A module that took a new head (an
 *  adopted creation's fold) emits `eggs:hatch { sigs }` instead of importing
 *  `hatchEggs`, so it needs nothing from a newer core than the shell ships:
 *  on an older shell the effect simply finds no listener. One listener however
 *  many times core evaluates (bundled + external). */
export const EGGS_HATCH_EFFECT = 'eggs:hatch'
const listening = globalThis as { __hypercombEggsHatchListening?: boolean }
if (!listening.__hypercombEggsHatchListening) {
  listening.__hypercombEggsHatchListening = true
  EffectBus.on<{ sigs?: unknown }>(EGGS_HATCH_EFFECT, payload => {
    const sigs = payload?.sigs
    if (Array.isArray(sigs)) void hatchEggs(sigs.filter((sig): sig is string => typeof sig === 'string')).catch(() => {})
  })
}

/** The bytes arrived: the egg is gone. The disk is asked even when this
 *  session's copy is empty — another context (a service worker, an earlier
 *  page) may have laid it; with no eggs pool at all it is one lookup. */
export const hatchEgg = async (sig: string): Promise<void> => { await hatchEggs([sig]) }

// ONE ASK IN FLIGHT PER SIGNATURE. An egg is laid when an ask ENDS, so two
// asks for the same signature started a tick apart (the Hosts window reads
// from more than one handler) both found no egg and both asked every host —
// one miss became a burst of the same 404. The second ask now waits for the
// first: if the first was answered, the bytes have arrived and that is its
// answer too; otherwise the egg is laid by then and it asks only what is still
// untried. The record is in memory only — nothing outlives the ask.
type InFlight = { readonly done: Promise<{ answer: unknown; found: boolean }> }
const inFlight: Map<string, InFlight> = ((globalThis as { __hypercombAsking?: Map<string, InFlight> }).__hypercombAsking ??= new Map())

const askEach = async <T>(
  sig: string,
  bases: readonly string[],
  ask: (base: string) => Promise<EggProbe<T>>,
): Promise<{ answer: T | null; found: boolean }> => {
  const refused: string[] = []
  try {
    for (const base of await untriedHosts(sig, bases)) {
      const answer = await ask(base)
      if (answer === 'absent') { refused.push(base); continue }
      if (answer === 'unreachable') continue
      // Held somewhere: the ones before it refusing no longer matter.
      refused.length = 0
      await hatchEgg(sig)
      return { answer, found: true }
    }
    return { answer: null, found: false }
  } finally {
    if (refused.length) await layEgg(sig, refused)
  }
}

/**
 * Ask each host this signature has not already been refused by, in order,
 * until one holds it. The hosts that answered a definite no are laid as an
 * egg; the one that answered hatches it. Returns null when nobody (asked this
 * time) had it. Concurrent asks for one signature take turns, so a host is
 * asked once for it however many callers want it at the same moment.
 */
export const askUntried = async <T>(
  sig: string,
  bases: readonly string[],
  ask: (base: string) => Promise<EggProbe<T>>,
): Promise<T | null> => {
  if (!SIG.test(sig)) return (await askEach(sig, bases, ask)).answer
  for (let ahead = inFlight.get(sig); ahead; ahead = inFlight.get(sig)) {
    const { answer, found } = await ahead.done
    if (found) return answer as T
  }
  const run = askEach(sig, bases, ask)
  const mine: InFlight = { done: run.catch(() => ({ answer: null, found: false })) }
  inFlight.set(sig, mine)
  try { return (await run).answer } finally { if (inFlight.get(sig) === mine) inFlight.delete(sig) }
}

/** Forget every egg — "ask everyone again". Session copy first, then the pool. */
export const clearEggs = async (): Promise<void> => {
  known.clear()
  tellWorker(null)
  try {
    const dir = await eggsDir(false)
    if (!dir) return
    const names: string[] = []
    for await (const [name] of (dir as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) names.push(name)
    for (const name of names) if (SIG.test(name)) await dir.removeEntry(name).catch(() => {})
  } catch { /* nothing laid */ }
}
