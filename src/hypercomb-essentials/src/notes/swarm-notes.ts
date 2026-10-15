// notes/swarm-notes.ts
//
// The pure half of notes in the swarm (swarm-notes.service.ts is the other):
// the shapes, the fold of what peers hold into peer roots, and a
// participant's colour. A dependency atom — no store, no swarm, no DOM — so
// the service and its spec share it without a bee ever being imported for a
// value.

/** A note tree, as the notes service hydrates it. */
export interface SwarmNote {
  id: string
  text: string
  shape: string | null
  mark: string | null
  tags: string[]
  children: SwarmNote[]
}

/** One peer root on a tile: the tree, who brought it, everyone holding it. */
export interface PeerNoteRoot {
  readonly note: SwarmNote
  readonly by: string
  readonly holders: readonly string[]
}

/** The room on a tile, counted. */
export interface SwarmNoteCounts {
  readonly people: number
  readonly notes: number
  readonly yours: number
  readonly open: number
}

/** Fold one read of the room into peer roots. Pure. `own` is this hive's
 *  root ids on the tile; a root a peer holds that is also one of `own` is not
 *  a peer root (it is yours) — its holders are reported in `heldMine`.
 *  `firstHolder` is the caller's memory (id → pubkey) so a note keeps the
 *  colour of whoever brought it after they leave and someone else holds it. */
export function foldPeerRoots(
  own: readonly string[],
  peers: readonly { pubkey: string; notes: readonly SwarmNote[] }[],
  firstHolder: Map<string, string>,
): { roots: PeerNoteRoot[]; heldMine: Map<string, string[]> } {
  const mine = new Set(own)
  const byId = new Map<string, { note: SwarmNote; holders: string[] }>()
  const heldMine = new Map<string, string[]>()
  for (const { pubkey, notes } of peers) {
    for (const note of notes) {
      if (mine.has(note.id)) {
        const bag = heldMine.get(note.id) ?? []
        if (!bag.includes(pubkey)) bag.push(pubkey)
        heldMine.set(note.id, bag)
        continue
      }
      const entry = byId.get(note.id)
      if (entry) { if (!entry.holders.includes(pubkey)) entry.holders.push(pubkey) }
      else byId.set(note.id, { note, holders: [pubkey] })
    }
  }
  const roots: PeerNoteRoot[] = []
  for (const [id, { note, holders }] of byId) {
    if (!firstHolder.has(id)) firstHolder.set(id, holders[0])
    const by = firstHolder.get(id)!
    roots.push({ note, by: holders.includes(by) ? by : holders[0], holders })
  }
  return { roots, heldMine }
}

/** The colour a note wears for the participant who brought it — DJB2 → HSL,
 *  the same algorithm the layer-cycle strip uses for a participant, so one
 *  participant is one colour on the canvas, the strip and the notes. */
export function participantColor(pubkey: string): string {
  if (!pubkey) return 'rgb(126, 182, 214)'
  let hash = 5381
  for (let i = 0; i < pubkey.length; i++) hash = ((hash << 5) + hash + pubkey.charCodeAt(i)) | 0
  hash = hash >>> 0
  const hue = (hash % 360) / 360
  const sat = 0.65
  const lit = 0.6
  const c = (1 - Math.abs(2 * lit - 1)) * sat
  const x = c * (1 - Math.abs(((hue * 6) % 2) - 1))
  const m = lit - c / 2
  let r = 0, g = 0, b = 0
  const sector = (hue * 6) | 0
  if (sector === 0)      { r = c; g = x; b = 0 }
  else if (sector === 1) { r = x; g = c; b = 0 }
  else if (sector === 2) { r = 0; g = c; b = x }
  else if (sector === 3) { r = 0; g = x; b = c }
  else if (sector === 4) { r = x; g = 0; b = c }
  else                   { r = c; g = 0; b = x }
  return `rgb(${Math.round((r + m) * 255)}, ${Math.round((g + m) * 255)}, ${Math.round((b + m) * 255)})`
}
