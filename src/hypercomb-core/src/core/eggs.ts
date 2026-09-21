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

/** The bytes arrived: the egg is gone. */
export const hatchEgg = async (sig: string): Promise<void> => {
  const tried = known.get(sig)
  known.set(sig, new Set())
  // Nothing was ever laid in this session and nothing is on disk to find:
  // the common case costs one directory lookup at most.
  if (tried && !tried.size) return
  try { await (await eggsDir(false))?.removeEntry(sig) } catch { /* no egg to hatch */ }
}

/**
 * Ask each host this signature has not already been refused by, in order,
 * until one holds it. The hosts that answered a definite no are laid as an
 * egg; the one that answered hatches it. Returns null when nobody (asked this
 * time) had it.
 */
export const askUntried = async <T>(
  sig: string,
  bases: readonly string[],
  ask: (base: string) => Promise<EggProbe<T>>,
): Promise<T | null> => {
  const refused: string[] = []
  try {
    for (const base of await untriedHosts(sig, bases)) {
      const answer = await ask(base)
      if (answer === 'absent') { refused.push(base); continue }
      if (answer === 'unreachable') continue
      // Held somewhere: the ones before it refusing no longer matter.
      refused.length = 0
      await hatchEgg(sig)
      return answer
    }
    return null
  } finally {
    if (refused.length) await layEgg(sig, refused)
  }
}

/** Forget every egg — "ask everyone again". Session copy first, then the pool. */
export const clearEggs = async (): Promise<void> => {
  known.clear()
  try {
    const dir = await eggsDir(false)
    if (!dir) return
    const names: string[] = []
    for await (const [name] of (dir as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) names.push(name)
    for (const name of names) if (SIG.test(name)) await dir.removeEntry(name).catch(() => {})
  } catch { /* nothing laid */ }
}
