// pool.mjs — the system pools of meaning, modelled faithfully enough to prove
// the reserved-bare-word collision and the design's answer.
//
// sign(meaning) is sha256(utf8(meaning)) — byte-identical to sign(canon(name))
// for a bare word. `putPoolDoc` keeps exactly ONE current record and deletes
// its siblings — but only siblings that are FILES (store.ts:253-260). That one
// guard is what lets a contributor bucket (a DIR) live in the same directory.

import { sha256, signText, bytesOf } from './sig.mjs'

/** Frozen bare-word pool meanings — every one of them is also a legal tile name. */
export const BARE_WORD_POOL_MEANINGS = Object.freeze([
  'authored', 'bees', 'clipboard', 'computation', 'dependencies', 'host-push',
  'host-receipts', 'manifests', 'optimization', 'overrides', 'patches', 'push',
  'receipts', 'registry', 'roots', 'structure', 'temporary', 'threads',
  'translations', 'viewport', 'visual-optimization',
])

export const poolSignature = (meaning) => signText(meaning)

/** Write the single current record of a document pool. */
export const putPoolDoc = (root, meaning, doc) => {
  const pool = poolSignature(meaning)
  const bytes = bytesOf(doc)
  const sig = sha256(bytes)
  for (const entry of root.list(pool)) {
    // THE ENTRY DECIDES: only files are pool records. Dirs are contributor
    // buckets belonging to a tile that happens to carry this word as its name.
    if (entry.kind === 'file' && entry.name !== sig) root.remove(`${pool}/${entry.name}`)
  }
  root.write(`${pool}/${sig}`, bytes)
  return sig
}

export const getPoolDoc = (root, meaning) => {
  const pool = poolSignature(meaning)
  const file = root.list(pool).find((e) => e.kind === 'file')
  if (!file) return null
  return JSON.parse(root.read(`${pool}/${file.name}`).toString('utf8'))
}
