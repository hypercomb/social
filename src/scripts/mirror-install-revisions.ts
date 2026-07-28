// Mirror pass for INSTALL REVISIONS — one revision per artifact in the
// installer. A signature names BYTES, not a thing: two sigs of the same source
// file at two build generations are two revisions of ONE drone. The installer
// listed both (two rows, two switches) and the sentinel SHIPPED both, so the
// shell loaded two bundles of the same drone and the duplicate instances fought
// over the IoC key. Identity is now derived (`<lineage>/<ClassName>`), one
// revision survives, and the rest are recorded as superseded.
//
// Extends the existing `behaviors` mirror — never re-runs it. Adds ONE
// behaviour tile under the `structure` collection (where `builds` — the hive's
// own revision grouping — already lives; no new collection keyword is minted)
// and its parts, 1:1 with the source resources the behaviour lives in:
//
//   behaviors/structure/install-revisions
//     ├── revision-identity     the primitive: identity vs revision, collapse
//     ├── tree-collapse         one revision per identity inside one resolve
//     ├── section-collapse      the same rule across sections + the active pick
//     ├── sync-collapse         the path that ships sigs to the hive
//     └── identity-spec         the three duplicate shapes, held by tests
//
// Pheromones (declared, never minted on the fly): `behavior` + `structure` on
// the behaviour tile, `part` on each child. Merge mode: children union into
// what is already there; notes/marks only for cells this run creates.

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

const D = 'diamond-core-processor/src/app'

const ROOT_KEY = 'behaviors'
const COLLECTION = 'structure'
const BEHAVIOR = 'install-revisions'
const BEHAVIOR_KEYWORD = 'behavior'
const COLLECTION_KEYWORD = 'structure'
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'Install revisions — one revision per artifact, everywhere. A signature names BYTES, not a thing: the same source file at two build generations is two signatures, and nothing in the layer format says they are siblings. The installer listed both as separate rows with separate switches, and the sentinel shipped both, so the shell loaded two bundles of one drone and the duplicate instances fought over the IoC key and the canvas.',
  '',
  'Identity is derived rather than stored: a code artifact IS its class name at its lineage. Two sigs sharing an identity are revisions — one survives, the rest are recorded as superseded and never render, never count as active, never ship. An artifact whose class name never resolved has no identity, so it can never be proven a duplicate and is never collapsed away.',
  '',
  'Three duplicate shapes exist and only the middle one is a revision. The same SIGNATURE in two places is one artifact referenced twice — activation is keyed by signature and happens once, so it is one instance and one switch, and both rows are honest. The same IDENTITY under two sigs is a build-generation skew — collapse it. The same CLASS NAME at a different lineage or a different domain is a fork or a mirror — never fold them together.',
  '',
  'The collapse happens once at the source rather than per view, so render, the toggle map, the active-signature set, the logical merge and the sync manifest all inherit the same answer. The installer and the sentinel now resolve the active revision through the same rule, so the installer can no longer display one revision while the hive runs another.',
  '',
  `source: ${D}/core/revision-identity.ts`,
].join('\n')

type Part = [name: string, note: string]

const PARTS: Part[] = [
  ['revision-identity', [
    'The primitive. identityKey(lineage, className) derives what an artifact IS, independent of which build generation its signature names; collapseRevisions picks one candidate per identity by caller-supplied rank (lowest wins) with document order as the tie-break, so the pick never depends on Map iteration luck. It returns the winners, the superseded map, and the loser set — the three things every consumer needs.',
    '',
    'Rank is deliberately the caller\'s to define: "which revision is active" means different things at different altitudes — tree depth inside one resolve, section precedence across a domain, domain order across the install. One rule, three altitudes.',
    '',
    `source: ${D}/core/revision-identity.ts (fields on ${D}/core/tree-node.ts)`,
  ].join('\n')],
  ['tree-collapse', [
    'One resolve, one revision. The resolver attaches className and identity to every code node it builds — from the layer docs when the build recorded them, else detected from the bundle — and then collapses the whole resolved tree before auditing, so no audit round-trip is ever spent on a signature that will not render.',
    '',
    'This is the single collapse point for everything the resolver produces: domain sections, adopted branches, post-patch local trees, and lazily expanded subtrees. The node id stays the BARE SIGNATURE on purpose — activation is keyed by signature and the sentinel reads the very same toggle store by signature, so identity travels alongside the id, never in place of it.',
    '',
    `source: ${D}/core/tree-resolver.service.ts`,
  ].join('\n')],
  ['section-collapse', [
    'The altitude one tree cannot see: the same drone arriving from a stale package version and from adopted content, or from two sources of one package. Sections are ranked — active package, then content, then a package version that is not the active revision — and the losers are dropped before any other shaping, so search, the tiles and features scopes, the domain groups and the logical merge all inherit it from one place.',
    '',
    'The active package revision is resolved once, from the UNFILTERED sections, and shared by both the render pick and the collapse — a search term can no longer change which revision is active, and the two can no longer disagree. The flattened features list additionally shows one row per signature: in the tree two rows for one sig say where it is used, but flattened they are the same switch twice.',
    '',
    `source: ${D}/home/home.component.ts`,
  ].join('\n')],
  ['sync-collapse', [
    'The path that actually ships. The cross-domain overlap guard was a whole-domain heuristic — it catches a wholesale generation skew between two sources and nothing else. Underneath it now sits the exact rule: when one artifact is enabled under two signatures, only one may ship, whether the skew came from two sections of one domain, a partial overlap the heuristic let through, or a stale signature left enabled by the opt-OUT toggle default.',
    '',
    'Bees only. Dependencies are module aliases rather than instantiated drones, so a duplicate costs an import-map entry instead of a second live drone — and pruning one a surviving bee still imports would break loading. Layers are inert refs, same reasoning. The revision fallback also matches the installer\'s: newest deploy, not manifest key order.',
    '',
    `source: ${D}/sentinel/sentinel-handler.ts`,
  ].join('\n')],
  ['identity-spec', [
    'The three duplicate shapes, held by tests. One signature seen twice is not a conflict; the same class name at two lineages is a fork, not a revision; an identityless artifact is never collapsed away. Plus the ordering guarantees the collapse rests on — lowest rank wins regardless of arrival order, ties break on document order, and winners are emitted in first-appearance order so a collapsed list still reads like its source.',
    '',
    `source: ${D}/core/revision-identity.spec.ts`,
  ].join('\n')],
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

async function main(): Promise<void> {
  const collectionSeg = [ROOT_KEY, COLLECTION]
  const members = await childrenOf(collectionSeg)
  if (!members.length) {
    console.error(`[install-revisions] "${collectionSeg.join('/')}" has no children — is the behaviors mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[install-revisions] ${collectionSeg.join('/')} currently holds: ${members.join(', ')}`)

  const behaviorIsNew = !members.includes(BEHAVIOR)
  const behaviorSeg = [...collectionSeg, BEHAVIOR]
  const partNames = PARTS.map(([name]) => name)

  // Phase 1 — structure. Union into what is there; never replace membership.
  if (behaviorIsNew) {
    process.stdout.write(`[struct] ${collectionSeg.join('/')} ← +${BEHAVIOR} ... `)
    const res = await send({ op: 'update', segments: collectionSeg, layer: { name: COLLECTION, children: [...members, BEHAVIOR] } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    if (!res.ok) process.exit(1)
  } else {
    console.log(`[struct] ${BEHAVIOR} already present — merging parts only`)
  }

  const havePart = await childrenOf(behaviorSeg)
  const newParts = partNames.filter(p => !havePart.includes(p))
  process.stdout.write(`[struct] ${behaviorSeg.join('/')} ← ${havePart.length + newParts.length} children ... `)
  const up = await send({ op: 'update', segments: behaviorSeg, layer: { name: BEHAVIOR, children: [...havePart, ...newParts] } })
  console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
  if (!up.ok) process.exit(1)

  for (const part of newParts) {
    process.stdout.write(`[struct] ${behaviorSeg.join('/')}/${part} ... `)
    const res = await send({ op: 'update', segments: [...behaviorSeg, part], layer: { name: part } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 2 — notes. Only for cells THIS run created: note-add is not
  // idempotent, so re-noting an existing tile would stack duplicates.
  const notes: { segments: string[]; text: string }[] = []
  if (behaviorIsNew) notes.push({ segments: behaviorSeg, text: BEHAVIOR_NOTE })
  for (const [name, note] of PARTS) {
    if (newParts.includes(name)) notes.push({ segments: [...behaviorSeg, name], text: note })
  }
  for (const n of notes) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: n.segments.slice(0, -1), cell: n.segments[n.segments.length - 1], text: n.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 3 — pheromones. Declared vocabulary only. No replaceKind — tags stack.
  const marks: { segments: string[]; tag: string }[] = []
  if (behaviorIsNew) {
    marks.push({ segments: behaviorSeg, tag: BEHAVIOR_KEYWORD })
    marks.push({ segments: behaviorSeg, tag: COLLECTION_KEYWORD })
  }
  for (const part of newParts) marks.push({ segments: [...behaviorSeg, part], tag: PART_KEYWORD })
  for (const m of marks) {
    process.stdout.write(`[mark] ${m.segments.join('/')} ← ${m.tag} ... `)
    const res = await send({ op: 'decoration-add', segments: m.segments, kind: 'tag', appliesTo: [], payload: { name: m.tag } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  console.log(`[install-revisions] DONE — behaviour ${behaviorIsNew ? 'created' : 'already present'}, ${newParts.length} parts, ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
