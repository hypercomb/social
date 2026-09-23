// presentation/tiles/tree-view-target.ts
//
// The tree view's name and the `/tree` target parser — shared by the tree
// view bee and the tree word, so it is a dependency atom: a bee is never
// imported for a value (atomic-modules-plan.md).

import type { TreeRoot } from './tree-walk.js'

export const TREE_VIEW = 'tree'

const SIG = /^[0-9a-f]{64}$/

/** Parse a `/tree` argument into a root. Accepts a raw signature, a lineage
 *  path, or nothing (the current location). Names registered by `/branch`
 *  are resolved by the queen, which owns the registry. */
export function parseTreeTarget(raw: string): TreeRoot | null {
  const value = String(raw ?? '').trim()
  if (!value) return null
  if (SIG.test(value.toLowerCase())) return { sig: value.toLowerCase() }
  const segments = value.split('/').map(s => s.trim()).filter(Boolean)
  return { segments }
}
