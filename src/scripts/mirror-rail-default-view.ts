// Mirror pass for THE RAIL'S THIRD GESTURE + THE SCROLL GUTTER.
//
// Two creations from one change, both view-side, so both land under the
// EXISTING `views` collection built by mirror-behaviors.ts:
//
//   behaviors/views/default-view              ← the arrival face + how it is set
//   behaviors/views/default-view/<part>         one tile per implementation file
//   behaviors/views/scroll-gutter             ← the shared chrome measurement
//
// Nothing new is minted: `behavior`, `view` and `part` are the declared
// vocabulary from the earlier passes, and `views` is an existing collection.
//
// MERGE MODE, EXTEND NEVER REPLACE. The default-view cell may already exist
// from an earlier pass under one of several names, so it is LOOKED UP before
// anything is created, and its children are UNIONED rather than overwritten.
// Every note is written through noteOnce, which checks for that exact text
// first — so a re-run adds only what is missing and never duplicates a note.
//
// The three views that ADOPTED the gutter (post-it, square tile, room) get one
// note each saying so. Their own cells belong to their own creations, so this
// pass only annotates cells that already exist — it never mints one, and says
// plainly which it could not find.
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

// ── the creations ───────────────────────────────────────────────────

const ROOT_KEY = norm('behaviors')
const COLLECTION = norm('views')

const BEHAVIOR_KEYWORD = 'behavior'
const VIEW_KEYWORD = 'view'
const PART_KEYWORD = 'part'

/** The default-view creation may already stand under one of these names — an
 *  earlier pass, or a hand-made cell. First match wins; none ⇒ create the
 *  first. EXTEND NEVER RE-CREATE. */
const DEFAULT_VIEW_NAMES = ['default-view', 'view-default', 'default-views', 'arrival-face', 'arrival']

const DEFAULT_VIEW_NOTES = [
  'THE ARRIVAL FACE — a layer can declare which view it opens as, and walking in lands on it instead of on the hexagons. One mark, `view:default` on the layer, written with replaceDecoration: a place has one default or none, so choosing a second view is the same gesture as choosing the first, and there is nothing to arbitrate. It is a fact about the PLACE, not a participant preference — so it is undoable, it rides the layer commit to the root, it travels when the branch is adopted, and a peer who walks into your tile arrives the way you arranged it.',
  'THREE MEANINGS, ONE ICON. On the header rail a view\'s icon answers three different questions: a plain CLICK enters or leaves the view; CTRL/CMD-CLICK makes it this layer\'s default, or clears the mark when it already is; a LONG PRESS turns the view off here. The modifier used to be a second way to say "off" — a duplicate of the long press — while deciding what the place OPENS AS had no gesture at all outside the Beehaviors panel. The panel refuses inherited rows by doctrine, so on many children the mark could not be reached from anywhere; the rail has no such gate.',
  'THE MARK HOLDS WHILE THE VIEW IS OFF. The marked icon wears the violet accent — the same one the panel puts on the row icon and a tile\'s behaviour glyph, so one mark reads identically in all three places — as an inset ring, a halo and a filled glyph. It stays lit when the view is not up, and that is the entire point: back on the hexagons every toggle is dark, so the ring is the only thing that says which face this place opens as. On AND default draws both facts at once — the rail\'s own glow inside, the violet ring around it.',
  'THE SHELL STATES THE INTENT, THE DRONE OWNS THE WRITE. The rail cannot write the record — binding a default needs the location signature, and only the essentials side has the signer — so the gesture travels as `features:default`, exactly like enable, remove and bind before it. The rail\'s intent carries `silent`: the panel asks for the refresh that follows a write because the participant is looking AT the panel, while a gesture made on the rail must not pop a tool window open over the hive. Its answer is the icon lighting up.',
  'ONE READ, TWO CONSUMERS. view.bee already read the `view:default` record to decide the arrival; the toggle payload now carries `isDefault` from that same read, so marking the strip costs nothing extra. `isDefault` is deliberately OPTIONAL in the shell\'s input type — the toggles come from a runtime-loaded bee, so a shell running against an older essentials bundle marks nothing rather than breaking.',
]

type Part = [file: string, role: string]

const DEFAULT_VIEW_PARTS: Part[] = [
  ['hypercomb-essentials/src/diamondcoreprocessor.com/commands/view-default.ts',
   'the record — defaultViewAt / writeDefaultView / clearDefaultView. replaceDecoration is the writer, so mutual exclusivity is STRUCTURAL: one mark or none, never a list to reconcile'],
  ['hypercomb-essentials/src/diamondcoreprocessor.com/commands/view.bee.ts',
   'the arrival and the strip — recomputes the rail on every navigation, reads the layer\'s mark once, opens what it names, and stamps `isDefault` on the toggle it named'],
  ['hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/show-features.drone.ts',
   'the write — the only side with the signer. Answers `features:default`, refuses a navigation behaviour (it opens a lineage, not a surface), waits for the commit to settle so the icon it just lit does not go dark again, and honours `silent` by skipping the panel refresh'],
  ['hypercomb-shared/ui/command-shell/command-shell.element.ts',
   'the button and its three gestures — one rail button per available view; a modifier press emits `viewDefault` and latches, so the mouseup that follows does not ALSO toggle the view; the long press keeps the disable it always had; `.is-default` and the translated title expose the standing mark'],
  ['hypercomb-shared/ui/command-shell/command-shell.element.scss',
   'the ring — the violet accent as an inset ring, halo and filled glyph, written so the standing mark never flickers with the pointer and survives the lit state'],
  ['hypercomb-shared/ui/command-line/command-line.component.ts',
   'the intent — states the gesture at the location the participant is standing on, and reads the strip it already holds to decide whether this is a SET or a CLEAR'],
  ['scripts/drive-rail-default-view.cjs',
   'the proof — walks a live shell: the mark is a RECORD (a reload lands on the view), it still reads back on the hexagons, a plain click still enters, and ctrl-click again clears it'],
]

const GUTTER = norm('scroll-gutter')

const GUTTER_NOTES = [
  'THE GUTTER — a classic scrollbar is a strip of the viewport a fixed corner control cannot have. Every full-viewport view mounts the same shape: a fixed, overflow:auto HOST plus a small fixed control tucked into a corner (the × back to the hexagons, a ‹ back one room). Those two disagree about where the right edge is. A fixed box is laid out against the VIEWPORT, and the browser already keeps the DOCUMENT\'s scrollbar out of that box — but the host\'s scrollbar is INSIDE the viewport, so `right: 0.75rem` puts the button on top of it.',
  'MEASURE, NEVER ASSUME. trackScrollGutter(host) publishes `offsetWidth − clientWidth − borders` as `--hc-scroll-gutter` on the host, and every fixed corner control adds it into its own offset: `right: calc(0.75rem + env(safe-area-inset-right,0px) + var(--hc-scroll-gutter,0px))`. The `0px` fallback is the whole compatibility story — a view that has not adopted the tracker, or content that does not overflow, reads exactly the offset it read before.',
  'WHY IT SURVIVED SO LONG. With overlay scrollbars — a phone, a Mac by default, and headless Chrome — the strip is 0px and there is nothing to see. On Windows it is a real ~15px of chrome: measured at a 900px viewport, the content edge sits at 885 and the old button\'s right edge at 890, five pixels INSIDE the scrollbar. A headless harness cannot see this bug at all, so the proof has to run headed.',
  'LATE CONTENT IS WHAT MAKES A SCROLLBAR. The tracker watches the host AND each of its children, because content that arrives after the mount — lazy pictures, a page fetched from the store — changes a CHILD\'s height, not the host\'s, and new children are picked up as they are appended. It is generic on purpose: it knows nothing about post-its or plates, so any surface with an inner scroller and a floating corner control can mount one.',
]

const GUTTER_PARTS: Part[] = [
  ['hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/scroll-gutter.ts',
   'the measurement — one element, one custom property, a ResizeObserver on the host and its children plus a MutationObserver for children appended later; returns its own teardown'],
]

/** Views that measure the gutter. Their cells belong to their OWN creations,
 *  so this pass only annotates one that already exists — the candidate names
 *  are tried in order, and a miss is reported, never minted. */
const ADOPTERS: Array<{ names: string[]; label: string; text: string }> = [
  {
    names: ['postit', 'post-it', 'postit-view'],
    label: 'post-it',
    text: 'Measures the scroll gutter. The post scrolls, so on Windows it wears a real scrollbar and the × adds var(--hc-scroll-gutter,0px) to stay clear of it — see /scroll-gutter.',
  },
  {
    names: ['square-tile-view', 'squaretileview', 'square-tile', 'welcome', 'welcome-threshold'],
    label: 'square tile view',
    text: 'Measures the scroll gutter. The sheet scrolls, so on Windows it wears a real scrollbar and the × adds var(--hc-scroll-gutter,0px) to stay clear of it — see /scroll-gutter.',
  },
  {
    names: ['room', 'room-view', 'revolucion-room'],
    label: 'room',
    text: 'Measures the scroll gutter. The page scrolls inside the host, so on Windows it wears a real scrollbar and the × adds var(--hc-scroll-gutter,0px) to stay clear of it — see /scroll-gutter.',
  },
]

let created = 0, present = 0, failed = 0, missing = 0

function tally(result: 'written' | 'present' | 'failed'): void {
  if (result === 'written') created++
  else if (result === 'present') present++
  else failed++
}

async function writeParts(behaviorSeg: string[], parts: Part[], creation: string): Promise<void> {
  const keys = parts.map(([file]) => norm(file.split('/').pop()!.replace(/\.(ts|cjs|html|scss)$/, '')))
  process.stdout.write(`[${creation}] ${behaviorSeg.join('/')} ← ${keys.length} part(s) ... `)
  console.log(await ensure(behaviorSeg, keys) ? 'ok' : 'FAIL')

  for (let i = 0; i < parts.length; i++) {
    const [file, role] = parts[i]
    const seg = [...behaviorSeg, keys[i]]
    process.stdout.write(`[part] ${keys[i]} ... `)
    if (!(await ensure(seg))) { failed++; console.log('FAIL (cell)'); continue }
    const text = `${file.split('/').pop()} — ${role}\n\npart of /${behaviorSeg[behaviorSeg.length - 1]}\nsource: ${file}`
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

  // ── the default view: EXTEND the existing cell when there is one ────
  const existing = DEFAULT_VIEW_NAMES.find(n => siblings.includes(n))
  const defaultView = existing ?? DEFAULT_VIEW_NAMES[0]
  console.log(existing
    ? `[mirror] extending the existing "${existing}" cell`
    : `[mirror] "${defaultView}" is new — creating it`)

  process.stdout.write(`[mirror] ${collectionSeg.join('/')} ← ${defaultView}, ${GUTTER} ... `)
  console.log(await ensure(collectionSeg, [defaultView, GUTTER]) ? 'ok' : 'FAIL')

  const defaultSeg = [...collectionSeg, defaultView]
  process.stdout.write(`[mirror] ${defaultSeg.join('/')} ... `)
  console.log(await ensure(defaultSeg) ? 'ok' : 'FAIL')
  for (const text of DEFAULT_VIEW_NOTES) {
    process.stdout.write(`[note] ${defaultView} ... `)
    const res = await noteOnce(defaultSeg, text)
    tally(res)
    console.log(res)
  }
  for (const keyword of [BEHAVIOR_KEYWORD, VIEW_KEYWORD]) {
    process.stdout.write(`[mark] ${defaultView} ← ${keyword} ... `)
    console.log(await mark(defaultSeg, keyword) ? 'ok' : 'FAIL')
  }
  await writeParts(defaultSeg, DEFAULT_VIEW_PARTS, 'default-view')

  // ── the gutter: a shared PART of what views are made of ────────────
  const gutterSeg = [...collectionSeg, GUTTER]
  process.stdout.write(`[mirror] ${gutterSeg.join('/')} ... `)
  console.log(await ensure(gutterSeg) ? 'ok' : 'FAIL')
  for (const text of GUTTER_NOTES) {
    process.stdout.write(`[note] ${GUTTER} ... `)
    const res = await noteOnce(gutterSeg, text)
    tally(res)
    console.log(res)
  }
  process.stdout.write(`[mark] ${GUTTER} ← ${PART_KEYWORD} ... `)
  console.log(await mark(gutterSeg, PART_KEYWORD) ? 'ok' : 'FAIL')
  await writeParts(gutterSeg, GUTTER_PARTS, 'scroll-gutter')

  // ── the views that measure it ──────────────────────────────────────
  for (const adopter of ADOPTERS) {
    const name = adopter.names.find(n => siblings.includes(n))
    if (!name) {
      missing++
      console.log(`[adopt] ${adopter.label} — no cell under ${COLLECTION} (tried ${adopter.names.join(', ')}); its own mirror still owes one`)
      continue
    }
    process.stdout.write(`[adopt] ${name} ... `)
    const res = await noteOnce([...collectionSeg, name], adopter.text)
    tally(res)
    console.log(res)
  }

  console.log(`[mirror] DONE — ${created} written, ${present} already present, ${failed} failed, ${missing} adopter cell(s) not found`)
  if (failed > 0) process.exitCode = 1
}

main().catch(err => { console.error(err); process.exit(1) })
