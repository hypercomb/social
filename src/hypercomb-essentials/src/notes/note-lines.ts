// notes/note-lines.ts
//
// THE LINES — a swarm room read as note lines instead of hexagons (jwize
// 2026-10-13: "a swarm with a note interface instead of hexagons").
//
// Same swarm, same acts: everyone shares what they hold, a take collects a
// line, leaving takes your untaken lines with you. A note is a FILE — its
// signature is the line's identity — and the page's notes are references to
// it. So one note held by thirty participants is ONE line with thirty
// holders, never thirty lines.
//
// Pure: no store, no swarm, no DOM. The view feeds it what it read and paints
// what it returns. A dependency atom, so the view bee and its spec share it
// without a bee ever being imported for a value.

/** The view mode the lines are — a string, like 'tree' or 'slides'. */
export const LINES_VIEW = 'lines'

/** One line in the room. */
export interface NoteLine {
  readonly sig: string
  /** The note's text, or null while its bytes have not arrived. */
  readonly text: string | null
  /** Everyone holding it here, in the order they were first seen holding it;
   *  '' is this participant. The first holder colours the line. */
  readonly holders: readonly string[]
  /** This participant holds it (wrote it, or took it). */
  readonly mine: boolean
  /** Who brought it into the room ('' = this participant) — its colour. */
  readonly by: string
}

/** The room at a glance — what the top of the lines says. */
export interface NoteLineCounts {
  /** Participants in the room, this one included. */
  readonly people: number
  /** Distinct lines anyone here holds. */
  readonly lines: number
  /** Lines this participant holds. */
  readonly mine: number
  /** Lines others hold that this participant has not taken. */
  readonly open: number
}

export interface NoteLineInput {
  /** This participant's notes on the page, in their list order. */
  readonly own: readonly string[]
  /** Every (note, holder) a peer says on the page. */
  readonly peers: readonly { readonly sig: string; readonly peerPubkey: string }[]
  /** First-seen order, kept by the caller across reads: sig → ms. A line
   *  never moves once it has a place. */
  readonly firstSeen: Map<string, number>
  /** First holder of each line, kept by the caller: sig → pubkey ('' = me).
   *  Stays when the holder leaves after someone took it, so a taken line
   *  keeps the colour of whoever brought it into the room. */
  readonly firstHolder: Map<string, string>
  /** Resolved texts: sig → text. */
  readonly texts: ReadonlyMap<string, string>
  /** Participants in the room besides this one. */
  readonly peopleHere: number
  /** Now, for stamping lines seen for the first time. */
  readonly now: number
}

/** Fold one read of the room into lines, oldest first. Stamps first-seen and
 *  first-holder for lines it has not met before (the caller's maps). */
export function foldNoteLines(input: NoteLineInput): { lines: NoteLine[]; counts: NoteLineCounts } {
  const holders = new Map<string, string[]>()
  const add = (sig: string, holder: string): void => {
    const bag = holders.get(sig)
    if (!bag) holders.set(sig, [holder])
    else if (!bag.includes(holder)) bag.push(holder)
  }
  // Own list first, in its order, so a burst of my own notes keeps my order.
  let tick = 0
  for (const sig of input.own) {
    add(sig, '')
    if (!input.firstSeen.has(sig)) input.firstSeen.set(sig, input.now + tick++ / 1000)
  }
  for (const { sig, peerPubkey } of input.peers) {
    add(sig, peerPubkey)
    if (!input.firstSeen.has(sig)) input.firstSeen.set(sig, input.now + tick++ / 1000)
  }
  const own = new Set(input.own)
  const lines: NoteLine[] = []
  for (const [sig, bag] of holders) {
    if (!input.firstHolder.has(sig)) input.firstHolder.set(sig, bag.find(h => h !== '') ?? '')
    const first = input.firstHolder.get(sig) ?? ''
    // The first holder leads; the rest keep the order they were seen in.
    const ordered = bag.includes(first) ? [first, ...bag.filter(h => h !== first)] : bag
    lines.push({ sig, text: input.texts.get(sig) ?? null, holders: ordered, mine: own.has(sig), by: first })
  }
  lines.sort((a, b) => (input.firstSeen.get(a.sig) ?? 0) - (input.firstSeen.get(b.sig) ?? 0))
  const mine = lines.filter(l => l.mine).length
  return {
    lines,
    counts: { people: input.peopleHere + 1, lines: lines.length, mine, open: lines.length - mine },
  }
}

/** The colour a line wears for the participant who brought it. Deterministic
 *  per key (DJB2 → HSL), the SAME algorithm the layer-cycle strip uses
 *  (hypercomb-shared/ui/layer-cycle-strip — a shell file this module may not
 *  import), so a participant is one colour on the canvas, the strip and the
 *  lines. '' (this participant) is the house accent. */
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
