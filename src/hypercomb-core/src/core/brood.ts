// hypercomb-core/src/core/brood.ts
//
// THE BROOD IS FOR UNVERIFIED AUTOMATONS (Jaime, 2026-09-20).
//
// Code that arrived from somebody else is not refused and not run. It is HELD:
// its bytes sit in the hive, hash-verified like everything else, and the one
// thing they cannot do is execute. A bee with a brood record that has no
// ruling is never imported (script-preloader.ts asks `mayRunBee` at the single
// point where a signature becomes running code).
//
// THE ONLY DOOR OUT IS A HAND. An audit can read, score, summarise and
// recommend; it can never accept. `attachAudit` cannot write a ruling — that
// is the whole reason it is a separate call — so no model, agent, schedule or
// host reply can promote code, and reading hostile code can therefore never
// compromise anything. `acceptIntoHive` is the only writer of an accepting
// ruling, and it refuses unless the caller passes at least two DISTINCT
// warnings it showed and the participant dismissed: the double warning is
// mechanical, not a UI convention that a later surface can forget.
//
// This does not replace admission. acquire.ts still proves the bytes are what
// they are named, and activation-authority.ts still decides whether a PACKAGE
// may run here at all. The brood is where something that got past neither
// gate's "no" and neither gate's "yes" waits for a person: held, inspectable,
// inert.
//
// An audit report is content — it can be shared, cached and compared — so the
// record holds its SIGNATURE, never its prose (signature-system.md).
//
// Not eggs. An egg (core/eggs.ts) is a signature whose bytes have not arrived.
// A brood record is bytes that arrived and are not trusted yet.

import { registerPoolMeaning } from './pool-registry.js'
import { admitArrival, broodRules, type ArrivalKind, type BroodVouch } from './brood-rules.js'
import type { CodeReach } from './code-reach.js'

export const BROOD_MEANING = 'brood:unverified'

/** Where the code came from — recorded for the participant, never consulted
 *  as permission. */
export type BroodSource = {
  /** The domain that offered it. */
  readonly zone?: string
  /** The package whose closure carried it, when it came in one. */
  readonly packageSig?: string
  /** Whoever signed for it, when anybody did. */
  readonly key?: string
  /** What the participant was doing when it arrived. */
  readonly how?: string
  /** Which rule governs it (brood-rules.ts). Unset is treated as a stranger:
   *  an arrival that forgot to say where it came from is not a trusted one. */
  readonly kind?: ArrivalKind
}

/** What an audit made of it. Advisory, always — see the header. */
export type BroodAudit = {
  readonly at: number
  /** The audit report, held as a resource. */
  readonly reportSig?: string
  /** One line for a list. */
  readonly summary: string
  /** Who or what read it ('jev', a model id, an agent name). */
  readonly by: string
  /** Scores an automated reader produced, 0..1. Never a permission. */
  readonly scores?: Readonly<Record<string, number>>
  /** The reader's own recommendation. Still not an acceptance. */
  readonly recommends?: 'accept' | 'refuse' | 'unclear'
  /** What the code reaches, when the reader was the scan (code-reach.ts). */
  readonly reaches?: readonly CodeReach[]
}

export type BroodRuling = {
  readonly at: number
  readonly verdict: 'accepted' | 'refused'
  /** The warnings the participant was shown and dismissed. */
  readonly warnings: readonly string[]
}

/** WHY SOMETHING HELD IT WITHOUT A HAND (the draft audit): the scan saw the
 *  code newly reach something (code-reach.ts), or a reader recommended
 *  refusing it. A flag can only HOLD — `mayRunBee` refuses a flagged record
 *  whatever the rules say — and nothing removes one; only a ruling, the hand,
 *  decides past it. */
export type BroodFlag = {
  readonly at: number
  /** 'scan' for code-reach.ts, else the reader ('jev', a model id). */
  readonly by: string
  readonly reason: string
  readonly reaches?: readonly CodeReach[]
}

export type BroodRecord = {
  readonly sig: string
  readonly kind: 'bee'
  readonly arrived: number
  readonly name?: string
  readonly source: BroodSource
  readonly audits: readonly BroodAudit[]
  /** Rulings made by OTHER participants, already verified by whoever recorded
   *  them. Counted only when their key is one this participant follows. */
  readonly vouches: readonly BroodVouch[]
  readonly ruling?: BroodRuling
  /** Holds placed by a scan or a reader. Any one keeps it from running until
   *  a ruling says otherwise. */
  readonly flags?: readonly BroodFlag[]
}

const SIG = /^[0-9a-f]{64}$/

// Pinned: core evaluates twice in the shell (bundled + external), and the two
// copies must not disagree about what is allowed to run.
const cache: Map<string, BroodRecord | null> =
  ((globalThis as { __hypercombBrood?: Map<string, BroodRecord | null> }).__hypercombBrood ??= new Map())

const broodDir = async (create: boolean): Promise<FileSystemDirectoryHandle | null> => {
  try {
    const root = await globalThis.navigator?.storage?.getDirectory?.()
    if (!root) return null
    return await root.getDirectoryHandle(await registerPoolMeaning(BROOD_MEANING), { create })
  } catch { return null }
}

const isRecord = (value: unknown): value is BroodRecord => {
  const record = value as BroodRecord | null
  return !!record && SIG.test(record.sig ?? '') && typeof record.arrived === 'number' && Array.isArray(record.audits)
}

const write = async (record: BroodRecord): Promise<void> => {
  cache.set(record.sig, record)
  const dir = await broodDir(true)
  if (!dir) return
  const writable = await (await dir.getFileHandle(record.sig, { create: true })).createWritable()
  try { await writable.write(JSON.stringify(record)) } finally { await writable.close() }
}

/** The record for one signature, or null when it was never held. */
export const broodRecord = async (sig: string): Promise<BroodRecord | null> => {
  if (!SIG.test(sig)) return null
  if (cache.has(sig)) return cache.get(sig) ?? null
  let record: BroodRecord | null = null
  try {
    const dir = await broodDir(false)
    const file = dir && await (await dir.getFileHandle(sig)).getFile()
    const parsed = file ? JSON.parse(await file.text()) as unknown : null
    if (isRecord(parsed)) record = { ...parsed, vouches: parsed.vouches ?? [] }
  } catch { /* never held */ }
  cache.set(sig, record)
  return record
}

/**
 * Hold an automaton: it is in the hive and it does not run. Idempotent, and it
 * never touches a record that already exists — re-arrival is not a new chance
 * to be accepted, and it must not quietly clear a refusal.
 */
export const holdInBrood = async (
  sig: string,
  source: BroodSource = {},
  name?: string,
): Promise<BroodRecord | null> => {
  if (!SIG.test(sig)) return null
  const held = await broodRecord(sig)
  if (held) return held
  const record: BroodRecord = {
    sig, kind: 'bee', arrived: Date.now(), source, audits: [], vouches: [],
    ...(name ? { name } : {}),
  }
  try { await write(record) } catch { /* the session copy still holds it */ }
  return record
}

/**
 * MAY THIS SIGNATURE RUN?
 *
 * Anything never held runs as before — the brood adds a gate, it is not the
 * only one. For something held, YOUR OWN RULING ALWAYS WINS, either way. Only
 * when you have not ruled do the rules speak (brood-rules.ts): they may admit
 * it outright, or on the strength of enough vouches from communities you
 * follow. A stranger with no vouches stays held, which is the whole point.
 */
export const mayRunBee = async (sig: string): Promise<boolean> => {
  const record = await broodRecord(sig)
  if (!record) return true
  if (record.ruling) return record.ruling.verdict === 'accepted'
  if (record.flags?.length) return false
  return admitArrival(record.source.kind ?? 'stranger', await broodRules(), record.vouches) === 'run'
}

/**
 * HOLD IT FOR A REASON — the draft audit's door. Records the code when the
 * brood has never seen it (your own draft: `own`, which the rules would run)
 * and adds a flag, which holds it whatever the rules say. It can only
 * restrict: a ruling already made stands (your hand outranks every scan and
 * reader), and no flag is ever removed. Unlike the other writers it THROWS
 * when the record cannot be written, because a caller about to let code run
 * must know the hold did not land.
 */
export const flagInBrood = async (
  sig: string,
  flag: Omit<BroodFlag, 'at'> & { readonly at?: number },
  source: BroodSource = { kind: 'own' },
  name?: string,
): Promise<BroodRecord> => {
  if (!SIG.test(sig)) throw new Error('a flag names the code by its 64-character signature')
  const record = (await broodRecord(sig)) ?? {
    sig, kind: 'bee' as const, arrived: Date.now(), source, audits: [], vouches: [],
    ...(name ? { name } : {}),
  }
  const next: BroodRecord = { ...record, flags: [...(record.flags ?? []), { ...flag, at: flag.at ?? Date.now() }] }
  await write(next)
  return next
}

/** Everything the brood is holding, newest arrival first. The pool and what
 *  this session already knows, unioned — a hive with no storage still knows
 *  what it is holding right now. */
export const broodRoster = async (): Promise<readonly BroodRecord[]> => {
  const held = new Map<string, BroodRecord>()
  for (const record of cache.values()) if (record) held.set(record.sig, record)
  try {
    const dir = await broodDir(false)
    if (dir) {
      for await (const [name] of (dir as unknown as { entries(): AsyncIterable<[string, unknown]> }).entries()) {
        if (!SIG.test(name) || held.has(name)) continue
        const record = await broodRecord(name)
        if (record) held.set(name, record)
      }
    }
  } catch { /* nothing held on disk */ }
  return [...held.values()].sort((a, b) => b.arrived - a.arrived || a.sig.localeCompare(b.sig))
}

/**
 * Record what a reader made of held code. CANNOT RULE — by construction, so
 * that auditing hostile code is never a way through. Appends; an audit is a
 * reading, and readings accumulate.
 */
export const attachAudit = async (sig: string, audit: Omit<BroodAudit, 'at'> & { at?: number }): Promise<BroodRecord | null> => {
  const record = await broodRecord(sig)
  if (!record) return null
  const next: BroodRecord = { ...record, audits: [...record.audits, { ...audit, at: audit.at ?? Date.now() }] }
  try { await write(next) } catch { /* session copy holds it */ }
  return next
}

/**
 * THE HAND. The only call that lets held code run, and it refuses unless at
 * least two distinct warnings were shown and dismissed. Rejects an unknown
 * signature rather than inventing a record: you cannot accept what was never
 * held.
 */
export const acceptIntoHive = async (sig: string, warnings: readonly string[]): Promise<BroodRecord | null> => {
  const shown = [...new Set(warnings.filter(w => typeof w === 'string' && w.trim()))]
  if (shown.length < 2) throw new Error('accepting held code needs two distinct warnings shown and dismissed')
  const record = await broodRecord(sig)
  if (!record) return null
  const next: BroodRecord = { ...record, ruling: { at: Date.now(), verdict: 'accepted', warnings: shown } }
  await write(next)
  return next
}

/**
 * Record another participant's ruling. The caller has ALREADY verified the
 * signature — core counts keys, it never checks them. One vouch per key: a
 * community that changes its mind replaces its own earlier word and can
 * never stuff the count.
 */
export const recordVouch = async (sig: string, vouch: BroodVouch): Promise<BroodRecord | null> => {
  const record = await broodRecord(sig)
  if (!record || !vouch?.by) return null
  const next: BroodRecord = {
    ...record,
    vouches: [...record.vouches.filter(held => held.by !== vouch.by), vouch],
  }
  try { await write(next) } catch { /* session copy holds it */ }
  return next
}

/** Refuse it. Stays held and inert; the record keeps why it was ever here. */
export const refuseInBrood = async (sig: string): Promise<BroodRecord | null> => {
  const record = await broodRecord(sig)
  if (!record) return null
  const next: BroodRecord = { ...record, ruling: { at: Date.now(), verdict: 'refused', warnings: [] } }
  await write(next)
  return next
}

/**
 * THE PRODUCER. Run the rules over what just arrived, and hold whatever they
 * do not clear to run. Called where bytes have been admitted and verified but
 * nothing has been imported yet — the last moment at which holding still
 * costs nothing (acquire.ts, before `activate`).
 *
 * Returns the signatures that will NOT run, which is the honest thing for a
 * caller to report: it is re-derived through `mayRunBee`, so a bee already
 * accepted by hand, or carried by enough vouches, is not counted as held.
 * Never throws — a brood that cannot be written must not break an install
 * that the authority gate already allowed.
 */
export const holdArrivals = async (
  sigs: readonly string[],
  kind: ArrivalKind,
  source: Omit<BroodSource, 'kind'> = {},
): Promise<readonly string[]> => {
  const rules = await broodRules()
  const heldBack: string[] = []
  for (const sig of [...new Set(sigs)].filter(candidate => SIG.test(candidate))) {
    try {
      const record = await broodRecord(sig)
      if (admitArrival(kind, rules, record?.vouches ?? []) !== 'run') await holdInBrood(sig, { ...source, kind })
      else if (record && !record.ruling && TRUST[kind] > TRUST[record.source.kind ?? 'stranger']) {
        // THE SAME BYTES, NOW VOUCHED FOR. Code first held as a stranger's —
        // a community trial taken by hand — that arrives again from a publisher
        // you follow (the trial they promoted) is theirs too, so your rules for
        // that kind now decide it. A ruling you made is never touched.
        await write({ ...record, source: { ...record.source, ...source, kind } })
      }
      if (!(await mayRunBee(sig))) heldBack.push(sig)
    } catch { /* an install the authority allowed must not die in the brood */ }
  }
  return heldBack
}

/** How far an arrival's source is trusted — a record only ever moves up. */
const TRUST: Record<ArrivalKind, number> = { stranger: 0, followed: 1, own: 2 }

/** Drop a record entirely — "I never want to be asked about this again". The
 *  bytes are content and are not touched; only the holding is forgotten. */
export const forgetInBrood = async (sig: string): Promise<void> => {
  cache.delete(sig)
  try { await (await broodDir(false))?.removeEntry(sig) } catch { /* nothing held */ }
}
