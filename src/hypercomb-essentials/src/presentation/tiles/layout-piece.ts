// presentation/tiles/layout-piece.ts
//
// A LAYOUT PIECE IS AN ARTIFACT, AND NESTING IS A SIGNATURE.
//
// A piece is one level of an arrangement: which layout it uses, what it
// changes about it, and — for each hole — the reference to the piece nested
// there. Not the piece itself. A reference.
//
// That single choice is what makes an arrangement atomic rather than a blob:
//
//   • two containers that end up with the same arrangement mint the SAME
//     signature and share one record, so the first one to load it serves every
//     other one;
//   • a piece can be lifted out and dropped anywhere, because it names nothing
//     above it and depends on nothing but the pieces it nests;
//   • editing one level re-mints that level and the chain above it, exactly as
//     a merkle tree does — everything else keeps the signature it had.
//
// Inlining the tree into one record would have looked simpler and would have
// broken all three, as well as the standing rule that a field referencing
// content holds a signature and never the content.
//
// ── EVERY REFERENCE IS A TYPED HOP ──────────────────────────────────────
//
// The Life Primitive (`@hypercomb/core` life-primitive.ts): *every artifact
// reference is the signature of a meta envelope, and the envelope declares
// exactly one typed payload hop.* A field never holds the bytes' own
// signature — that is an untyped hop, and there are none.
//
// So `template` and each entry of `holes` hold ENVELOPE signatures:
//
//     { "meta": 1, "resource": "<the layout template's bytes>", "relation": "layout" }
//     { "meta": 1, "resource": "<the nested piece's bytes>",    "relation": "hole" }
//
// `relation` names the ROLE, never the hole KEY. Keying it by hole would mint
// a different envelope for the same nested arrangement in a different slot,
// which destroys exactly the dedup this file exists for.
//
// ── AND EVERY PIECE DECLARES ITS OWN CLOSURE ────────────────────────────
//
// `refs` is the flat set of every signature this level reaches: both envelopes
// and the payloads behind them. Without it the arrangement does not TRAVEL —
// the push walk is single-level and the decoration carries only the root, so
// an adopter would receive the mark, one orphan record, and a page that
// silently loses its layout. `mintTree` accumulates the whole tree's closure
// for the same reason one level up.
//
// ── WHAT A PIECE IS NOT ─────────────────────────────────────────────────
//
// It is not a container in the parenthood sense. It holds no content, names no
// tile, and knows nothing about what will be rendered into its holes. It is a
// SHAPE, composed of shapes. Content arrives from the other side, carrying its
// own position.
//
// The model is pure — records in, records out, with the store injected — so
// the composition can be argued with in a test.

import {
  nodeOf, type LayoutNode, type LayoutTemplate,
} from './layout-template.js'
import { contentEnvelope, fetchThroughContentHop } from './artifact-content.js'

/** The resource's own `kind` field — what a piece JSON says it is. */
export const LAYOUT_PIECE_KIND = 'layout-piece'

/** The role a hop plays. Stable per ROLE, never per hole — see the header. */
export const TEMPLATE_RELATION = 'layout'
export const HOLE_RELATION = 'hole'

/** How deep an arrangement may go. Deep enough that nobody meets it while
 *  designing, shallow enough that a damaged record cannot spin a walker. */
export const MAX_NESTING = 12

const SIG = /^[0-9a-f]{64}$/

/** One level of an arrangement, as it is stored. */
export interface LayoutPiece {
  readonly kind: typeof LAYOUT_PIECE_KIND
  readonly version: 1
  /** Envelope signature for the layout template this level uses. */
  readonly template: string
  /** What THIS level declares. Everything absent still inherits from the level
   *  above — see layout-template.ts on why that is the whole design. */
  readonly vars: Readonly<Record<string, string>>
  /** Hole key → the ENVELOPE signature of the piece nested there. Absent holes
   *  are where content goes. */
  readonly holes: Readonly<Record<string, string>>
  /** Flat closure: every signature this level reaches, envelopes included.
   *  What makes the arrangement travel. */
  readonly refs?: readonly string[]
}

export type PutResource = (blob: Blob) => Promise<string>
export type GetResource = (sig: string) => Promise<Blob | null>

/** A minted arrangement: its root signature and everything it reaches. */
export interface MintedTree {
  readonly sig: string
  /** Every signature in the tree — pieces, envelopes and templates. */
  readonly closure: readonly string[]
}

const sortedStrings = (
  source: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> => {
  const out: Record<string, string> = {}
  for (const key of Object.keys(source ?? {}).sort()) {
    const value = String((source as Record<string, string>)[key] ?? '')
    if (value) out[key] = value
  }
  return out
}

const sortedSigs = (
  source: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> => {
  const out: Record<string, string> = {}
  for (const key of Object.keys(source ?? {}).sort()) {
    const sig = String((source as Record<string, string>)[key] ?? '').toLowerCase()
    if (SIG.test(sig)) out[key] = sig
  }
  return out
}

/** Canonical record for a piece. Same arrangement in, same signature out —
 *  which is the dedup that lets one record serve every user of it. Keys are
 *  emitted in sorted order, and so is `refs`, so two identical arrangements
 *  built by different routes cannot mint two signatures. */
export function layoutPieceRecord(piece: {
  template: string
  vars?: Readonly<Record<string, string>>
  holes?: Readonly<Record<string, string>>
  refs?: readonly string[]
}): LayoutPiece {
  const refs = [...new Set((piece.refs ?? [])
    .map(sig => String(sig ?? '').toLowerCase())
    .filter(sig => SIG.test(sig)))].sort()
  return {
    kind: LAYOUT_PIECE_KIND,
    version: 1,
    template: String(piece.template ?? '').toLowerCase(),
    vars: sortedStrings(piece.vars),
    holes: sortedSigs(piece.holes),
    ...(refs.length ? { refs } : {}),
  }
}

/** Read a stored piece back. Null for anything that is not one, so a dangling
 *  signature degrades to "nothing nested here" rather than to a broken page. */
export function parseLayoutPiece(raw: unknown): LayoutPiece | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  if (source['kind'] !== LAYOUT_PIECE_KIND) return null
  const template = String(source['template'] ?? '').toLowerCase()
  if (!SIG.test(template)) return null
  return layoutPieceRecord({
    template,
    vars: source['vars'] as Record<string, string> | undefined,
    holes: source['holes'] as Record<string, string> | undefined,
    refs: source['refs'] as string[] | undefined,
  })
}

// ── minting ──────────────────────────────────────────────────────────────

/** Store one meta envelope and return ITS signature — what a field holds. */
async function mintHop(put: PutResource, bytesSig: string, relation: string): Promise<string> {
  const envelope = contentEnvelope(bytesSig, relation)
  return put(new Blob([JSON.stringify(envelope)], { type: 'application/json' }))
}

/**
 * Store a whole arrangement and return the root signature with its closure.
 *
 * Bottom-up, because a level cannot be named until the levels it nests are:
 * every child is minted first, and its envelope's signature is what the parent
 * records. A level whose content has not changed mints the signature it
 * already had, so an edit three levels down re-mints exactly the chain above
 * it and nothing else.
 */
export async function mintTree(
  node: LayoutNode,
  templateSigOf: (template: LayoutTemplate) => Promise<string>,
  put: PutResource,
  depth = 0,
): Promise<MintedTree | null> {
  if (depth > MAX_NESTING) return null
  const templateBytes = await templateSigOf(node.template)
  if (!SIG.test(String(templateBytes ?? '').toLowerCase())) return null
  const templateRef = await mintHop(put, templateBytes, TEMPLATE_RELATION)

  const closure = new Set<string>([templateRef, templateBytes.toLowerCase()])
  const holes: Record<string, string> = {}
  for (const [key, child] of Object.entries(node.nested)) {
    const minted = await mintTree(child, templateSigOf, put, depth + 1)
    if (!minted) continue
    const holeRef = await mintHop(put, minted.sig, HOLE_RELATION)
    holes[key] = holeRef
    closure.add(holeRef)
    closure.add(minted.sig)
    for (const sig of minted.closure) closure.add(sig)
  }

  const record = layoutPieceRecord({
    template: templateRef, vars: node.vars, holes, refs: [...closure],
  })
  const sig = await put(new Blob([JSON.stringify(record)], { type: 'application/json' }))
  closure.add(sig)
  return { sig, closure: [...closure] }
}

/**
 * Load a whole arrangement from its root signature.
 *
 * A level whose template cannot be loaded ends the branch rather than failing
 * the tree: one unreachable nested piece must never blank a page, and an
 * unfilled hole is a finished state (website-artifact-paradigm.md, rule 11).
 */
export async function resolveTree(
  rootSig: string,
  loadTemplate: (sig: string) => Promise<LayoutTemplate | null>,
  get: GetResource,
  depth = 0,
): Promise<LayoutNode | null> {
  if (depth > MAX_NESTING || !SIG.test(String(rootSig ?? '').toLowerCase())) return null
  const piece = parseLayoutPiece(await readJson(get, rootSig))
  if (!piece) return null
  const template = await loadTemplate(piece.template)
  if (!template) return null

  const nested: Record<string, LayoutNode> = {}
  for (const [key, ref] of Object.entries(piece.holes)) {
    // The hop first: a hole holds the envelope, and the envelope names the
    // piece. `readJson` follows it, so this is the piece's own record.
    const child = await resolveTree(ref, loadTemplate, get, depth + 1)
    if (child) nested[key] = child
  }

  // Only the ROOT merges the template's defaults in. A nested level declares
  // just its own changes, so everything it does not mention keeps falling
  // through from the level above — re-declaring the defaults at every depth is
  // exactly the mistake the shared variable vocabulary exists to prevent.
  const vars = depth === 0
    ? { ...template.vars, ...piece.vars }
    : { ...piece.vars }

  return nodeOf(template, vars, nested)
}

/** Read JSON THROUGH the content hop, so a field holding an envelope resolves
 *  to the record behind it. `Store.getResource` does not follow the hop; a
 *  caller that fetches a reference straight through it gets the envelope's own
 *  JSON and tries to read it as the record. */
async function readJson(get: GetResource, sig: string): Promise<unknown> {
  try {
    const blob = await fetchThroughContentHop(sig, get)
    if (!blob) return null
    return JSON.parse(await blob.text())
  } catch {
    return null
  }
}
