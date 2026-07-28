// Mirror pass for HOVER KEEPS THE NAME — the correcting pass over the existing
// `behaviors/appearance/tile-icon-band` behaviour.
//
// What changed in the code, and therefore here:
//   1. Hovering a tile no longer hides its name. The name keeps the band's TOP
//      row and the icons take the row(s) under it, so the band is the name's
//      row plus one per icon row (two normally, three when the icons wrap).
//   2. TEXT-ONLY mode reintroduces every hidden name: a tile marked "hide the
//      label when the image is shown" has nothing to hide behind while no image
//      is drawn, so the name comes back for as long as the mode is on — the
//      per-tile mark is untouched and takes effect again on the way out.
//
// The behaviour tile's existing note still describes the ⟳ icon-set cycle,
// which was removed the same day it was built. This pass writes the SETTLED
// shape over it (notes stack — the hive keeps both, newest last) and gives the
// implementation parts, which never received notes, the notes they should have
// carried. It also adds the one part that was missing: show-cell.drone.ts, the
// drone that decides whether a name is hidden at all.
//
// Extends mirror-tile-icon-band.ts; never re-runs it. Structure is union-only,
// so the pass adds one child and leaves every other member alone.

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

// Mirror of @hypercomb/core normalizeCell so segments == children keys.
function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
    .replace(/[._\s/]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

const E = 'hypercomb-essentials/src/diamondcoreprocessor.com'

const BEHAVIOR_SEG = [norm('behaviors'), norm('appearance'), norm('tile-icon-band')]
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  'Tile icon band, settled shape — hovering a tile GROWS the background behind its name and the name STAYS, in the top row, with the action icons in the row under it.',
  '',
  'At rest the band is one row: the dark strip a tile draws behind its name so the letters read over a picture. On hover it grows, balanced equally above and below the tile centre, to hold the name\'s own row plus one row per row of icons — two rows normally, three when there are more icons than fit one line. The name rides UP into the top row; the icons fill the rows beneath it. There is no separate tray behind the icons: the tile\'s own label background is their background, which is why it shows on hover even for a tile with no picture and no name. A hairline rule sits on the seam under the name, dividing what the tile is CALLED from what you can DO to it.',
  '',
  'This replaces two earlier shapes that no longer exist: the ⋮ reveal that stacked extra rows below the tile, and the ⟳ cycle that walked the tile through icon SETS one line at a time (with a sticky per-tile choice). Both were removed. Everything a tile offers is on screen at once, at one icon size, ordered main → feature → danger so delete lands last.',
  '',
  'TEXT-ONLY mode reintroduces hidden names. A tile can be marked "hide the label when the image is shown" — with the images off there is nothing to hide behind, so every such name comes back for as long as the mode is on. The mark itself is never touched and takes effect again on the way out. Hovering one tile reveals its own name the same way, for as long as the pointer is on it.',
  '',
  `source: ${E}/presentation/grid/hex-sdf.shader.ts, ${E}/presentation/tiles/tile-overlay.drone.ts, ${E}/presentation/tiles/show-cell.drone.ts`,
].join('\n')

type Part = [key: string, note: string]

// Notes for parts that already exist (they were created without notes) plus the
// one new part. `create` says whether the cell has to be minted first.
const PARTS: { key: string; create: boolean; note: string }[] = [
  {
    key: 'hex-sdf-shader',
    create: false,
    note: [
      'The band and the lifted name. The hex fragment shader knows which tile is hovered (u_hoveredIndex against the per-tile cell index), so it draws the label background one row high at rest and as many rows as the overlay asks for on hover, centred on the tile so the extra height is balanced upward and downward in equal parts. While hovered it samples the name that many half-rows further down the tile, which lands the letters in the TOP row — nothing is scaled or re-baked, the same glyphs are simply read from a different place. The band is composited BEFORE the glyphs so it can never paint over the letters, and the seam rule under the name is a drawn line with a sub-pixel core, not a gradient.',
      '',
      `source: ${E}/presentation/grid/hex-sdf.shader.ts`,
    ].join('\n'),
  },
  {
    key: 'tile-overlay-drone',
    create: false,
    note: [
      'The wrapping. Takes the icons that passed their per-tile visibility test, orders them main → feature → danger so delete lands last, fills a row, wraps at five, and stops at two rows. It then tells the renderer how tall the band must be: the name\'s row plus one per icon row. The icon block is centred one half-row BELOW the tile centre, because the name owns the top row — so one row of icons lands on the band\'s second row and two straddle that same centre, one per band row. Every row shares the first row\'s left edge, so a wrap reads as one left-aligned block rather than a short row floating under a full one.',
      '',
      `source: ${E}/presentation/tiles/tile-overlay.drone.ts`,
    ].join('\n'),
  },
  {
    key: 'tile-actions-drone',
    create: false,
    note: [
      'The catalog and the anchor. Holds what every icon IS — its glyph, its profile, the words it says when you rest on it — and the one number that anchors the whole block: the centre of the icon rows, one half-row below the tile centre, under the name\'s row. The arrange-mode hit test derives from that same number, so the rows and the places you can drop an icon can never drift apart.',
      '',
      `source: ${E}/presentation/tiles/tile-actions.drone.ts`,
    ].join('\n'),
  },
  {
    key: 'show-cell-drone',
    create: true,
    note: [
      'Whether a name is hidden at all. A tile marked "hide the label when the image is shown" has its name collapsed to a transparent corner of the atlas — the letters are not drawn rather than drawn and covered. Three things exempt a tile from that: it is the tile under the pointer (the hover reveal), its image never actually landed, or TEXT-ONLY mode is on, where no image is drawn and the mark therefore hides nothing. One answer serves every place the name is written — the full bake, the single-tile update, and the hover flip — so the three can never disagree, and leaving text-only puts every hidden name back the way the tile asked.',
      '',
      `source: ${E}/presentation/tiles/show-cell.drone.ts`,
    ].join('\n'),
  },
]

async function childrenOf(segments: string[]): Promise<string[]> {
  const res = await send({ op: 'inflate', segments })
  if (!res.ok) return []
  const data = res.data as { children?: unknown } | undefined
  const kids = data?.children
  if (Array.isArray(kids)) return kids.map(k => String(typeof k === 'string' ? k : (k as { name?: string })?.name ?? '')).filter(Boolean)
  if (kids && typeof kids === 'object') return Object.keys(kids as Record<string, unknown>)
  return []
}

async function main(): Promise<void> {
  const have = await childrenOf(BEHAVIOR_SEG)
  if (!have.length) {
    console.error(`[hover-name] "${BEHAVIOR_SEG.join('/')}" has no children — is the tile-icon-band mirror built and a renderer connected?`)
    process.exit(1)
  }
  console.log(`[hover-name] ${BEHAVIOR_SEG.join('/')} currently holds: ${have.join(', ')}`)

  // Phase 1 — structure. Union only: add the missing part, keep the rest.
  const missing = PARTS.filter(p => p.create && !have.includes(p.key)).map(p => p.key)
  if (missing.length) {
    process.stdout.write(`[struct] ${BEHAVIOR_SEG.join('/')} ← +${missing.join(', ')} ... `)
    const up = await send({ op: 'update', segments: BEHAVIOR_SEG, layer: { name: BEHAVIOR_SEG[BEHAVIOR_SEG.length - 1], children: [...have, ...missing] } })
    console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
    if (!up.ok) process.exit(1)
    for (const key of missing) {
      process.stdout.write(`[struct] ${BEHAVIOR_SEG.join('/')}/${key} ... `)
      const res = await send({ op: 'update', segments: [...BEHAVIOR_SEG, key], layer: { name: key } })
      console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    }
  } else {
    console.log('[struct] every part already present — notes and marks only')
  }

  // Phase 2 — notes. The behaviour tile gets the correcting note (notes stack;
  // the newest one is the settled shape). Parts get the note they never had.
  const notes: { segments: string[]; text: string }[] = [{ segments: BEHAVIOR_SEG, text: BEHAVIOR_NOTE }]
  for (const p of PARTS) notes.push({ segments: [...BEHAVIOR_SEG, p.key], text: p.note })
  for (const n of notes) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: n.segments.slice(0, -1), cell: n.segments[n.segments.length - 1], text: n.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 3 — pheromones. Declared vocabulary only: `part` on the cells this
  // run created. The behaviour tile keeps the marks it already carries.
  for (const key of missing) {
    process.stdout.write(`[mark] ${BEHAVIOR_SEG.join('/')}/${key} ← ${PART_KEYWORD} ... `)
    const res = await send({ op: 'decoration-add', segments: [...BEHAVIOR_SEG, key], kind: 'tag', appliesTo: [], payload: { name: PART_KEYWORD } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  console.log(`[hover-name] DONE — ${missing.length} new part(s), ${notes.length} notes, ${missing.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
