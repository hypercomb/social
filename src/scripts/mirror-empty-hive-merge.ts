// Mirror pass for the EMPTY-HIVE MERGE — the pass that made first boot show
// ONE view instead of two. The example-hives offer and collection-empty-prompt's
// `root` variant fired on exactly the same condition (empty hive root, first
// boot) and stacked on top of each other; the splash then rested over both with
// their buttons unreachable. The offer is now the single first-boot view: it
// carries the empty-hive gestures in its own actions row, the drone stands down
// to fallback, and the splash reveals the offer the moment it is active.
//
// Extends the existing `behaviors/swarm/example-hives` behaviour tile built by
// mirror-example-hives.ts — it never re-runs it. This pass adds the two source
// resources the merge actually lives in, 1:1, as `part` cells:
//
//   behaviors/swarm/example-hives
//     ├── example-hives-worker      (existing)
//     ├── offer-card                (existing — gains a note for its actions row)
//     ├── example-hives-roster      (existing)
//     ├── i18n-catalogs             (existing)
//     ├── empty-hive-prompt         NEW — the fallback drone + the folded gestures
//     └── splash-handoff            NEW — the splash reveals the offer
//
// Pheromones (declared, never minted on the fly): `part` on each new cell. Notes
// are guarded by note-list marker probes — note-add is not idempotent, so a
// re-run must not stack duplicates.

import WebSocket from 'ws'

const BRIDGE_PORT = 2401
const TIMEOUT = 180_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cli-${Date.now()}-${++counter}` }
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

const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'
const S = 'hypercomb-shared'
const W = 'hypercomb-web'
const D = 'hypercomb-dev'

const ROOT_KEY = 'behaviors'
const COLLECTION = 'swarm'
const BEHAVIOR = 'example-hives'
const PART_KEYWORD = 'part'

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['empty-hive-prompt', [
    'The fallback, and the owner of the folded-in gestures. This drone speaks for any layer that legitimately has nothing in it — a collection\'s own root, any childless tile\'s layer, and the empty hive root. The root variant is the one that collided: it fired on exactly the offer\'s condition and drew a second card over it.',
    '',
    'It now stands down while the offer is active (it watches examples:offer and examples:dismiss, both last-value replayed, so a late subscribe still learns the offer is up) and renders the root variant only when there is no offer at all — roster unavailable, offline, or already dismissed. Emptiness is still its own to judge: the collection and layer variants are untouched.',
    '',
    'It also keeps the behaviour behind the offer\'s "Add a tile": the card emits hive:empty:add-tile and this drone runs the command-line focus dance. The shell surface stays a pure renderer — shared never reimplements module behaviour, and the module never has to know a card drew the button.',
    '',
    `source: ${E}/presentation/tiles/collection-empty-prompt.drone.ts`,
  ].join('\n')],
  ['splash-handoff', [
    'The reveal. The splash holds until the renderer reports it is ready, and an empty hive root may never produce a signal it trusts — so it played out its three loops and rested on the dot, dimming the offer and swallowing its buttons. Unreachable buttons behind a splash is a hard deadlock, the same one already guarded for the install-needed welcome card.',
    '',
    'The splash now dismisses on examples:offer whenever the offer is active and has rows, handing the screen straight to the single first-boot view. Both copies move together — the web and dev splashes are kept in sync by hand, and a fix in one is a bug in the other.',
    '',
    `source: ${W}/public/splash.js · ${D}/public/splash.js`,
  ].join('\n')],
]

/** A supplementary note for a cell this pass did NOT create. Guarded by a
 *  marker probe so a re-run cannot stack it a second time. */
type Supplement = { name: string; marker: string; text: string }

const SUPPLEMENTS: Supplement[] = [
  {
    name: 'offer-card',
    marker: 'ONE card on first boot',
    text: [
      'ONE card on first boot. The actions row carries three exits, not one: "Add a tile" and "Show me how" folded in from the empty-hive prompt it used to stack with, alongside "Start empty" (which reads "Done" once something has been added).',
      '',
      'The card did not grow behaviour to do it — it emits hive:empty:add-tile and tutorial:start and closes itself. The drone that owns the command line answers. A shell surface renders; the module acts.',
      '',
      `source: ${S}/ui/example-hives/example-hives-offer.component.ts`,
    ].join('\n'),
  },
  {
    name: 'i18n-catalogs',
    marker: 'install.storage-blocked',
    text: [
      'install.storage-blocked was rewritten across all fourteen catalogs. It named only Private windows and outdated Safari, so on Chrome — where a storage bucket can wedge after clearing site data with the page still open, and navigator.storage.getDirectory() then hangs instead of failing — it read as nonsense to the one participant who most needed it.',
      '',
      'It now describes the stuck-storage case and gives the action that actually clears it: quit the browser completely, reopen, load the page again. The detection was never wrong; only the words were.',
      '',
      `source: ${S}/i18n/en.json … ${S}/i18n/tr.json`,
    ].join('\n'),
  },
]

/** Child NAMES via raw layer bytes — no recursive inflate. */
async function childrenOf(segments: string[]): Promise<string[]> {
  const layer = await send({ op: 'layer-at', segments })
  if (!layer.ok) return []
  const sigs: string[] = Array.isArray(layer.data?.children) ? layer.data.children.map(String) : []
  const names: string[] = []
  for (const sig of sigs) {
    const res = await send({ op: 'get-resource', sig })
    if (!res.ok) continue
    try {
      const name = JSON.parse(res.data.text)?.name
      if (typeof name === 'string' && name.trim()) names.push(name.trim())
    } catch { /* skip unreadable child */ }
  }
  return names
}

/** True when the cell already carries a note containing `marker`. */
async function hasNote(segments: string[], marker: string): Promise<boolean> {
  const res = await send({ op: 'note-list', segments })
  if (!res.ok || !Array.isArray(res.data)) return false
  return res.data.some((n: unknown) => {
    const text = typeof n === 'string' ? n : String((n as { text?: unknown })?.text ?? '')
    return text.includes(marker)
  })
}

async function main(): Promise<void> {
  const behaviorSeg = [ROOT_KEY, COLLECTION, BEHAVIOR]
  const havePart = await childrenOf(behaviorSeg)
  if (!havePart.length) {
    console.error(`[empty-hive-merge] "${behaviorSeg.join('/')}" has no children — is mirror-example-hives built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[empty-hive-merge] ${behaviorSeg.join('/')} currently holds: ${havePart.join(', ')}`)

  const partNames = PARTS.map(([name]) => name)
  const newParts = partNames.filter(p => !havePart.includes(p))

  // Phase 1 — structure. Union into what is there; never replace membership.
  if (newParts.length) {
    process.stdout.write(`[struct] ${behaviorSeg.join('/')} ← ${havePart.length + newParts.length} children ... `)
    const up = await send({ op: 'update', segments: behaviorSeg, layer: { name: BEHAVIOR, children: [...havePart, ...newParts] } })
    console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
    if (!up.ok) process.exit(1)

    for (const part of newParts) {
      process.stdout.write(`[struct] ${behaviorSeg.join('/')}/${part} ... `)
      const res = await send({ op: 'update', segments: [...behaviorSeg, part], layer: { name: part } })
      console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    }
  } else {
    console.log('[struct] both parts already present — notes and marks only')
  }

  // Phase 2 — notes. New cells get theirs; existing cells get a supplement
  // only when the marker probe says it is not already there.
  let noteCount = 0
  for (const [name, text] of PARTS) {
    if (!newParts.includes(name)) continue
    process.stdout.write(`[note] ${behaviorSeg.join('/')}/${name} ... `)
    const res = await send({ op: 'note-add', segments: behaviorSeg, cell: name, text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    if (res.ok) noteCount++
  }
  for (const sup of SUPPLEMENTS) {
    if (!havePart.includes(sup.name) && !newParts.includes(sup.name)) {
      console.log(`[note] ${sup.name} absent — skipped`)
      continue
    }
    if (await hasNote([...behaviorSeg, sup.name], sup.marker)) {
      console.log(`[note] ${sup.name} already carries this note — skipped`)
      continue
    }
    process.stdout.write(`[note] ${behaviorSeg.join('/')}/${sup.name} (supplement) ... `)
    const res = await send({ op: 'note-add', segments: behaviorSeg, cell: sup.name, text: sup.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    if (res.ok) noteCount++
  }

  // Phase 3 — pheromones. Declared vocabulary only: `part` marks each
  // implementation cell. No replaceKind — tags stack.
  for (const part of newParts) {
    process.stdout.write(`[mark] ${behaviorSeg.join('/')}/${part} ← ${PART_KEYWORD} ... `)
    const res = await send({ op: 'decoration-add', segments: [...behaviorSeg, part], kind: 'tag', appliesTo: [], payload: { name: PART_KEYWORD } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  console.log(`[empty-hive-merge] DONE — ${newParts.length} new parts, ${noteCount} notes, ${newParts.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
