// Mirror pass for THE CHAT WINDOW'S 2026-08 PASS — three behaviours that
// arrived together, mirrored as three cells under `behaviors/assistant`:
//
//   chat-peek           fold the window away to the LIVE hive
//   chat-archive        put a conversation away instead of destroying it
//   chat-context-icon   point and click a tile onto the request
//
// THREE CELLS, because they are three behaviours and not one — but ONE
// script, because the plumbing is the same and every write here is
// idempotent, so a re-run of any of them is a re-run of all of them.
//
// ONE RESOURCE, ONE TILE. Each cell stays 1:1 with the file that IS the
// behaviour; every other implementation file becomes a child cell marked
// `part`. `behavior`, `assistant` and `part` are the declared vocabulary from
// the behaviors mirror — nothing is minted on the fly.
//
// EXTEND NEVER RE-CREATE. The collection is READ before anything is written
// and the pass ABORTS if it cannot be read (that is a missing behaviors
// mirror, not something for this pass to paper over). Children are UNIONED
// and every note goes through noteOnce, so a re-run adds only what is
// missing — this pass is safe to drain unattended.
//
// Requires a renderer on the bridge: open the hive with `?claudeBridge=1`.
import { createHash } from 'node:crypto'
import WebSocket from 'ws'

const BRIDGE_PORT = 2401
// A commit can legitimately take minutes in a background renderer mid-optimize.
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `mirror-${Date.now()}-${++counter}` }
    // Pin IPv4 loopback: a second listener on 2401 (0.0.0.0) swallows
    // `localhost` dials without answering — only 127.0.0.1 has the renderer.
    const ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, TIMEOUT)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw: unknown) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw)) as BridgeRes) } catch { reject(new Error('invalid response')) }
      ws.close()
    })
    ws.on('error', (err: Error) => { clearTimeout(timer); reject(new Error(`bridge connection failed: ${err.message}`)) })
  })
}

async function send(request: Record<string, unknown>): Promise<BridgeRes> {
  const res = await sendOnce(request)
  if (!res.ok && res.error === 'no renderer connected') {
    await new Promise(r => setTimeout(r, 4000))
    return sendOnce(request)
  }
  return res
}

/** Retry a lost response. Non-idempotent ops pass `landed` so a swallowed reply
 *  is never mistaken for a failed write and re-applied as a duplicate. */
async function sendRetry(
  request: Record<string, unknown>,
  landed?: () => Promise<boolean>,
): Promise<BridgeRes> {
  for (let attempt = 1; ; attempt++) {
    try { return await send(request) }
    catch (e) {
      if (landed && await landed().catch(() => false)) return { id: '', ok: true, data: 'landed after timeout' }
      if (attempt >= 3) throw e
      process.stdout.write(`(timeout — retry ${attempt}) `)
    }
  }
}

function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
    .replace(/[._\s/]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

const decorationSig = (kind: string, payload: Record<string, unknown>): string =>
  createHash('sha256').update(JSON.stringify({ kind, appliesTo: [], payload })).digest('hex')

const tagSig = (name: string): string => decorationSig('tag', { name })

async function mark(segments: string[], name: string): Promise<boolean> {
  const before = await send({ op: 'layer-at', segments })
  if (before.ok && ((before.data?.decorations ?? []) as string[]).includes(tagSig(name))) return true
  const res = await sendRetry(
    { op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } },
    async () => {
      // Decorations on a layer are SIGNATURE references — landed means the
      // canonical decoration content's sig appears in the list.
      const check = await send({ op: 'layer-at', segments })
      const decs = (check.data?.decorations ?? []) as string[]
      return check.ok && decs.includes(tagSig(name))
    },
  )
  return res.ok
}

/** Add a note only if this exact text is not already on the cell. `note-add`
 *  is additive, so the text IS the idempotence key — every re-run of this pass
 *  must be safe, including on a cell an earlier creation already annotated. */
async function noteOnce(segments: string[], text: string): Promise<'written' | 'present' | 'failed'> {
  const list = await send({ op: 'note-list', segments })
  const has = (res: BridgeRes): boolean =>
    res.ok && Array.isArray(res.data) && res.data.some((x: any) => String(x?.text ?? '') === text)
  if (has(list)) return 'present'
  const res = await sendRetry(
    { op: 'note-add', segments: segments.slice(0, -1), cell: segments[segments.length - 1], text },
    async () => has(await send({ op: 'note-list', segments })),
  )
  return res.ok ? 'written' : 'failed'
}

/** Children of a cell, or [] when it does not exist yet. */
async function childrenOf(segments: string[]): Promise<string[]> {
  const res = await send({ op: 'inflate', segments }).catch(() => ({ ok: false } as BridgeRes))
  if (!res.ok) return []
  return ((res.data?.children ?? []) as any[]).map(c => String(c?.name ?? '')).filter(Boolean)
}

/** Ensure `segments` exists and holds AT LEAST `want` as children — a union,
 *  never a replacement, so an existing cell keeps everything it already had. */
async function ensure(segments: string[], want: string[] = []): Promise<boolean> {
  const name = segments[segments.length - 1]
  const have = await childrenOf(segments)
  const merged = [...have, ...want.filter(w => !have.includes(w))]
  const layer = merged.length ? { name, children: merged } : { name }
  const res = await sendRetry({ op: 'update', segments, layer })
  return res.ok
}


// ── the creation ────────────────────────────────────────────────────

const ROOT_KEY = norm('behaviors')
const COLLECTION = norm('assistant')

const BEHAVIOR_KEYWORD = 'behavior'
const ASSISTANT_KEYWORD = 'assistant'
const PART_KEYWORD = 'part'

type Part = [file: string, role: string]
type Creation = { cell: string; notes: string[]; parts: Part[] }

/** ONE RESOURCE, ONE TILE — and the extension is part of the resource.
 *
 *  Dropping it is what a reader wants (`chat-thread`, not `chat-thread-ts`),
 *  right up until two files in the same creation share a basename:
 *  `chat-window.component.ts` and `chat-window.component.html` both normalise
 *  to `chat-window-component`, and the second silently landed its role note on
 *  the FIRST one's cell. One tile, two files, no way to tell them apart — the
 *  exact thing the 1:1 rule exists to prevent.
 *
 *  So the bare stem goes to the FIRST file that claims it and every later
 *  clash keeps its extension. That is order-dependent on purpose: the order is
 *  declared below, it is stable, and the file listed first for a creation is
 *  the primary one — which is also what keeps a cell that already exists from
 *  being orphaned by a rename the next time this rule tightens.
 */
function partKeys(parts: readonly Part[]): string[] {
  const taken = new Set<string>()
  return parts.map(([file]) => {
    const base = file.split('/').pop()!
    const stem = norm(base.replace(/\.(ts|cjs|html|scss)$/, ''))
    if (!taken.has(stem)) { taken.add(stem); return stem }
    const full = norm(base)
    taken.add(full)
    return full
  })
}

const CREATIONS: Creation[] = [
  {
    cell: norm('chat-peek'),
    notes: [
      'THE WINDOW FOLDS, IT DOES NOT BECOME A SECOND SHAPE. The chat window is full screen and deliberately has only one shape, because a conversation about the hive needs the tiles rail beside it and the rail needs the width. But the rail NAMES tiles; it does not show you the hive, and deciding which tiles a request should carry is a thing you do by looking. So peek: the reading half — transcript, rail, conversation bar — folds away and the header (the shelf) and the footer (the input) stay, floating over the LIVE hive. It is a STATE of the open window, not a second layout to keep honest.',
      'NOTHING IS REMOVED FROM THE DOM, EVER. The rail keeps the level it walked to and the picks it made, the transcript keeps its scroll, the draft keeps its half-written sentence. Folding is display:none on the reading half; unfolding returns to exactly what you left, now carrying whatever you picked up while you were out. A fold that tore the rail down and rebuilt it would cost the participant the walk they had just done.',
      'THE MECHANISM IS SURFACE OWNERSHIP, NOT Z-INDEX. A full-screen window is a view covering the canvas by any honest reading, so the window ENTERS the owner-counted view:active mode (ModeRegistry) while it is up and RELEASES it while folded. That one signal does all the work: it is what makes the hexagons live and clickable during a peek, and it is what makes every chrome that hides for a view stop drawing over the window. Bumping z-index numbers instead would have been whack-a-mole, and the next view would have re-opened the hole.',
      'THE POST-ITS WERE THE BLEED, AND THE GUARD HAD TWO HOLES. The stickies sit above the docked toolwindow layer so a note dropped over a side panel stays grabbable, and that same z-index put them over the chat window. There WAS a guard, keyed on chat:window-state by name, and it could not see any OTHER full-screen surface — and worse, it only applied on the open/close transition while every reconcile mints FRESH nodes visible, so any synchronize or landing decoration put the stickies straight back on top. Both are gone: the drone re-reads the owner-counted mode (excluding itself) and re-states the cover after every render.',
      'PARKING TAKES THE FOLD WITH IT. The shell can PARK the window — take it off screen without closing it — when another tool window opens or the installer covers the hive, and parking deliberately keeps peeking true because that is the whole point of parking. Without saying so, the hexagons went on offering "add to the request" for a shelf that was not on screen. The session announce callback fires only on park/unpark, which makes it the one seam where the tile icon and the surface claim can be made to follow the SCREEN rather than the intent.',
      'ESCAPE UNFOLDS BEFORE IT CLOSES. Folded away is a smaller commitment than the window itself, so the cascade unwinds it first — the same outermost-first rule the rest of the window follows.',
    ],
    parts: [
      ['hypercomb-shared/ui/chat-window/chat-peek.scss',
       'the folded geometry — a third sheet because Angular component style budgets are measured per compiled stylesheet. The panel goes pointer-events:none so the hexagons get the pointer; header and footer re-arm theirs and grow a ground of their own, with the frost on a ::before because backdrop-filter makes an element a containing block for fixed descendants and the header carries the clipboard flyout'],
      ['hypercomb-shared/ui/chat-window/chat-window.component.ts',
       'the fold itself — peeking, togglePeek, #claimSurface (the owner-counted view:active claim), #announcePeek, and the session hook that makes park/unpark carry the fold. Escape unfolds before it closes'],
      ['hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/postit-view.drone.ts',
       'the cover, fixed — #recheckCover reads the ModeRegistry (excluding its own owner) instead of watching the chat window by name, and #reconcile re-states the cover over freshly minted nodes'],
      ['hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/collection-empty-prompt.drone.ts',
       'the same blind spot in the empty-collection notice — hexagons mode is not the same question as "the hexagons are what you are looking at"'],
      ['scripts/drive-chat-peek.cjs',
       'the proof — its own Playwright profile (a scratch hive, never the participants): the claim is taken and released, the panel stops taking pointer events while the footer keeps them, the transcript and rail are hidden and not removed, and Escape unfolds rather than closes'],
    ],
  },
  {
    cell: norm('chat-archive'),
    notes: [
      'PUT AWAY, NOT THROWN AWAY. Delete was the only thing you could do with a conversation you were finished with, and delete is the wrong verb for the common case: you are done NEEDING the thread, not done having said it. The only way to get a list you could read was to destroy things. Archiving keeps every turn and takes the row out of the list.',
      'THE FLAG LIVES IN THE THREADS OWN BUCKET. Not an index — this module has exactly one rule about indexes and it is that there must not be one; the bucket describes itself, and an index is a second copy of a fact, free to drift the first time a write half-lands. And not localStorage — unlike SEEN, which genuinely IS per device, "I am finished with this conversation" is a fact about the THREAD: it should be true on the phone too and it should survive the browser forgetting its storage. The marker is named by a CONSTANT rather than by its own content hash, because unlike a turn it is a MUTABLE fact that setting must overwrite and un-setting must remove.',
      'THE LIST STILL REPORTS AN ARCHIVED THREAD. Hiding it is the surfaces job; a list that dropped it would leave no way to bring it back. The bucket walk that was already reading every file learns the flag for free, so nothing costs an extra read.',
      'AN ARCHIVED THREAD IS NEVER WHERE YOU WERE. Resume skips it and latestTurns skips it, or the act would undo itself on the next reload — and the two have to agree about which thread that is. Its turns no longer count toward its tile row mark either: a thread you put away that still made the tile look deep, or kept an unread badge lit on a row whose visible chats you have all read, would make archiving something you cannot actually finish doing.',
      'ONE CONTROL, BOTH DIRECTIONS, IN BOTH LISTS. Un-archiving is the same act with the flag flipped, so it is the same button — there is no separate "restore" living somewhere else to go and find. Archived rows sit behind an Archived (n) disclosure that is absent entirely when nothing is filed, because a disclosure for an empty set is furniture.',
      'THE CHAT YOU ARE IN HAS ITS OWN ICON, AND IT MOVES ON. The per-row control acts on a conversation you are POINTING at; the bar above the transcript acts on the one you are READING, which is the common case. This is the one place staying put would be wrong: a press that files the thread and leaves it on screen looks like a press that did nothing, so the window lands on the next live thread (or a fresh chat when that was the last) — the same thing deleting does, for the same reason. Un-filing stays put. Neither that icon nor the + beside it wears a border: two outlined boxes at the end of a row holding a name read as a toolbar bolted onto a title, so a hairline rule separates them instead.',
    ],
    parts: [
      ['hypercomb-essentials/src/diamondcoreprocessor.com/assistant/chat-thread.ts',
       'the marker and the reads — ARCHIVE_MARKER, the constant-named marker file, BucketRead (turns AND the flag from one walk), setConversationArchived (create:true only on the archive path, so un-archiving mints no empty bucket), and foldTileConversations skipping what is filed'],
      ['hypercomb-essentials/src/diamondcoreprocessor.com/assistant/agent-tiles-rail.ts',
       'the folds controls — a chat row became two controls (the name opens it, the mark at the end puts it away), which is why the row is a div and the name a button inside it: a button inside a button is not a thing the DOM allows or a screen reader can read out. Plus the Archived (n) disclosure and the optimistic flip the pool still overrules'],
      ['hypercomb-shared/ui/chat-window/chat-window.component.ts',
       'the windows half — liveRoster / filedRoster / archiveOpen, archive (optimistic, then corrected by the refresh), activeArchived, and archiveCurrent which files the thread in hand and moves on'],
      ['hypercomb-shared/ui/chat-window/chat-window.component.html',
       'ONE row shape for both shelves via ng-template — a live conversation and an archived one are the same thing in different places, so drawing them from two copies of the markup is how they drift apart. Plus the bar archive icon, the rule, and the add button'],
      ['hypercomb-essentials/src/diamondcoreprocessor.com/assistant/chat-thread-shape.spec.ts',
       'the frozen shape — archiving adds exactly one file and removes no turn, the list flags rather than drops, resume skips what is filed, and un-archiving a thread that has no bucket mints nothing'],
      ['scripts/drive-chat-archive.cjs',
       'the proof — the turns read back whole after filing, the flag survives a reload (so it is in the thread and not the tab), neither bar icon computes a border, and one press on the bar both files the thread and changes which conversation is in hand'],
    ],
  },
  {
    cell: norm('chat-context-icon'),
    notes: [
      'THE SHELF TAKES DROPS, AND A DRAG ON A HEXAGON IS A PAN. Folding the window away exists so you can go and FIND the tiles a request should carry. Finding them was the easy half; putting them ON the shelf was the half with no affordance, because the one gesture the canvas already owns cannot be used here. So every tile grows an icon while the window is folded away.',
      'WHY AN ICON AND NOT A DRAG HANDLE. A handle you grab to arm a pan-locked drag works, and it costs a MODE: press, hold, cross the screen, release on the right hexagon — and pay for the whole round trip again for the next tile. Gathering context is a repeated discrete act, three or four tiles chosen while reading them, so the cheap repeatable gesture is the right one. One press per tile, pressed again to take it back off, and the canvas is never left in a state you have to get out of.',
      'WHY NOT CTRL-CLICK. On a hexagon that chord already means toggle-the-selection, and the wand on an unadopted tile. Overloading it here would make one chord mean two different things depending on invisible state — the exact disease the chat window was built to kill. Three comments in the codebase claimed the chord DID gather context; they were wrong, and being wrong about it is precisely why this icon had to exist.',
      'REGISTERED AND UNREGISTERED WITH THE FOLD, not merely hidden. actionsForTile is also what the close-up screen and the tile brief build their affordance lists from, and an "add to the request" button on a surface with no request behind it is a button that does nothing. It registers for every profile, because gathering context is not a private-hive privilege — reading somebody elses tile is exactly when you want to put it in front of the model.',
      'THE SAME CONTROL BOTH DIRECTIONS, AND THE WINDOW OWNS THE TRUTH. A tile already on the shelf wears the icon LIT in the chat windows steel, and pressing it takes the tile off — a lit icon you cannot un-press is one you have to go back into the window to undo. The shelf announces itself on context:active-set, so this drone never keeps its own idea of what the request carries.',
      'THE SIGNATURE IS RESOLVED THROUGH levelRoster. A reference without one contributes nothing to the request, and levelRoster is the list the rail, the notes panel and the command line all read — so the sig a press sends is the same sig a drag off the rail would have carried. A label is only a path once you know the level, which is why the drone tracks where the hive is standing.',
    ],
    parts: [
      ['hypercomb-essentials/src/diamondcoreprocessor.com/assistant/chat-context-action.drone.ts',
       'the icon — the descriptor per profile, the lit tint read from the shelf own announcement, register/unregister with the fold, and the press that resolves a label to a signature through levelRoster'],
      ['hypercomb-shared/ui/chat-window/chat-window.component.ts',
       'the windows half — chat:peek (who is gathering), the chat:add-context listener, and toggleContext, which is what makes the press a toggle rather than a one-way add'],
      ['hypercomb-essentials/src/side-effects.ts',
       'the barrel — a new essentials module boots by being imported here, and a running dev server will NOT pick a new FILE up: verification needs a freshly started one'],
      ['scripts/drive-chat-context-icon.cjs',
       'the proof — read through the drone and the shelf DOM, never through the band: headless has no GPU, Pixi shaders never compile, no cell is drawn, so actionsForTile answers [] in every state and a green run through it would have meant nothing'],
    ],
  },
]

let created = 0, present = 0, failed = 0

function tally(result: 'written' | 'present' | 'failed'): void {
  if (result === 'written') created++
  else if (result === 'present') present++
  else failed++
}

async function mirror(creation: Creation, collectionSeg: string[]): Promise<void> {
  const { cell, notes, parts } = creation
  console.log(`\n[mirror] -- ${cell} --`)

  process.stdout.write(`[mirror] ${collectionSeg.join('/')} <- ${cell} ... `)
  console.log(await ensure(collectionSeg, [cell]) ? 'ok' : 'FAIL')

  const cellSeg = [...collectionSeg, cell]
  process.stdout.write(`[mirror] ${cellSeg.join('/')} ... `)
  console.log(await ensure(cellSeg) ? 'ok' : 'FAIL')

  for (const text of notes) {
    process.stdout.write(`[note] ${cell} ... `)
    const res = await noteOnce(cellSeg, text)
    tally(res)
    console.log(res)
  }
  for (const keyword of [BEHAVIOR_KEYWORD, ASSISTANT_KEYWORD]) {
    process.stdout.write(`[mark] ${cell} <- ${keyword} ... `)
    console.log(await mark(cellSeg, keyword) ? 'ok' : 'FAIL')
  }

  const keys = partKeys(parts)
  process.stdout.write(`[mirror] ${cellSeg.join('/')} <- ${keys.length} part(s) ... `)
  console.log(await ensure(cellSeg, keys) ? 'ok' : 'FAIL')

  for (let i = 0; i < parts.length; i++) {
    const [file, role] = parts[i]!
    const seg = [...cellSeg, keys[i]!]
    process.stdout.write(`[part] ${keys[i]} ... `)
    if (!(await ensure(seg))) { failed++; console.log('FAIL (cell)'); continue }
    const text = `${file.split('/').pop()} — ${role}\n\npart of /${cell}\nsource: ${file}`
    const noted = await noteOnce(seg, text)
    const marked = await mark(seg, PART_KEYWORD)
    tally(noted === 'failed' || !marked ? 'failed' : noted)
    console.log(noted === 'failed' || !marked ? `FAIL (note:${noted} mark:${marked})` : `ok (${noted})`)
  }
}

async function main(): Promise<void> {
  const collectionSeg = [ROOT_KEY, COLLECTION]
  const siblings = await childrenOf(collectionSeg)
  if (!siblings.length) {
    console.error(`[mirror] ABORT: cannot read "${ROOT_KEY}/${COLLECTION}". Open the hive with ?claudeBridge=1 and ensure the behaviors mirror is built.`)
    process.exit(1)
  }
  console.log(`[mirror] "${COLLECTION}" holds: ${siblings.join(', ')}`)

  for (const creation of CREATIONS) await mirror(creation, collectionSeg)

  console.log(`\n[mirror] DONE — ${created} written, ${present} already present, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
