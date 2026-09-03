// sharing/hive-format.ts
//
// WHAT FORMAT THIS HIVE IS WRITTEN IN — the read, the write, and the one
// sentence the participant is shown.
//
// The comparison itself is pure and lives in `@hypercomb/core`
// (core/format-version.ts); this file is only the I/O and the surface.
//
// ── ITS STORAGE SHAPE IS FROZEN FOREVER ────────────────────────────────────
//
// One sig-named MEMBER, holding plain JSON, in a colon-scoped pool at the
// OPFS root — plus the same bytes under a reserved key in the kind-30564 hive
// index so a VISITOR sees it before adopting. That shape must never be
// relocated or re-shaped by a later format change, because this is the one
// artefact whose entire job is being readable by clients that will never be
// updated again. A marker that moved with the format would be unreadable by
// exactly the clients it exists to warn. Anything new goes in ADDITIONAL
// fields of the same record, which older readers ignore by contract.
//
// ── IT SHIPS BEFORE THE CHANGE IT PROTECTS AGAINST ─────────────────────────
//
// Nothing in this build writes a declaration above format 1, and the check
// runs unconditionally from the moment this build lands. A client that
// predates the check cannot report anything, which is why it lands now, while
// the format is still the old one.

import { EffectBus, SUPPORTED_FORMAT_VERSION, SignatureService, advanceFormat, compareFormat, parseHiveFormat, type FormatComparison, type HiveFormatDeclaration } from '@hypercomb/core'
import { formatRootOf } from './hive-link.js'

/** Colon-scoped, with word characters on both sides: `lineageKey` folds every
 *  non-letter/digit to `-`, so no tile name can ever produce this address.
 *  Seeded in core's SCOPED_POOL_MEANINGS — the registry is in memory only, so
 *  an unseeded meaning is invisible to `isPoolAddress` between boot and its
 *  first derivation, and a root walk inside that window would take the
 *  directory for a lineage sigbag. */
export const HIVE_FORMAT_POOL = 'format:hive'

// WHY THERE IS NO "ALREADY TOLD THEM" MARK.
//
// There was one - a localStorage fingerprint, written BEFORE the toast was
// emitted. It made a STANDING condition (content on this hive is permanently
// invisible to this client) into a one-shot event, and the mark survived even
// when the sentence did not: `ToastDrone` keeps five toasts and PREPENDS, so a
// sticky `duration: 0` toast is simply sliced off the end by the next five
// notifications of any kind - twelve seconds after boot, that is an ordinary
// afternoon. An accidental dismiss did the same. After that the app was silent
// about it forever.
//
// So the suppression is gone. Re-stating a standing condition once per boot is
// the correct nag; it stops the day the client is updated or the hive is
// opened on the device that wrote it, which is exactly when it should stop.

const SIG_RE = /^[0-9a-f]{64}$/i

/** The slice of a pool handle this file reads. `FileSystemDirectoryHandle`
 *  declares its own `entries()` whose value type is the bare `FileSystemHandle`
 *  (no `getFile`), so the enumeration is typed here rather than intersected. */
type PoolEntry = { kind?: string; getFile?: () => Promise<{ size: number; text: () => Promise<string> }> }
type PoolHandle = FileSystemDirectoryHandle
type EnumerablePool = { entries?: () => AsyncIterable<[string, PoolEntry]> }

type StoreLike = {
  getPool?: (meaning: string) => Promise<PoolHandle | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
}

const store = (): StoreLike | undefined =>
  (window as unknown as { ioc?: { get?: <T>(k: string) => T | undefined } })
    .ioc?.get?.<StoreLike>('@hypercomb.social/Store')

/** What a read of this hive's own declaration found. `markerUnreadable` is
 *  true only when a member was PRESENT and none of the present members could
 *  be parsed - the caller needs that to tell "nothing there" from "something
 *  written by a client newer than me". */
export interface HiveFormatState {
  declaration: HiveFormatDeclaration | null
  markerUnreadable: boolean
}

/**
 * Read every member of the pool and keep the FURTHEST FORWARD.
 *
 * `advanceFormat` makes a downgrade uncomposable at WRITE time; nothing made
 * the READ agree. `Store.getPoolDoc` returns the FIRST non-empty sig-named
 * member in `entries()` order, and OPFS specifies no order - so one stale
 * sibling silences the whole feature. And a second member is ordinary, not
 * exotic: `putPoolDoc` writes the new member BEFORE dropping the old, its
 * sweep is best-effort inside a `catch {}`, and the sweep is REFUSED outright
 * whenever `documentSweepVetoFor` objects (its own comment says "a refused
 * sweep costs a stale read"). A folder-sync restore of a pre-advance backup
 * leaves two as well.
 *
 * The tiebreak is `advanceFormat` itself, so the read and the write order
 * declarations by the same rule and cannot drift apart. Self-healing: the next
 * `declareHiveFormat` re-writes the winner and the stale sibling is swept.
 */
export const readHiveFormatState = async (): Promise<HiveFormatState> => {
  const s = store()
  if (!s?.getPool) return { declaration: null, markerUnreadable: false }
  let pool: PoolHandle | null = null
  try { pool = await s.getPool(HIVE_FORMAT_POOL) } catch { return { declaration: null, markerUnreadable: false } }
  if (!pool) return { declaration: null, markerUnreadable: false }

  let best: HiveFormatDeclaration | null = null
  let present = 0
  let unreadable = 0
  const keep = (text: string | null): void => {
    const parsed = parseHiveFormat(text)
    if (!parsed) { unreadable++; return }
    if (!best) { best = parsed; return }
    best = advanceFormat(best, parsed) ?? best
  }

  const enumerable = pool as unknown as EnumerablePool
  if (typeof enumerable.entries === 'function') {
    try {
      for await (const [name, handle] of enumerable.entries()) {
        if (handle?.kind !== 'file' || !SIG_RE.test(name)) continue
        try {
          const file = await handle.getFile?.()
          if (!file || file.size === 0) continue
          present++
          keep(await file.text())
        } catch { unreadable++ }
      }
    } catch { /* not enumerable here - the single-doc read below still applies */ }
  }

  // Fallback for a store that cannot enumerate: the single current document.
  // It cannot break the tie, but it is better than reading nothing.
  if (present === 0 && s.getPoolDoc) {
    try {
      const bytes = await s.getPoolDoc(pool)
      if (bytes) { present++; keep(new TextDecoder().decode(bytes)) }
    } catch { /* nothing readable */ }
  }

  return { declaration: best, markerUnreadable: best === null && unreadable > 0 }
}

/** The declaration this hive carries, or null when it carries none.
 *
 *  UNDECLARED IS A LEGITIMATE STATE, not an error: every hive that predates
 *  this build is undeclared, and that is exactly the silence this feature
 *  needs on the day it ships. */
export const readHiveFormat = async (): Promise<HiveFormatDeclaration | null> =>
  (await readHiveFormatState()).declaration

/**
 * Declare (or advance) this hive's format. Idempotent and MONOTONIC.
 *
 * `putPoolDoc` is unconditional last-write-wins with no compare step, so the
 * monotonicity lives here — and in exactly one place. If a second writer ever
 * skipped it, an older device could silently downgrade the hive's declared
 * format and turn the warning OFF on every client. `advanceFormat` returns
 * null for a downgrade or a no-op, which makes that uncomposable rather than
 * merely discouraged.
 *
 * Returns the declaration now in force, or null when nothing could be written.
 */
export const declareHiveFormat = async (
  proposed: HiveFormatDeclaration,
): Promise<HiveFormatDeclaration | null> => {
  const current = await readHiveFormat()
  const next = advanceFormat(current, proposed)
  if (!next) return current
  const s = store()
  if (!s?.getPool || !s.putPoolDoc) return current
  try {
    const pool = await s.getPool(HIVE_FORMAT_POOL)
    if (!pool) return current
    const bytes = new TextEncoder().encode(JSON.stringify(next))
    // The pool is colon-scoped, so `putPoolDoc`'s sibling sweep has positive
    // proof of ownership and this stays a true one-current-document pool.
    const sig = await s.putPoolDoc(pool, bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer)
    return sig ? next : current
  } catch { return current }
}

/** Emit the one sentence. The EXISTING surface, not a new one: shell chrome is
 *  registry-fed and the barrel is frozen (doctrine.spec.ts), and a
 *  drone-contributed element surface would need a line in side-effects.ts. The
 *  toast needs neither. `duration: 0` is sticky - this is a standing
 *  condition, not an event - and it carries NO action buttons, because there
 *  is nothing this client can do about it from inside the app and a button
 *  that cannot help is worse than none. */
const say = (verdict: FormatComparison): void => {
  if (!verdict.announce) return
  EffectBus.emit('toast:show', {
    type: 'warning',
    title: 'Older client',
    message: verdict.sentence,
    duration: 0,
  })
}

/**
 * Compare this client against what THIS hive declares, and say so when the
 * client cannot read all of it.
 *
 * NEVER GATES. `hardDeleteVetoFor` fails CLOSED because its power is to
 * DESTROY; this marker's only power is to WARN, so it can never lock the
 * participant out. But an absent declaration and an UNREADABLE one are not the
 * same thing: absent is silence, unreadable can only have been written by a
 * client newer than this one, and that is a sentence.
 */
export const announceHiveFormat = async (
  declaration?: HiveFormatDeclaration | null,
): Promise<FormatComparison> => {
  const state = declaration === undefined
    ? await readHiveFormatState()
    : { declaration, markerUnreadable: false }
  const verdict = compareFormat(state.declaration, SUPPORTED_FORMAT_VERSION, {
    markerUnreadable: state.markerUnreadable,
    now: Date.now(),
  })
  say(verdict)
  return verdict
}

// -- THE REMOTE HALF - the reader ships FIRST, the writer can wait ---------
//
// The local pool crosses no wire. It is not a published pool, and
// HostSyncService pushes lineage closures plus its own named pools, never an
// arbitrary one - so a declaration written by a newer client on device B could
// never have reached older device A, and a VISITOR fetching a hive over the
// wire would never have seen one at all. The only case the pool serves is
// same-origin/same-OPFS.
//
// That is the sharpest form of constraint 1. The READER must ship before the
// change it protects against; a WRITER that lands later is fine, because by
// then every shipped client can already read what it writes. So the read ships
// now - when a future client finally writes `format:hive` into a kind-30564
// index, the clients that need the warning are precisely the ones that will
// never be updated again.

const LOOPBACK_RE = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i

/** `<scheme>://<host>/<sig>` - the flat atom URL every host serves. Same
 *  loopback rule as `hiveIndexUrl` and HostSyncService. */
const atomUrl = (host: string, sig: string): string => {
  const bare = String(host ?? '').replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '').trim()
  return `${LOOPBACK_RE.test(bare) ? 'http' : 'https'}://${bare}/${sig}`
}

/** Fetch the declaration bytes and CHECK THEM AGAINST THEIR OWN ADDRESS. The
 *  index was signature-verified by the caller, but the atom was not: a host
 *  serving different bytes under that sig would otherwise choose what this
 *  client believes about the hive's format. A mismatch is `null` - the host is
 *  wrong, not the hive. 64 KiB is a hard ceiling on a record holding two
 *  integers and a date. */
const fetchDeclarationText = async (host: string, sig: string): Promise<string | null> => {
  try {
    const res = await fetch(atomUrl(host, sig), { cache: 'no-store' })
    if (!res.ok) return null
    const bytes = await res.arrayBuffer()
    if (bytes.byteLength === 0 || bytes.byteLength > 64 * 1024) return null
    const actual = String(await SignatureService.sign(bytes)).toLowerCase()
    if (actual !== sig) return null
    return new TextDecoder().decode(bytes)
  } catch { return null }
}

/** The same verdict for a hive reached over the wire, from an ALREADY-VERIFIED
 *  index's roots plus a byte fetch. Adds no trust of its own - the caller has
 *  done the signature check. Non-empty text that will not parse is
 *  `marker-unreadable`, NOT silence: only a newer client writes one. */
export const compareRemoteHiveFormat = (
  declarationText: string | null | undefined,
): FormatComparison => compareFormat(
  parseHiveFormat(declarationText),
  SUPPORTED_FORMAT_VERSION,
  {
    markerUnreadable: typeof declarationText === 'string' && declarationText.trim().length > 0,
    now: Date.now(),
  },
)

/**
 * Read a REMOTE hive's format declaration off a verified index and say so when
 * this client cannot read all of it.
 *
 * Returns null when the index declares no format (every hive today) or when no
 * host would serve the atom - an unreachable host is a network fact, never a
 * format verdict, and must stay silent.
 */
export const checkRemoteHiveFormat = async (
  roots: Record<string, string> | null | undefined,
  hosts: readonly string[],
  fetchText: (host: string, sig: string) => Promise<string | null> = fetchDeclarationText,
): Promise<FormatComparison | null> => {
  if (!roots) return null
  const sig = formatRootOf(roots)
  if (!sig) return null
  for (const host of hosts) {
    const text = await fetchText(host, sig)
    if (text === null) continue
    const verdict = compareRemoteHiveFormat(text)
    say(verdict)
    return verdict
  }
  return null
}
