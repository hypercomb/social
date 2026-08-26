// Mirror pass for THE BACKDROP SHOWS ITSELF — the pass that gives the existing
// `behaviors/appearance/canvas` behaviour tile its implementation parts and the
// note describing its settled shape.
//
// What changed in the code, and therefore here:
//   1. `/canvas` autocomplete now draws a PICTURE of each option instead of a
//      colour dot — the archetype rendered in the palette you would actually
//      get, so the choice is made by eye rather than by name.
//   2. The service grew `swatch(tokens)`, which resolves the same tokens `set()`
//      resolves and applies nothing.
//
// The behaviour tile was minted by the behaviors census with a one-line note and
// never received parts, even though the backdrop is painted across four files in
// two projects. This pass writes the settled note over it (notes stack — the
// hive keeps both, newest last) and spreads the implementation 1:1 across parts.
//
// Extends mirror-behaviors.ts; never re-runs it. Structure is union-only.

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
const S = 'hypercomb-shared/ui'

const BEHAVIOR_SEG = ['behaviors', 'appearance', 'canvas']
const PART_KEYWORD = 'part'

const BEHAVIOR_NOTE = [
  '/canvas — the screen the hive sits on. A backdrop is a PAIR, which is the thing that confuses: an ARCHETYPE (the shape of the pattern) and a PALETTE (the colours it is drawn in). Either half can be set alone and keeps the other: "/canvas dots" changes only the shape, "/canvas indigo" only the colours, "/canvas indigo dots" both, in either order.',
  '',
  'Archetypes: contour (concentric rings, the default), dots, grid, honeycomb, depth (no pattern, a lit gradient), sheen (one diagonal brushed band), mesh (drifting aurora blooms, animated). Palettes: steel, daylight, indigo, teal, ember. Plus two words that are neither — "auto", which lets the palette follow the colour theme (dark → steel, light → daylight, the default), and "off", bare surface.',
  '',
  'This is NOT the colour theme. /theme changes the chrome — every --md-* token behind panels, text and buttons. /canvas changes what is behind the hive. /backgrounds is a third thing again: which default pictures fill blank tiles. "auto" is the only wire between the first two. All three are participant-local (localStorage, or memory for /backgrounds) and never written to a layer — a peer opening the same hive sees their own.',
  '',
  'The autocomplete shows a PICTURE of each option, not a colour dot: the archetype drawn in the palette you would actually get. So an archetype swatch uses your current palette and a palette swatch uses your current archetype — what you see is the result of pressing Tab, not an abstract sample. "off" has no swatch, because it is the absence of one.',
  '',
  `source: ${E}/commands/canvas.queen.ts`,
].join('\n')

const PARTS: { key: string; note: string }[] = [
  {
    key: 'canvas-queen',
    note: [
      'The words. Parses the line into tokens and hands them to the service, prints the current state and the two lists when given nothing, and completes the LAST token so "indigo do" finishes to "indigo dots" instead of collapsing the pair to one word. It keeps no list of its own — the options come from svc.archetypes and svc.palettes, so a new palette or archetype appears in autocomplete without this file being touched.',
      '',
      `source: ${E}/commands/canvas.queen.ts`,
    ].join('\n'),
  },
  {
    key: 'canvas-background-service',
    note: [
      'The backdrop itself. Holds the archetype/palette pair, persists it to localStorage, resolves "auto" against the colour theme (and re-resolves when the theme flips or the OS preference changes), and paints the result. The painting is deliberately split: the base colour, vignette and gradient-only archetypes go on <body>; the lighting is its own fixed element so it can breathe; the lattice archetypes are handed to the content-space lines layer. Everything is CSS gradients — no image files — so a backdrop covers any viewport in any orientation with no cropping, no seams and no banding.',
      '',
      'It also answers what a choice WOULD look like: swatch(tokens) takes exactly what set() takes, fills the unspecified half from what is showing now, and returns one background shorthand at chip scale — without applying anything. It cannot reuse the live CSS, because the live look is spread across three surfaces; the swatch folds all three back together. A new archetype therefore needs a case in BOTH cssFor and swatchFor, or its dropdown entry shows the base gradient with no pattern.',
      '',
      `source: ${E}/presentation/background/canvas-background.service.ts`,
    ].join('\n'),
  },
  {
    key: 'grid-lines-drone',
    note: [
      'The lattice, in content space. grid, dots and honeycomb are NOT painted on the body — they live in the Pixi zoom container, so they pan and scale WITH the hive instead of sticking to the screen like the lighting does. The service broadcasts the chosen pattern, its accent colour and its alpha over the canvas:lines effect; the gradient-only archetypes send nothing and this layer clears.',
      '',
      `source: ${E}/presentation/background/grid-lines.drone.ts`,
    ].join('\n'),
  },
  {
    key: 'dropdown-swatch-map',
    note: [
      'Which swatch belongs to which suggestion. The command line already carried a colour map for the dropdown — accent presets, and each tag drawn in its own colour. While the line is completing /canvas it asks the backdrop service for a swatch per suggestion instead, and raises a flag saying these values are whole pictures rather than single colours. The service is reached through the IoC key, never an import: shared may never depend on a module, so when the drone is absent the map is simply empty and the dropdown falls back to plain rows.',
      '',
      `source: ${S}/command-line/command-line.element.ts`,
    ].join('\n'),
  },
  {
    key: 'dropdown-swatch-chip',
    note: [
      'The chip. The same element that draws a tag\'s colour dot draws the backdrop swatch — it is given a CSS background, so a gradient stack works exactly where a single colour did. Only the shape changes with the flag: a picture needs to be landscape and framed with a hairline, or a dark backdrop has no edge against a dark dropdown. A suggestion with no swatch (off) renders no chip at all rather than an empty box.',
      '',
      `source: ${S}/command-shell/command-shell.element.scss`,
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
  console.log(`[canvas] ${BEHAVIOR_SEG.join('/')} currently holds: ${have.length ? have.join(', ') : '(nothing)'}`)

  // Phase 1 — structure. Union only: add missing parts, keep anything present.
  const missing = PARTS.filter(p => !have.includes(p.key)).map(p => p.key)
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

  // Phase 2 — notes. The behaviour tile gets the settled note (notes stack; the
  // newest is the settled shape). Each part gets its own.
  const notes: { segments: string[]; text: string }[] = [{ segments: BEHAVIOR_SEG, text: BEHAVIOR_NOTE }]
  for (const p of PARTS) notes.push({ segments: [...BEHAVIOR_SEG, p.key], text: p.note })
  for (const n of notes) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: n.segments.slice(0, -1), cell: n.segments[n.segments.length - 1], text: n.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 3 — pheromones. Declared vocabulary only: `part` on the cells this run
  // created. The behaviour tile keeps the marks it already carries; no
  // replaceKind, which would nuke the sibling tag.
  for (const key of missing) {
    process.stdout.write(`[mark] ${BEHAVIOR_SEG.join('/')}/${key} ← ${PART_KEYWORD} ... `)
    const res = await send({ op: 'decoration-add', segments: [...BEHAVIOR_SEG, key], kind: 'tag', appliesTo: [], payload: { name: PART_KEYWORD } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  console.log(`[canvas] DONE — ${missing.length} new part(s), ${notes.length} notes, ${missing.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
