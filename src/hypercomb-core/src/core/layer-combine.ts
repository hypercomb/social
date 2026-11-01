// core/layer-combine.ts
//
// COMBINE, never replace. A layer that arrives at a place where the
// participant already holds one (paste, adopt, chat create, swarm take) is
// folded INTO what they own: the owner's values win, the incoming layer only
// fills what is absent, and nothing the owner lists is ever dropped. Data
// never heals — a lost child keeps its bytes and bag but loses its parent
// reference, which is an orphan; this primitive cannot produce one.
//
// Pure: no I/O, no IoC, no async. Callers resolve whatever the rules need
// (a sig's child name, a blob's bytes) and hand it in.
//
// Rules, per slot:
//   list slot   own order first, then incoming entries not already present
//               (string dedup; JSON-key dedup for inline payloads). Never
//               removes an entry.
//   child slot  as a list slot, plus — when `nameOf` is supplied — an
//               incoming child whose NAME the owner already lists under a
//               different sig is NOT appended (the owner's sig stands). It is
//               reported in `sameName` so the caller can combine the two
//               child layers one level down and swap the result in.
//   blob slot   (`properties`, `order`: one sig naming a JSON object, readers
//               take [0]). A sig union would leave the incoming sig where
//               nothing reads it, so the owner's blob stands and a differing
//               incoming blob is reported in `blobs`. Merge those at the BLOB
//               level with combineBags(), putResource, and write ONE sig.
//   scalar      own wins when present (not undefined/null/''); incoming fills
//               an absent one.
//   name        own, else incoming.
//
// `nothingLost(own, result)` is the invariant, exported so callers and specs
// can assert it.

export type LayerLike = { name?: string } & Record<string, unknown>

/** Slots whose value is ONE sig naming a JSON object (read as [0]). */
export const BLOB_SLOTS: ReadonlySet<string> = new Set(['properties', 'order'])

/** Slots whose entries are child layer sigs (see level-roster CHILD_SLOTS). */
export const COMBINE_CHILD_SLOTS: ReadonlySet<string> = new Set(['cells', 'layers', 'children'])

/** The picture keys of a tile's properties bag, owned as ONE unit: if the
 *  participant wears any of them, none of the incoming picture is mixed in. */
export const PICTURE_UNIT: readonly string[] = ['small', 'flat', 'large', 'imageSig', 'point']

export interface CombineOptions {
  /** Slots held as one blob sig. Default BLOB_SLOTS. */
  blobSlots?: ReadonlySet<string>
  /** Slots whose entries are child sigs. Default COMBINE_CHILD_SLOTS. */
  childSlots?: ReadonlySet<string>
  /** Resolve a child sig to its name (from a manifest / loaded layer), or
   *  undefined when unknown. Unknown names fall back to plain sig union. */
  nameOf?: (sig: string) => string | undefined
}

export interface CombineResult {
  layer: LayerLike
  /** True when `layer` differs from `own` (something was filled or added). */
  changed: boolean
  /** Same-name children the owner already lists under a different sig: the
   *  owner's sig is kept; combine the two child layers and swap `own` -> result. */
  sameName: { slot: string; name: string; own: string; incoming: string }[]
  /** Blob slots where both sides hold a different sig: merge with combineBags. */
  blobs: { slot: string; own: string; incoming: string }[]
}

const present = (v: unknown): boolean => v !== undefined && v !== null && v !== ''
const keyOf = (e: unknown): string => (typeof e === 'string' ? e : JSON.stringify(e))

export function combineLayers(
  own: LayerLike | null | undefined,
  incoming: LayerLike | null | undefined,
  opts: CombineOptions = {},
): CombineResult {
  const blobSlots = opts.blobSlots ?? BLOB_SLOTS
  const childSlots = opts.childSlots ?? COMBINE_CHILD_SLOTS
  const nameOf = opts.nameOf
  const sameName: CombineResult['sameName'] = []
  const blobs: CombineResult['blobs'] = []

  const o = own ?? {}
  const inc = incoming ?? {}
  const layer: LayerLike = { ...o }
  let changed = false

  const name = present(o.name) ? o.name : inc.name
  if (present(name)) layer.name = name
  if (name !== o.name) changed = true

  for (const slot of Object.keys(inc)) {
    if (slot === 'name') continue
    const iv = inc[slot]
    const ov = o[slot]

    if (Array.isArray(iv)) {
      if (iv.length === 0) continue
      const ownList: unknown[] = Array.isArray(ov) ? ov : []

      if (blobSlots.has(slot)) {
        if (ownList.length === 0) { layer[slot] = iv.slice(); changed = true; continue }
        const a = ownList[0], b = iv[0]
        if (typeof a === 'string' && typeof b === 'string' && a !== b) blobs.push({ slot, own: a, incoming: b })
        continue // the owner's blob stands
      }

      const seen = new Set(ownList.map(keyOf))
      const ownNames = new Map<string, string>() // name -> own sig (child slots)
      if (nameOf && childSlots.has(slot)) {
        for (const e of ownList) {
          if (typeof e !== 'string') continue
          const n = nameOf(e)
          if (n && !ownNames.has(n)) ownNames.set(n, e)
        }
      }
      const next = ownList.slice()
      for (const e of iv) {
        const k = keyOf(e)
        if (seen.has(k)) continue
        if (typeof e === 'string' && ownNames.size > 0) {
          const n = nameOf!(e)
          const held = n ? ownNames.get(n) : undefined
          if (n && held && held !== e) { sameName.push({ slot, name: n, own: held, incoming: e }); continue }
        }
        seen.add(k)
        next.push(e)
      }
      if (next.length !== ownList.length) { layer[slot] = next; changed = true }
      continue
    }

    // scalar: own wins when present, incoming only fills an absent one
    if (present(iv) && !present(ov) && !(Array.isArray(ov) && ov.length > 0)) {
      layer[slot] = iv
      changed = true
    }
  }

  return { layer, changed, sameName, blobs }
}

/**
 * Blob-level combine for a properties-like bag: the owner's keys win, the
 * incoming bag fills only keys the owner lacks. Keys named together in a
 * `units` group travel as one: if the owner has ANY key of a unit, no
 * incoming key of that unit is taken (default PICTURE_UNIT, so a worn picture
 * is never half-replaced). `skip` keys are never taken from incoming (e.g.
 * 'index': the seat is the page order slot, not a field in a tile body).
 */
export function combineBags(
  own: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
  opts: { units?: readonly (readonly string[])[]; skip?: readonly string[] } = {},
): { bag: Record<string, unknown>; changed: boolean } {
  const o = own ?? {}
  const inc = incoming ?? {}
  const units = opts.units ?? [PICTURE_UNIT]
  const skip = new Set(opts.skip ?? [])
  const bag: Record<string, unknown> = { ...o }
  let changed = false

  const heldUnit = (k: string): boolean => {
    for (const u of units) if (u.includes(k)) return u.some(x => present(o[x]))
    return false
  }
  for (const k of Object.keys(inc)) {
    if (skip.has(k) || present(o[k]) || heldUnit(k) || !present(inc[k])) continue
    bag[k] = inc[k]
    changed = true
  }
  return { bag, changed }
}

/** Invariant: every list entry and every present scalar of `own` survives in `result`. */
export function nothingLost(own: LayerLike | null | undefined, result: LayerLike): boolean {
  if (!own) return true
  for (const slot of Object.keys(own)) {
    if (slot === 'name') continue
    const ov = own[slot]
    const rv = result[slot]
    if (Array.isArray(ov)) {
      if (!Array.isArray(rv)) return ov.length === 0
      const have = new Set(rv.map(keyOf))
      if (!ov.every(e => have.has(keyOf(e)))) return false
    } else if (present(ov) && rv !== ov) return false
  }
  return true
}
