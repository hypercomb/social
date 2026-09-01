// presentation/tiles/template-target.ts
//
// THE TARGET — where an arrangement is plugged in.
//
// `layout:template` is the mark a container wears to say which arrangement it
// reads through. It holds ONE signature: the root layout piece
// (layout-piece.ts). Everything about the design — which layouts, nested how
// deep, with what measurements — is behind that signature, content-addressed
// and shared.
//
// So the mark is the same shape `layout:frame` uses for hex patterns
// (sequence/frame-target.ts): a name for humans, a signature for the machine.
// N containers on the same arrangement are N references to one record; the
// first to load it serves the rest.
//
// ── WHY THE BINDING DOES NOT CASCADE, THOUGH THE VARIABLES DO ───────────
//
// `layout:frame` cascades: being framed is a fact about a PLACE, and every
// descendant of a framed branch is in that place. A layout is not that. A
// container is a specific artifact that has holes; what goes IN the holes is
// not itself a container unless somebody says so. Cascading the binding would
// make every page in a branch a container full of empty boxes.
//
// So the binding is node-local — you set the targets, one per container. The
// VARIABLES cascade, in the one place a cascade belongs: CSS. A nested piece
// declares only what it changes and inherits the rest through the document.
//
// ── EDITING IS A MERKLE UPDATE ──────────────────────────────────────────
//
// Change one level and that level re-mints, and so does the chain above it,
// and nothing else moves. That is not an optimisation bolted on; it is what
// falls out of a hole holding a signature rather than a record.

import {
  listDecorations,
  removeDecoration,
  removeDecorationAndWait,
  replaceDecoration,
} from '../../commands/decoration-manifest.js'
import {
  layoutTemplateRecord,
  parseLayoutTemplate,
  templateSlug,
  type LayoutNode,
  type LayoutTemplate,
} from './layout-template.js'
import { mintTree, resolveTree } from './layout-piece.js'
import { fetchThroughContentHop } from './artifact-content.js'

/** The mark a container wears. Sibling of `layout:frame`, not of
 *  `view:default` — this is placement, not a surface. */
export const TEMPLATE_TARGET_KIND = 'layout:template'

const SIG = /^[0-9a-f]{64}$/

/** Which arrangement this container reads through. */
export interface TemplateTargetPayload {
  /** The ROOT layout's name. Discovery and labels only — the signature is the
   *  identity, exactly as with a frame's pattern. */
  readonly name: string
  /** Resource sig of the root `{ kind:'layout-piece', ... }` record. */
  readonly pieceSig: string
}

type StoreLike = {
  getResource(sig: string): Promise<Blob | null>
  putResource(blob: Blob): Promise<string>
}

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const store = (): StoreLike | undefined => get<StoreLike>('@hypercomb.social/Store')

// ── the pieces the store holds ───────────────────────────────────────────

/** Mint a layout template resource. Same shape in, same signature out — which
 *  is what makes two containers on one layout two references. */
export async function putTemplate(template: LayoutTemplate): Promise<string> {
  const facade = store()
  if (!facade?.putResource) return ''
  const record = layoutTemplateRecord(template)
  const blob = new Blob([JSON.stringify(record)], { type: 'application/json' })
  return facade.putResource(blob)
}

/** Load a template through its meta envelope. Null for anything that is not
 *  one, so a dangling reference degrades to "no layout" rather than to a
 *  broken page.
 *
 *  THROUGH THE HOP: a piece holds the envelope's signature, not the template's
 *  (layout-piece.ts). `Store.getResource` does not follow it, so fetching the
 *  reference directly would hand back the envelope's own JSON — which parses
 *  as no template at all, and the whole arrangement would silently vanish. */
export async function loadTemplate(templateRef: string): Promise<LayoutTemplate | null> {
  const facade = store()
  if (!SIG.test(String(templateRef ?? '').toLowerCase()) || !facade?.getResource) return null
  try {
    const blob = await fetchThroughContentHop(templateRef, sig => facade.getResource(sig))
    if (!blob) return null
    return parseLayoutTemplate(JSON.parse(await blob.text()))
  } catch {
    return null
  }
}

/** Store a whole arrangement; returns the root signature AND everything the
 *  tree reaches. The closure is not a nicety — see `commitArrangement`. */
export async function putArrangement(
  node: LayoutNode,
): Promise<{ sig: string; closure: readonly string[] }> {
  const facade = store()
  if (!facade?.putResource) return { sig: '', closure: [] }
  const minted = await mintTree(node, putTemplate, blob => facade.putResource(blob))
  return minted ?? { sig: '', closure: [] }
}

/** Load a whole arrangement from its root signature. */
export async function readArrangement(pieceSig: string): Promise<LayoutNode | null> {
  const facade = store()
  if (!facade?.getResource) return null
  return resolveTree(pieceSig, loadTemplate, sig => facade.getResource(sig))
}

// ── the mark ─────────────────────────────────────────────────────────────

/**
 * Plug `segments` into an arrangement. One live record per container —
 * re-targeting replaces rather than piling, because "which layout is this" has
 * one answer.
 */
export function writeTemplateTarget(opts: {
  readonly segments: readonly string[]
  readonly name: string
  readonly pieceSig: string
  /** Every signature the arrangement reaches. The mark carries only the ROOT,
   *  and the push walk is single-level — without this the design does not
   *  travel and an adopter gets one orphan record. */
  readonly closure?: readonly string[]
}): Promise<string> {
  return replaceDecoration<TemplateTargetPayload>({
    kind: TEMPLATE_TARGET_KIND,
    appliesTo: opts.segments,
    segments: opts.segments,
    payload: {
      name: templateSlug(opts.name),
      pieceSig: String(opts.pieceSig ?? '').toLowerCase(),
    },
    refs: opts.closure,
    mark: 'persistent',
  })
}

/** The binding declared AT this location, if any. Node-local by design. */
export async function readTemplateTarget(
  segments: readonly string[],
): Promise<{ sig: string; payload: TemplateTargetPayload } | null> {
  const records = await listDecorations<TemplateTargetPayload>({
    kind: TEMPLATE_TARGET_KIND, segments,
  })
  const last = records.at(-1)
  if (!last) return null
  const pieceSig = String(last.record.payload?.pieceSig ?? '').toLowerCase()
  if (!SIG.test(pieceSig)) return null
  return {
    sig: last.sig,
    payload: { name: templateSlug(String(last.record.payload?.name ?? '')), pieceSig },
  }
}

/** Unplug this container. Its page goes back to being just its page, and the
 *  arrangement's records stay where they are — content-addressed, still
 *  reachable, and possibly still in use somewhere else. */
export async function removeTemplateTarget(segments: readonly string[]): Promise<boolean> {
  const records = await listDecorations<TemplateTargetPayload>({
    kind: TEMPLATE_TARGET_KIND, segments,
  })
  if (!records.length) return false
  for (const record of records) {
    await removeDecorationAndWait({ sig: record.sig, segments })
  }
  return true
}

/** Drop one specific binding without waiting — for a caller already inside a
 *  commit it is sequencing itself. */
export function dropTemplateTarget(sig: string, segments: readonly string[]): void {
  removeDecoration({ sig, segments })
}

/**
 * The arrangement this container reads through.
 *
 * Returns null when nothing is bound, when the binding dangles, or when the
 * store cannot be reached — every one of which means "compose without a
 * layout", never "fail".
 */
export async function resolveTemplateAt(segments: readonly string[]): Promise<{
  readonly template: LayoutTemplate
  readonly vars: Readonly<Record<string, string>>
  readonly node: LayoutNode
  readonly pieceSig: string
  readonly targetSig: string
} | null> {
  const target = await readTemplateTarget(segments)
  if (!target) return null
  const node = await readArrangement(target.payload.pieceSig)
  if (!node) return null
  return {
    template: node.template,
    vars: node.vars,
    node,
    pieceSig: target.payload.pieceSig,
    targetSig: target.sig,
  }
}

/** Store `node` and point `segments` at it. The one write path: every edit —
 *  plugging in, nesting, moving a variable — comes through here, so there is
 *  exactly one place where an arrangement becomes the arrangement. */
export async function commitArrangement(
  segments: readonly string[],
  node: LayoutNode,
): Promise<string> {
  const { sig, closure } = await putArrangement(node)
  if (!sig) return ''
  // The WHOLE tree's closure, not just the root. The push walker enqueues a
  // resource's declared refs and does not recurse into what it enqueues, and
  // the default adopt stops at depth 1 — so every level has to be named right
  // here or it never leaves this hive.
  await writeTemplateTarget({
    segments, name: node.template.name, pieceSig: sig, closure: [...closure, sig],
  })
  return sig
}
