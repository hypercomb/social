// Mirror pass for BACKGROUND THEMES — the pass that folds `canvas` and
// `backgrounds` into one `background` behaviour tile.
//
// What changed in the code, and therefore here:
//   1. /canvas and /backgrounds are GONE. One /background replaces both: a flat
//      list of named themes, each declaring whether it dresses the screen, the
//      tiles, or both.
//   2. The archetype × palette pair is folded away — each theme has its pattern
//      already chosen.
//   3. The generated theme assets that shipped wired to nothing (five palette
//      tile sets) are registered as substrate sources and reachable again.
//
// `behaviors/appearance/canvas` was mirrored earlier the same day with five
// parts (mirror-canvas-swatches.ts). That tile is now the wrong name for the
// wrong shape, and the rename doctrine says a name IS an address: so this pass
// mints `background` with the settled structure and leaves `canvas` standing
// with a note saying what it became. Nothing is deleted from the hive by a
// mirror pass — the hive keeps its history, and a tile that named a behaviour
// that no longer exists is a fact about the past, not a mistake to erase.
//
// `backgrounds` gets the same retirement note. Structure is union-only.

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

const APPEARANCE = ['behaviors', 'appearance']
const SEG = [...APPEARANCE, 'background']
const PART = 'part'
const BEHAVIOR = 'behavior'
const CATEGORY = 'appearance'

const BEHAVIOR_NOTE = [
  '/background — one command, one list, one word. A THEME is a named look that declares what it dresses: the SCREEN behind the hive, the TILES (the pictures that fill blank tiles), or both. A theme that names no screen leaves the screen alone, so an image theme lays over whichever backdrop is already showing.',
  '',
  'Themes: steel, daylight, indigo, teal and ember dress screen + tiles; photos, minimal, geometric, abstract and nature dress tiles only; off is bare surface. The autocomplete DRAWS each one — a theme with a screen shows that backdrop at chip size, a tiles-only theme shows one of its own pictures — so the choice is made by eye, not by name.',
  '',
  'This replaced four things that all changed what you see and none of which showed you anything: /canvas asked for an ARCHETYPE and a PALETTE as two separate axes you had to hold in your head; /backgrounds toggled individual pictures one at a time; /substrate set switched collections; and several generated theme asset sets shipped wired to nothing at all. /canvas and /backgrounds are gone and the axes are folded into the themes. Curating which pictures are IN a set is a different job and still lives in the substrate organizer, /substrate.',
  '',
  'There are no aliases. Every word means exactly itself — a second word for a thing that already has a word is a vocabulary you have to learn instead of read. Aliases are the participant\'s to mint, never shipped in a list in the source.',
  '',
  'The list is DATA: one entry names a screen (an archetype + palette the canvas service already draws), a tiles source id, and a preview picture. Nothing about a theme is special-cased anywhere, so any number can be added — including by a module that never touches this file.',
  '',
  `source: ${E}/commands/background.queen.ts`,
].join('\n')

const PARTS: { key: string; note: string }[] = [
  {
    key: 'background-queen',
    note: [
      'The words. Lists the themes with which halves each one dresses and a mark on the active one, applies a theme by name, and completes from the service\'s own list — so a theme added anywhere appears in autocomplete with no edit here. It holds no theme knowledge of its own and no aliases.',
      '',
      `source: ${E}/commands/background.queen.ts`,
    ].join('\n'),
  },
  {
    key: 'background-theme-service',
    note: [
      'The list, and the only place that decides how the app is dressed. Holds the themes, remembers the chosen one in localStorage (participant-local, never a layer), and applies a theme by handing each half to the service that already paints it: the screen to the canvas background, the tiles to the substrate. It is not a new renderer — it only decides what to tell the two that exist.',
      '',
      'A theme naming a tiles source that is not registered dresses what it CAN rather than failing the whole change. register() is the seam that makes the list data: a module can ship a look without this file knowing about it.',
      '',
      `source: ${E}/presentation/background/background-theme.service.ts`,
    ].join('\n'),
  },
  {
    key: 'canvas-background-service',
    note: [
      'The screen half. Draws the backdrop a theme asks for, entirely in CSS gradients — no image files — so it covers any viewport in any orientation with no cropping, no seams and no banding. The painting is deliberately split: base colour and vignette on the body, the lighting in its own fixed element so it can breathe, the lattice patterns handed to the content-space lines layer.',
      '',
      'It also answers what a look WOULD be: swatch() returns one background shorthand at chip scale. It cannot reuse the live CSS, because the live look is spread across three surfaces, and it deliberately pushes the contrast far past the live values — the live alphas are tuned for a whole screen, where a whisper of a pattern is still thousands of pixels of it. In a chip those same numbers are a flat dark rectangle and every option looks identical. A swatch is a legible MINIATURE, not a scale model.',
      '',
      `source: ${E}/presentation/background/canvas-background.service.ts`,
    ].join('\n'),
  },
  {
    key: 'grid-lines-drone',
    note: [
      'The lattice, in content space. grid, dots and honeycomb are NOT painted on the body — they live in the Pixi zoom container, so they pan and scale WITH the hive instead of sticking to the screen like the lighting does. The canvas service broadcasts the chosen pattern, its accent colour and its alpha; the gradient-only archetypes send nothing and this layer clears.',
      '',
      `source: ${E}/presentation/background/grid-lines.drone.ts`,
    ].join('\n'),
  },
  {
    key: 'substrate-service',
    note: [
      'The tiles half. Owns the image sources and which one is active; a theme switches tiles by making its source the active one. The five palette sets shipped as rasters in the web shell but their SOURCES had been dropped from the builtin list, which orphaned them — nothing could select those images. They are registered again, which is what let the palette themes dress both halves. New builtins merge on every load, so this needed no version bump: the version only governs whether an unconfigured active source advances.',
      '',
      `source: ${E}/substrate/substrate.service.ts`,
    ].join('\n'),
  },
  {
    key: 'dropdown-swatch-map',
    note: [
      'Which swatch belongs to which suggestion. The command line already carried a colour map for the dropdown — accent presets, and each tag drawn in its own colour. While the line is completing /background it asks the theme service for a swatch per suggestion instead, and raises a flag saying these values are whole pictures rather than single colours. The service is reached through the IoC key, never an import: shared may never depend on a module, so when the drone is absent the map is empty and the dropdown falls back to plain rows.',
      '',
      `source: ${S}/command-line/command-line.component.ts`,
    ].join('\n'),
  },
  {
    key: 'dropdown-swatch-chip',
    note: [
      'The chip. The same element that draws a tag\'s colour dot draws the theme swatch — it is given a CSS background, so a gradient stack or an image works exactly where a single colour did. Only the shape changes with the flag: a picture needs to be landscape and framed with a hairline, or a dark theme has no edge against a dark dropdown. A suggestion with no swatch (off) renders no chip at all rather than an empty box.',
      '',
      `source: ${S}/command-shell/command-shell.element.scss`,
    ].join('\n'),
  },
]

// The two retired behaviour tiles. Left standing, marked with what they became.
const RETIRED: { key: string; note: string }[] = [
  {
    key: 'canvas',
    note: [
      'RETIRED — /canvas no longer exists. It became /background (behaviors/appearance/background).',
      '',
      'It asked for an ARCHETYPE (contour, dots, grid, honeycomb, depth, sheen, mesh) and a PALETTE (steel, daylight, indigo, teal, ember) as two independent axes, either settable alone. That pair was the confusing part, and it is folded away: each background theme now has its pattern already chosen. The drawing itself survives untouched as the screen half of a theme — see background/canvas-background-service.',
      '',
      'Its parts moved with it: the swatch machinery this tile was given is now under background.',
    ].join('\n'),
  },
  {
    key: 'backgrounds',
    note: [
      'RETIRED — /backgrounds no longer exists. It became /background (behaviors/appearance/background).',
      '',
      'It listed the default pictures and toggled them in and out of the pool one at a time, for the session only. Choosing a whole SET is now a background theme; curating which pictures are inside a set is a different job and lives in the substrate organizer, /substrate.',
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
  const siblings = await childrenOf(APPEARANCE)
  if (!siblings.length) {
    console.error('[background] behaviors/appearance has no children — is the behaviors mirror built and a renderer connected?')
    process.exit(1)
  }
  console.log(`[background] behaviors/appearance holds: ${siblings.join(', ')}`)

  // Phase 1 — structure. The behaviour tile, then its parts. Union only.
  if (!siblings.includes('background')) {
    process.stdout.write('[struct] behaviors/appearance ← +background ... ')
    const up = await send({ op: 'update', segments: APPEARANCE, layer: { name: 'appearance', children: [...siblings, 'background'] } })
    console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
    if (!up.ok) process.exit(1)
  }

  const have = await childrenOf(SEG)
  const missing = PARTS.filter(p => !have.includes(p.key)).map(p => p.key)
  if (missing.length) {
    process.stdout.write(`[struct] ${SEG.join('/')} ← +${missing.join(', ')} ... `)
    const up = await send({ op: 'update', segments: SEG, layer: { name: 'background', children: [...have, ...missing] } })
    console.log(up.ok ? 'ok' : `FAIL: ${up.error}`)
    if (!up.ok) process.exit(1)
    for (const key of missing) {
      process.stdout.write(`[struct] ${SEG.join('/')}/${key} ... `)
      const res = await send({ op: 'update', segments: [...SEG, key], layer: { name: key } })
      console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
    }
  } else {
    console.log('[struct] every part already present — notes and marks only')
  }

  // Phase 2 — notes: the behaviour, each part, and the retirement notices.
  const notes: { segments: string[]; text: string }[] = [{ segments: SEG, text: BEHAVIOR_NOTE }]
  for (const p of PARTS) notes.push({ segments: [...SEG, p.key], text: p.note })
  for (const r of RETIRED) if (siblings.includes(r.key)) notes.push({ segments: [...APPEARANCE, r.key], text: r.note })
  for (const n of notes) {
    process.stdout.write(`[note] ${n.segments.join('/')} ... `)
    const res = await send({ op: 'note-add', segments: n.segments.slice(0, -1), cell: n.segments[n.segments.length - 1], text: n.text })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  // Phase 3 — pheromones. Declared vocabulary only: `behavior` + the category
  // keyword on the behaviour tile (which is how the appearance collection finds
  // it), `part` on each part. No replaceKind — it would nuke the sibling tag.
  const marks: { segments: string[]; name: string }[] = [
    { segments: SEG, name: BEHAVIOR },
    { segments: SEG, name: CATEGORY },
    ...missing.map(key => ({ segments: [...SEG, key], name: PART })),
  ]
  for (const m of marks) {
    process.stdout.write(`[mark] ${m.segments.join('/')} ← ${m.name} ... `)
    const res = await send({ op: 'decoration-add', segments: m.segments, kind: 'tag', appliesTo: [], payload: { name: m.name } })
    console.log(res.ok ? 'ok' : `FAIL: ${res.error}`)
  }

  console.log(`[background] DONE — ${missing.length} part(s), ${notes.length} notes, ${marks.length} marks`)
}

main().catch(err => { console.error(err); process.exit(1) })
