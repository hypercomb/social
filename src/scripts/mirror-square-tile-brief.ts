// Mirror pass for THE DOG-EAR — the square tile view's per-tile brief and its
// leaf page.
//
// One creation GREW, so nothing new is minted at the collection level: the
// EXISTING square-tile-view cell under `behaviors/views` gains the notes that
// explain the corner, and one child cell per implementation file, each marked
// `part`. `behavior`, `view` and `part` are the declared vocabulary from the
// earlier passes.
//
// EXTEND NEVER RE-CREATE. The view's cell is LOOKED UP among the names it has
// worn (welcome / threshold / square-tile-view), children are UNIONED, and
// every note goes through noteOnce — so a re-run adds only what is missing.
// The pass ABORTS rather than minting a stray cell when the view has none:
// that is a gap in an earlier mirror, not something for this one to paper
// over with a second, split copy of the creation.
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
const COLLECTION = norm('views')

const BEHAVIOR_KEYWORD = 'behavior'
const VIEW_KEYWORD = 'view'
const PART_KEYWORD = 'part'

/** The square tile view has worn several names. First match wins; NONE is an
 *  abort — an earlier mirror owes the cell, and minting a second one here
 *  would split the creation in two. */
const VIEW_NAMES = [
  'square-tile-view', 'squaretileview', 'square-tile', 'square-tiles',
  'welcome', 'welcome-threshold', 'threshold',
]

const NOTES = [
  'THE REVERSE OF THE CARD. A hexagon has no back, so the hover band crowds its affordances around the rim. A square plate DOES have a back — it is a card, and the back of a card is where the writing goes. So this view’s answer to the band is a DOG-EAR: a turned gold corner on the plate. Turning it opens the tile’s brief in the page — its lists, its notes, the beehaviors it carries, its pheromones, and the same affordance set the band would offer.',
  'THE CORNER IS NEVER THE CLICK. The plain click still navigates, exactly as it always did: the tile has a click, and the arrival opens whatever face the destination resolves to. Reaching what a tile CARRIES must not cost you your place, so it is a second gesture — a pointer turns the corner, a finger holds the plate (420ms, 10px of slop), a keyboard presses `i` on the focused plate. A committed hold swallows the click it would otherwise leave behind.',
  'THE CORNER STANDS WHERE THERE IS SOMETHING TO READ. A plate whose tile carries writing or a behaviour wears its corner turned down already (`data-carries`, a sync read of NotesService’s warm cache and the decoration-kind index); everywhere else the corner appears on hover. On a phone there is no hover, so every corner stands and takes a bigger target. This is the same signal the band paints by tinting an icon: this tile has notes.',
  'OPEN THE ROW, NOT THE CELL. The card takes the grid’s full width and is inserted after the LAST plate sharing the turned plate’s line — measured by offsetTop, so the row parts, the rows below step down, and nothing jumps sideways. One card at a time. Escape and right-click take the CARD back before they take the sheet, and a rebuild (a note landing, a decoration changing) turns the same corner back down rather than shutting what you were reading.',
  'A LEAF IS NEVER AN EMPTY PAGE. Where a layer has nothing behind it the sheet used to say "nothing behind the threshold yet" and stop. Now the tile’s own brief takes the whole page: its picture, its lists and notes, the beehaviors it carries, its pheromones — and THE ROW IT SITS ON along the foot, read from the parent’s layer, so a leaf is a place you can walk out of sideways as well as back.',
  'THE PAGE WRITES WHERE IT READS. Every brief carries one always-open line: type, press Enter, and the note lands through `addAtSegments` at the tile’s OWN address. That is the one door the annotations window cannot open from here — the strip addresses a tile BY LABEL against where you stand, which is true of a plate and never of the page you are standing in. So the composer is not a convenience: it is the only correct way to write on a leaf without moving you off it.',
  'THE BAND LENDS ITS SET, IT IS NEVER COPIED. The card’s gold rail is `actionsForTile(label)` / `invokeActionForTile(name, label)` from the hexagon overlay — the same affordances, the same order (plain, then features, then destructive behind a ⋯), the same inert shading while a bee is still registering. The overlay resolves a tile by its place on the CURRENT layer, which a plate has and a page does not, so the rail is present on a spread and absent on a page. Everything else on the brief is address-keyed and reads the same at both scales.',
  'MARKS CLASSIFY, THE VIEW DOES NOT. Lists and notes are split by the participant’s own mark palette — a root carrying a heading/list mark, or a root with children, is STRUCTURE; prose and the Q&A conversation are NOTES. The rule lives in one place (note-classify.ts) so this page and the annotations window can never disagree, and re-roling an icon in the palette re-sorts every brief in the hive.',
]

type Part = [file: string, role: string]

const PARTS: Part[] = [
  ['hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/square-tile-view.drone.ts',
   'the sheet — the plates, the corners, the hold and the `i` key, the row-aware insertion of the card, and the leaf page that replaces the empty hint'],
  ['hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/tile-brief.ts',
   'the ink — readTileBrief(segments) gathers one address’s writing, the behaviours it carries, its pheromones, what it opens as, and the band’s affordances. Read-only and address-keyed, so a view briefs a tile it is only LOOKING at as easily as the one it stands in'],
  ['hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/tile-brief-panel.ts',
   'the paper — one renderer at two scales (`spread` inside the grid, `page` for the whole sheet): the outline, the prose clamp, the beehaviors column, the gold rail and the sibling strip. Presentation only — every value arrives on the brief, every door as a callback'],
  ['hypercomb-essentials/src/diamondcoreprocessor.com/notes/note-classify.ts',
   'the split — noteKindOf / noteDisplayText / isPointRoot / splitNoteRoots, the one definition of "is this root structure or is it prose", taking the palette’s roleOf as an argument because the palette lives in the shell'],
  ['scripts/drive-square-tile-brief.cjs',
   'the proof — 23 checks on a live shell: corners on every plate, the standing corner where there is writing, turning one does NOT navigate, the card lands in its own row, lists and notes on the right sides, the band’s affordances present, Escape takes the card first, the leaf page with its row, and a note written in place'],
]

let created = 0, present = 0, failed = 0

function tally(result: 'written' | 'present' | 'failed'): void {
  if (result === 'written') created++
  else if (result === 'present') present++
  else failed++
}

async function main(): Promise<void> {
  const collectionSeg = [ROOT_KEY, COLLECTION]
  const siblings = await childrenOf(collectionSeg)
  if (!siblings.length) {
    console.error(`[mirror] ABORT: cannot read "${ROOT_KEY}/${COLLECTION}". Open the hive with ?claudeBridge=1 and ensure the behaviors mirror is built.`)
    process.exit(1)
  }
  console.log(`[mirror] "${COLLECTION}" holds: ${siblings.join(', ')}`)

  const name = VIEW_NAMES.find(n => siblings.includes(n))
  if (!name) {
    console.error(`[mirror] ABORT: the square tile view has no cell under "${COLLECTION}" (tried ${VIEW_NAMES.join(', ')}). Its own mirror owes that cell; this pass extends, it does not mint.`)
    process.exit(1)
  }
  console.log(`[mirror] extending the existing "${name}" cell`)

  const viewSeg = [...collectionSeg, name]
  process.stdout.write(`[mirror] ${viewSeg.join('/')} ... `)
  console.log(await ensure(viewSeg) ? 'ok' : 'FAIL')

  for (const text of NOTES) {
    process.stdout.write(`[note] ${name} ... `)
    const res = await noteOnce(viewSeg, text)
    tally(res)
    console.log(res)
  }
  for (const keyword of [BEHAVIOR_KEYWORD, VIEW_KEYWORD]) {
    process.stdout.write(`[mark] ${name} ← ${keyword} ... `)
    console.log(await mark(viewSeg, keyword) ? 'ok' : 'FAIL')
  }

  const keys = PARTS.map(([file]) => norm(file.split('/').pop()!.replace(/\.(ts|cjs|html|scss)$/, '')))
  process.stdout.write(`[mirror] ${viewSeg.join('/')} ← ${keys.length} part(s) ... `)
  console.log(await ensure(viewSeg, keys) ? 'ok' : 'FAIL')

  for (let i = 0; i < PARTS.length; i++) {
    const [file, role] = PARTS[i]!
    const seg = [...viewSeg, keys[i]!]
    process.stdout.write(`[part] ${keys[i]} ... `)
    if (!(await ensure(seg))) { failed++; console.log('FAIL (cell)'); continue }
    const text = `${file.split('/').pop()} — ${role}\n\npart of /${name}\nsource: ${file}`
    const noted = await noteOnce(seg, text)
    const marked = await mark(seg, PART_KEYWORD)
    tally(noted === 'failed' || !marked ? 'failed' : noted)
    console.log(noted === 'failed' || !marked ? `FAIL (note:${noted} mark:${marked})` : `ok (${noted})`)
  }

  console.log(`[mirror] DONE — ${created} written, ${present} already present, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
