// diamondcoreprocessor.com/pheromones/enrollment.ts
//
// ENROLLMENT — the one relation primitive, and the end of dependent parent
// behaviours.
//
// ── The rule ─────────────────────────────────────────────────────────
//
// A set is not a tile that HOLDS its members. It is a mark its members WEAR.
// Any artifact can enrol in any other: a website, a slide, a photo, a page, a
// workflow step — none of them is a container, none of them is a child, and
// none of them can be made without the others already existing. Enrolment is
// symmetric in exactly the sense that matters: both parties end up wearing the
// same mark, and neither one owns the other.
//
//     tile A   group{ sig, meaning:'site:pitch', order:0 }
//     tile B   group{ sig, meaning:'site:pitch', order:1 }
//     tile C   group{ sig, meaning:'site:pitch' }  + visual:site:artifact
//
// C is the WEBSITE ARTIFACT — the tile that NAMES the relation. It is a peer:
// it is a member of its own group, it holds nothing, and deleting it leaves A
// and B intact and still related to each other.
//
// ── Why this is the Life Primitive ───────────────────────────────────
//
// The relation carries NO CARGO. A group signature is `sha256('group:'+meaning)`
// — a declared REFERENT in core/edge-registry.ts, meaning no bytes exist behind
// it on any host, by construction, and every precise closure walker skips it.
// That weightlessness is exactly what makes relating two artifacts unable to
// make one depend on the other. A membership that had to carry bytes would be a
// dependency wearing a mark's clothes.
//
// The artifact half is the same shape one level down: every reference is a meta
// envelope with exactly ONE typed payload hop, so an artifact names one thing
// and never reaches into another's internals. Connected to everything,
// dependent on nothing.
//
// ── Type-agnostic on purpose ─────────────────────────────────────────
//
// Nothing here knows what a slide is. `readCell` returns EVERY decoration kind a
// cell carries, so each behaviour asks for its own and no behaviour has to be
// taught about any other. That is what lets a photo, a slide and a nested site
// sit in one set: the set does not have a member TYPE.
//
// Full doctrine: documentation/website-artifact-paradigm.md.

import {
  GROUP_DECORATION_KIND,
  groupSignature,
} from '@hypercomb/core'
import { childSigsOf } from '../history/layer-placement.js'
import { resolveLocalResourceReference } from '../presentation/tiles/local-resource-reference.js'

const SIG = /^[0-9a-f]{64}$/

/** NUL — the one character a tile name can never carry, so a joined path key is
 *  unambiguous. Derived, never written as a raw byte: a literal control byte in
 *  source survives no round trip through tooling (doctrine.spec.ts). Same idiom
 *  as view.bee's SEGMENT_SEPARATOR. */
const SEP = String.fromCharCode(0)

/** The decoration that IS a membership. Shared with every other group consumer
 *  (courses, help islands) — enrolment did not invent a carrier, it adopted the
 *  one that already means "these belong together". */
export const ENROLLMENT_KIND = GROUP_DECORATION_KIND

/** The decoration that NAMES a relation. Worn by the WEBSITE ARTIFACT, which is
 *  a peer of its members and never their container. */
export const SITE_ARTIFACT_KIND = 'visual:site:artifact'

/** Author pheromones ride the same decoration primitive. */
export const TAG_KIND = 'tag'

/** Every meaning this paradigm mints is scoped `site:<name>`. The colon is
 *  load-bearing twice over: `lineageKey` folds every non-alphanumeric to `-`, so
 *  a group signature can never collide with a lineage sigbag or a pool of
 *  meaning; and the scope keeps two features from minting the same group by
 *  accident. */
export const SITE_MEANING_PREFIX = 'site:'

/** Fold a typed name into the stable half of a meaning. Lowercase, and every run
 *  of non-alphanumerics becomes one `-`, so "My Pitch" and "my  pitch" name the
 *  SAME site — a signature is forever, so normalization happens before it is
 *  minted, never after. */
export const siteSlug = (name: string): string =>
  String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** `pitch` → `site:pitch`. Empty name → empty meaning (never a bare `site:`). */
export const siteMeaning = (name: string): string => {
  const slug = siteSlug(name)
  return slug ? SITE_MEANING_PREFIX + slug : ''
}

/** `site:pitch` → `pitch`; anything else → ''. Diagnostics and labels only. */
export const siteNameOf = (meaning: string): string =>
  meaning.startsWith(SITE_MEANING_PREFIX) ? meaning.slice(SITE_MEANING_PREFIX.length) : ''

/** The signature that IS the site called `<name>`. */
export const siteSignature = (name: string): Promise<string> => groupSignature(siteMeaning(name))

// ── the records ─────────────────────────────────────────────────────

/**
 * One membership — and the one place anything true of THIS membership can
 * honestly live.
 *
 * Order is an attribute of the INCIDENCE (this tile's participation in this
 * site), not of the tile and not of the site. Put it on the member and the
 * member depends on a set: one `order` field cannot serve two sites, so the
 * member could only ever belong to one. On the mark, a tile enrolled in three
 * sites wears three marks with three positions and none of them knows about the
 * others.
 */
export type Enrollment = {
  readonly sig: string
  readonly meaning: string
  /** Position within THIS site. Absent = unplaced (sorts after the placed). */
  readonly order?: number
}

/** What a WEBSITE ARTIFACT says about the relation it names. */
export type SiteArtifact = {
  readonly groupSig: string
  readonly meaning: string
  readonly name: string
}

/**
 * Everything one cell contributes, read in a single pass over its decorations.
 * Deliberately reads EVERY record (no early break): a membership can sit after
 * a content record in the slot, and nothing here knows which kinds a caller
 * cares about.
 */
export type CellEnrollment = {
  readonly segments: readonly string[]
  readonly name: string
  /** The member's head layer, carried out of the walk so a reader that needs
   *  more than the marks does not re-sign a location already resolved. */
  readonly layer: Record<string, unknown>
  /** Memberships worn by this cell — the relation itself. */
  readonly enrollments: readonly Enrollment[]
  /** Set when this cell NAMES a relation (it is a website artifact). */
  readonly names: SiteArtifact | null
  /** Author pheromones, for the standing mark filter. */
  readonly marks: readonly string[]
  /** Every decoration payload this cell carries, by kind. Type-agnostic on
   *  purpose: each behaviour asks for its own kind, and no behaviour here has
   *  to be taught about any other. */
  readonly payloads: ReadonlyMap<string, readonly Record<string, unknown>[]>
}

type ReadStore = {
  getResourceLocal(sig: string): Promise<Blob | null>
  getResourceResolvedLocal?(sig: string): Promise<Blob | null>
}

const NO_PAYLOADS: ReadonlyMap<string, readonly Record<string, unknown>[]> = new Map()

const emptyCell = (segments: readonly string[], layer: Record<string, unknown>): CellEnrollment => ({
  segments, name: segments[segments.length - 1] ?? '', layer,
  enrollments: [], names: null, marks: [], payloads: NO_PAYLOADS,
})

/** The first payload of `kind`, or null. The common ask: a behaviour that
 *  replaces its own record keeps exactly one. */
export const payloadOf = (
  cell: CellEnrollment,
  kind: string,
): Record<string, unknown> | null => cell.payloads.get(kind)?.[0] ?? null

/** Every payload of `kind`. For behaviours that genuinely accumulate. */
export const payloadsOf = (
  cell: CellEnrollment,
  kind: string,
): readonly Record<string, unknown>[] => cell.payloads.get(kind) ?? []

/** Does this cell carry `kind` at all? */
export const carries = (cell: CellEnrollment, kind: string): boolean => cell.payloads.has(kind)

// ── reading ─────────────────────────────────────────────────────────

/** Decoration records are immutable content, so a sig→record cache is correct
 *  forever and makes a repeat hive walk nearly free. */
const recordBySig = new Map<string, { kind?: string; payload?: Record<string, unknown> } | null>()

async function readDecorationRecord(
  store: ReadStore,
  sig: string,
): Promise<{ kind?: string; payload?: Record<string, unknown> } | null> {
  const known = recordBySig.get(sig)
  if (known !== undefined) return known
  let parsed: { kind?: string; payload?: Record<string, unknown> } | null = null
  try {
    const blob = await resolveLocalResourceReference(store, sig)
    if (blob && blob.size <= 256 * 1024) {
      const value = JSON.parse(await blob.text()) as { kind?: string; payload?: Record<string, unknown> }
      if (value && typeof value === 'object' && typeof value.kind === 'string') parsed = value
    }
  } catch { /* malformed or absent — not a decoration we can read */ }
  recordBySig.set(sig, parsed)
  return parsed
}

const readEnrollment = (
  payload: Record<string, unknown> | undefined,
  sigField: string,
): Enrollment | null => {
  const sig = String(payload?.[sigField] ?? '').toLowerCase()
  if (!SIG.test(sig)) return null
  const meaning = String(payload?.['meaning'] ?? '').trim()
  const order = payload?.['order']
  return typeof order === 'number' && Number.isFinite(order)
    ? { sig, meaning, order }
    : { sig, meaning }
}

/** Read one cell. `segments` is carried through untouched — this never signs or
 *  navigates anything, so it is safe on any layer a caller already holds. */
export async function readCell(
  store: ReadStore,
  layer: Record<string, unknown> | null,
  segments: readonly string[] = [],
): Promise<CellEnrollment> {
  if (!layer) return emptyCell(segments, {})
  const sigs = Array.isArray(layer['decorations'])
    ? (layer['decorations'] as unknown[]).map(s => String(s)).filter(s => SIG.test(s))
    : []
  if (sigs.length === 0) return emptyCell(segments, layer)

  const payloads = new Map<string, Record<string, unknown>[]>()
  const enrollments: Enrollment[] = []
  const marks: string[] = []
  const seen = new Set<string>()
  let names: SiteArtifact | null = null

  for (const sig of sigs) {
    const record = await readDecorationRecord(store, sig)
    if (!record?.kind) continue
    const payload = record.payload ?? {}
    const bucket = payloads.get(record.kind)
    if (bucket) bucket.push(payload)
    else payloads.set(record.kind, [payload])

    if (record.kind === ENROLLMENT_KIND) {
      const enrolled = readEnrollment(payload, 'sig')
      if (enrolled && !seen.has(enrolled.sig)) { seen.add(enrolled.sig); enrollments.push(enrolled) }
      continue
    }
    if (record.kind === SITE_ARTIFACT_KIND && !names) {
      const named = readEnrollment(payload, 'groupSig')
      if (named) {
        names = {
          groupSig: named.sig,
          meaning: named.meaning,
          name: String(payload['name'] ?? siteNameOf(named.meaning)),
        }
      }
      continue
    }
    if (record.kind === TAG_KIND) {
      const name = payload['name']
      if (typeof name === 'string' && name.trim()) marks.push(name.trim())
    }
  }

  // A site is a member of its own relation whether or not the membership record
  // landed — naming implies belonging, and a half-written pair must not silently
  // drop the site out of its own set.
  if (names && !seen.has(names.groupSig)) {
    enrollments.push({ sig: names.groupSig, meaning: names.meaning })
  }

  return {
    segments, name: segments[segments.length - 1] ?? '', layer,
    enrollments, names, marks, payloads,
  }
}

// ── the walk ────────────────────────────────────────────────────────

type WalkHistory = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
  getLayerBySig(sig: string): Promise<Record<string, unknown> | null>
}

/** Same ceiling the tag filter's hive walk uses — deep enough for any real hive,
 *  bounded so a cycle in a damaged tree cannot spin. */
const MAX_DEPTH = 32

/** Memo of one completed walk, dropped wholesale by `forgetEnrollments()`.
 *  Membership can change ANYWHERE in the hive, so nothing hands us a local head
 *  to key a cache on; dropping it on the structural signals a caller already
 *  reconciles for is the honest invalidation. */
let memoKey = ''
let memoResult: readonly CellEnrollment[] | null = null

/** Drop the walk memo. Call on `decorations:changed` / `cell:added` /
 *  `cell:removed`. */
export function forgetEnrollments(): void {
  memoKey = ''
  memoResult = null
}

/**
 * Every cell in the hive enrolled in at least one of `groupSigs`.
 *
 * Walks from the ROOT because a set is genuinely parentless: scoping to a
 * subtree would let a member filed elsewhere silently drop out of the set it
 * belongs to, which is the container coming back in through the side door.
 */
export async function enrolledCells(
  history: WalkHistory,
  store: ReadStore,
  groupSigs: readonly string[],
): Promise<readonly CellEnrollment[]> {
  const wanted = new Set(groupSigs.map(s => s.toLowerCase()).filter(s => SIG.test(s)))
  if (wanted.size === 0) return []
  const key = [...wanted].sort().join(',')
  if (memoKey === key && memoResult) return memoResult

  const out: CellEnrollment[] = []
  const visited = new Set<string>()

  const walk = async (segments: readonly string[], depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) return
    const path = segments.join(SEP)
    if (visited.has(path)) return
    visited.add(path)
    let layer: Record<string, unknown> | null = null
    try {
      layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => segments }))
    } catch { return }
    if (!layer) return
    if (segments.length > 0) {
      const cell = await readCell(store, layer, segments)
      if (cell.enrollments.some(e => wanted.has(e.sig))) out.push(cell)
    }
    for (const childSig of childSigsOf(layer as Parameters<typeof childSigsOf>[0])) {
      let name = ''
      try {
        const ref = await history.getLayerBySig(String(childSig))
        name = typeof ref?.['name'] === 'string' ? (ref['name'] as string) : ''
      } catch { /* unreadable child ref — skip it, keep the walk going */ }
      if (name) await walk([...segments, name], depth + 1)
    }
  }

  try { await walk([], 0) } catch { /* cold read — return what we reached */ }

  memoKey = key
  memoResult = Object.freeze(out)
  return memoResult
}

// ── position ────────────────────────────────────────────────────────

/** A member's position in ONE site — read off the mark that put it there.
 *  Unplaced sorts last. `fallback` lets a caller supply a retired per-member
 *  order so sets authored under a container model keep their sequence. */
export const orderIn = (
  cell: CellEnrollment,
  groupSigs: ReadonlySet<string>,
  fallback?: (cell: CellEnrollment) => number | undefined,
): number => {
  for (const enrolled of cell.enrollments) {
    if (groupSigs.has(enrolled.sig) && typeof enrolled.order === 'number') return enrolled.order
  }
  const legacy = fallback?.(cell)
  return typeof legacy === 'number' && Number.isFinite(legacy) ? legacy : Number.POSITIVE_INFINITY
}

/** Order a set: authored position first, then location, so members with no
 *  position yet are stable rather than arbitrary. */
export function ordered(
  cells: readonly CellEnrollment[],
  groupSigs: readonly string[],
  fallback?: (cell: CellEnrollment) => number | undefined,
): CellEnrollment[] {
  const wanted = new Set(groupSigs.map(s => s.toLowerCase()))
  return [...cells].sort((a, b) => {
    const ao = orderIn(a, wanted, fallback)
    const bo = orderIn(b, wanted, fallback)
    if (ao !== bo) return ao - bo
    return a.segments.join('/').localeCompare(b.segments.join('/'))
  })
}

/** The next free position in a set — what a newly enrolled tile takes. Derived
 *  from the members themselves; nothing anywhere keeps a counter. */
export const nextOrder = (
  cells: readonly CellEnrollment[],
  groupSigs: readonly string[],
  fallback?: (cell: CellEnrollment) => number | undefined,
): number => {
  const wanted = new Set(groupSigs.map(s => s.toLowerCase()))
  let max = -1
  for (const cell of cells) {
    const order = orderIn(cell, wanted, fallback)
    if (Number.isFinite(order) && order > max) max = order
  }
  return max + 1
}
