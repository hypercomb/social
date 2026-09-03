// sig.mjs — signatures and canonical bytes. node:crypto only.

import { createHash } from 'node:crypto'

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

export const signText = (text) => sha256(Buffer.from(String(text), 'utf8'))

/** sha256('') — the empty-content sig. NO LONGER an address of anything else. */
export const EMPTY_SIG = signText('')

export const SIG_RE = /^[0-9a-f]{64}$/

const canonicalize = (v) => {
  if (Array.isArray(v)) return v.map(canonicalize) // ARRAY ORDER IS NEVER SORTED
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort()
        .map((k) => [k, canonicalize(v[k])]),
    )
  return v
}

/** Stable key order; array order preserved — the array IS the meaning. */
export const canonicalJSON = (value) => JSON.stringify(canonicalize(value))

export const bytesOf = (obj) => Buffer.from(canonicalJSON(obj), 'utf8')

/**
 * REPAIR (skeptic-2 S2-3). Mining is an ALLOWLIST of EDGE FIELDS, never a scan
 * for anything that looks like a signature.
 *
 * A tile NAME is participant text and may legally be 64 hex characters — the UI
 * shows the user signatures all day. Under a "any 64-hex string is an edge"
 * miner, such a name became a phantom edge (every replication 404s forever) or,
 * worse, a REAL edge (a copied sig keeps a dead atom alive and a rename un-roots
 * it). Names, author ids, `prev`, `genesis` and `pub` are never fetched.
 *
 * `prev`/`genesis` are deliberately NOT edges: the head's closure is THE CURRENT
 * PAGE. History is fetched on demand (pullHistory), which is what makes a cold
 * read O(page) instead of O(every edit ever made) — skeptic-4 C.
 */
export const EDGE_FIELDS = new Set([
  'layer', 'members', 'properties', 'decorations', 'refs', 'content', 'heads',
])

/** Every atom signature reachable from an atom through declared EDGE fields. */
export const mineSignatures = (value, out = new Set(), inEdge = false) => {
  if (typeof value === 'string') {
    if (inEdge && SIG_RE.test(value)) out.add(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const v of value) mineSignatures(v, out, inEdge)
    return out
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      mineSignatures(v, out, EDGE_FIELDS.has(k) || (inEdge && !Number.isNaN(Number(k))))
    }
  }
  return out
}
