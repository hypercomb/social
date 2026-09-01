// Reading and extending a parent's children over the Claude Bridge — the ONE
// implementation, injected with whatever `send` the calling script already has.
//
// ─── THE TRAP THIS MODULE EXISTS TO RETIRE ────────────────────────────
//
// A parent layer's `children` slot holds LAYER signatures. A layer sig is NOT
// a resource: `get-resource` on one answers `resource not found: <sig>`. Every
// script that decoded child names that way therefore reported an EMPTY parent
// for a perfectly healthy hive — silently, and POSITIVELY. Verified live
// 2026-08-30: a root reporting `children: 15` decoded to `[]`.
//
// That empty read was then fed straight into the obvious write:
//
//     const have = await childNamesOf(parent)          // [] — wrongly
//     update(parent, { name, children: [...have, ...missing] })
//
// and `committer.update` with a `children` array is a SET op that REPLACES the
// slot (the bridge worker says so itself, in `#add`). So the merge that was
// written to be conservative would have deleted every sibling it could not see.
//
// ─── THE TWO RULES ────────────────────────────────────────────────────
//
//  1. To find out whether a child exists, ask whether the CHILD PATH resolves
//     (`cellExists`) — one cheap call, no sig-to-name decoding in the write
//     path at all. Enumerating the parent is for reporting, not for writing.
//
//  2. To create, use `op:'add'`, which the committer turns into an APPEND for
//     the parent's slot. It cannot drop a sibling even if a read were wrong.
//     Never `update` with a `children` array to grow a parent.
//
// And when a read IS needed, `childNamesOf` THROWS rather than under-report: a
// parent that lists children but decodes to none means the READER is broken,
// not the hive, and no caller may act on that answer.

/**
 * @typedef {{ ok: boolean, data?: any, error?: string }} BridgeRes
 * @typedef {(req: Record<string, unknown>) => Promise<BridgeRes>} Send
 */

/**
 * Bind the helpers to a script's own bridge client.
 * @param {Send} send
 */
export function hiveChildren(send) {
  /**
   * Turn ONE child signature into that child's name.
   *
   * `layer-by-sig` is the one-hop read — sig in, that layer's own bytes out,
   * slots left as sigs. A renderer running a bee built before that op exists
   * answers "unknown op", so fall back to `inflate`, which is correct but
   * resolves the whole subtree to read one string (88 KB for one name, live).
   * Never `get-resource`: that is the trap at the top of this file.
   *
   * @param {string} sig
   * @returns {Promise<string | null>}
   */
  async function nameOfChild(sig) {
    const direct = await send({ op: 'layer-by-sig', cell: sig })
    if (direct.ok) {
      const name = direct.data && direct.data.name
      return typeof name === 'string' && name.trim() ? name.trim() : null
    }
    if (!/unknown op/.test(direct.error || '')) return null
    const inflated = await send({ op: 'inflate', cell: sig })
    if (!inflated.ok) return null
    const name = inflated.data && inflated.data.name
    return typeof name === 'string' && name.trim() ? name.trim() : null
  }

  /**
   * Names for an ALREADY-READ `children` sig array. Same guard as
   * `childNamesOf`: a non-empty slot that decodes to nothing is a broken
   * reader, not an empty parent, and it throws rather than under-report.
   *
   * @param {readonly unknown[]} sigs
   * @param {string} [where] label for the error message
   * @returns {Promise<string[]>}
   */
  async function namesOfChildSigs(sigs, where = 'a parent') {
    const list = Array.isArray(sigs) ? sigs.map(String) : []
    const names = []
    for (const sig of list) {
      const name = await nameOfChild(sig)
      if (name) names.push(name)
    }
    if (list.length && !names.length) {
      throw new Error(
        `child read is broken: ${where} lists ${list.length} children but not one name ` +
        'resolved. Refusing to report an empty parent — a caller that merged onto this ' +
        'would wipe the slot.',
      )
    }
    return names
  }

  /**
   * Child NAMES under `segments`; `null` when there is no layer there at all
   * (so callers can tell "nothing here yet" from "here and empty").
   *
   * THROWS when the parent lists children and not one name resolved — see the
   * header. Reporting only: never feed this into a `children:` write.
   *
   * @param {readonly string[]} segments
   * @returns {Promise<string[] | null>}
   */
  async function childNamesOf(segments) {
    const layer = await send({ op: 'layer-at', segments })
    if (!layer.ok) return null
    return namesOfChildSigs(
      layer.data && layer.data.children,
      `/${segments.join('/') || '(root)'}`,
    )
  }

  /**
   * How many children the parent claims — the cheap structural check, with no
   * name decoding at all. `-1` when there is no layer at `segments`.
   * @param {readonly string[]} segments
   * @returns {Promise<number>}
   */
  async function childCount(segments) {
    const layer = await send({ op: 'layer-at', segments })
    if (!layer.ok) return -1
    return Array.isArray(layer.data && layer.data.children) ? layer.data.children.length : 0
  }

  /**
   * Does a cell exist at this exact path? One call, no name decoding.
   * @param {readonly string[]} segments
   * @returns {Promise<boolean>}
   */
  async function cellExists(segments) {
    const r = await send({ op: 'layer-at', segments })
    return !!r.ok
  }

  /**
   * Make sure every name in `wanted` exists under `parent`, WITHOUT ever
   * reading or rewriting the parent's children slot. Idempotent, append-only.
   *
   * `batch` splits the `add` — a single commit carrying hundreds of new
   * children can freeze the renderer hard enough that the tab reloads
   * mid-write. Each batch is its own APPEND, so a failure part-way through
   * leaves the earlier batches landed and drops nothing.
   *
   * @param {readonly string[]} parent
   * @param {readonly string[]} wanted
   * @param {{ dry?: boolean, batch?: number }} [opts]
   * @returns {Promise<{ ok: boolean, missing: string[], added: number, error?: string }>}
   */
  async function ensureChildren(parent, wanted, opts = {}) {
    const { dry = false, batch = 100 } = opts
    const missing = []
    for (const name of wanted) {
      if (await cellExists([...parent, name])) continue
      missing.push(name)
    }
    if (!missing.length) return { ok: true, missing, added: 0 }
    if (dry) return { ok: true, missing, added: 0 }
    let added = 0
    for (let i = 0; i < missing.length; i += batch) {
      const slice = missing.slice(i, i + batch)
      const r = await send({ op: 'add', segments: parent, cells: slice })
      if (!r.ok) return { ok: false, missing, added, error: r.error }
      added += slice.length
    }
    return { ok: true, missing, added }
  }

  return { nameOfChild, namesOfChildSigs, childNamesOf, childCount, cellExists, ensureChildren }
}
