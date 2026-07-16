// Build the "revolucion" ecosystem hive — the Revolucion Style cigar journal
// as a full experience ecosystem, TILES ONLY (no code, no websites yet).
//
// Sourced from the revolucionstyle.com essentials module (journal-entry.ts,
// flavor-data.ts, discovery.service.ts) plus the ecosystem conversation:
// journal as entry point → experience tiles spoken into being → community
// vocabulary → anonymized insights for makers → experience-named products.
//
// Design rules (same as intel-build-humanity-centres.ts):
//   1. Cell names are pre-normalized (lowercase-hyphen) so bridge `segments`
//      (signed raw) == `children` keys (normalized) — one clean tree.
//   2. Readable descriptive text lives in NOTES (free text, not normalized).
//
// Sibling-safe: one atomic root `update` = existing top cells + 'revolucion'.
// Structure re-runs are idempotent; NOTES are not (note-add appends) — the
// script aborts if 'revolucion' is already at root. Run once.

import WebSocket from 'ws'

// Local send() — same protocol as hypercomb-cli/src/bridge/client.ts but with
// a 60s timeout: `inflate []` on a full hive takes >10s, which is exactly why
// the shared client's hard 10s timeout aborts the preflight. Also retries once
// when the relay reports 'no renderer connected' (renderer reconnect window).
const BRIDGE_PORT = 2401
const TIMEOUT = 60_000

let counter = 0
type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }

function sendOnce(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `cli-${Date.now()}-${++counter}` }
    const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)
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
    .replace(/[._\s]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '')
}

interface HiveTile { name: string; notes?: string[]; children?: HiveTile[] }

const ROOT_LABEL = 'revolucion'
const ROOT_KEY = norm(ROOT_LABEL)

const leaf = (names: string[]): HiveTile[] => names.map(name => ({ name }))

const TREE: HiveTile = {
  name: ROOT_LABEL,
  notes: [
    'Revolucion curates meaningful experiences — the cigar is the medium, the moment is the product.',
    'The journal is the foundation: people share their experiences, get better recommendations, and a deeper sense of connection. Everything else in the ecosystem grows from it.',
  ],
  children: [
    {
      name: 'journal',
      notes: [
        'The entry point of the ecosystem. A moment is captured as experience tiles — cigar, flavors, pairing, weather, company, mood — not a form.',
      ],
      children: [
        {
          name: 'speak-your-moment',
          notes: [
            'Press speak and describe how it was. A deterministic script — not AI — listens for grammar keywords and builds the scene: say "cloudy" and clouds drift in, say "scotch" and the glass arrives. Then adjust the tiles to match the moment.',
            'The grammar keyword IS the tile name. Each experience tile under revolucion/experience is an activation word with a predefined look and behavior — a crafted world, not an automated one.',
            'Later, AI can help interpret vague or poetic inputs — but the tile visuals stay deterministic and under our control.',
          ],
        },
        {
          name: 'new-entry',
          notes: ['One moment = one entry: the cigar, what you tasted, how it smoked, what you drank, where you were, who you were with.'],
          children: [
            { name: 'cigar', notes: ['Identity: brand, line, name, vitola, wrapper, origin, strength.'] },
            { name: 'flavors', notes: ['Picked on the flavor wheel — tap what you tasted, slide the intensity.'] },
            { name: 'ratings', notes: ['Draw, burn, construction, flavor, overall.'] },
            { name: 'pairings', notes: ['What accompanied it — coffee, whiskey, rum, wine, beer, tea, food.'] },
            { name: 'occasion', notes: ['Why this moment — the celebration, the quiet evening, the milestone.'] },
            { name: 'photos', notes: ['The band, the ash, the view.'] },
          ],
        },
        { name: 'my-moments', notes: ['Your timeline of experiences — every entry a scene you can revisit.'] },
        { name: 'favorites', notes: ['The moments and cigars you keep coming back to.'] },
        { name: 'stats', notes: ['Your patterns: most-tasted flavors, favorite pairings, when and where you smoke best.'] },
      ],
    },
    {
      name: 'experience',
      notes: [
        'The shared grammar of moments. Each tile is a spoken keyword that brings its element into the scene — weather, time, setting, company, mood, drink.',
        'Over time these tiles build a knowledge graph: not "this person likes maduro" but "they like it on cool evenings, outdoors, with close friends and coffee."',
      ],
      children: [
        { name: 'weather', notes: ['Say it and the sky changes: "cloudy" brings the clouds into the scene.'], children: leaf(['sunny', 'cloudy', 'rain', 'breeze', 'crisp-air', 'warm-night']) },
        { name: 'time', children: leaf(['morning', 'afternoon', 'golden-hour', 'evening', 'late-night']) },
        { name: 'setting', children: leaf(['patio', 'lounge', 'garden', 'beach', 'fireside', 'cabin', 'golf-course', 'rooftop']) },
        { name: 'company', children: leaf(['solo', 'close-friends', 'family', 'new-faces', 'celebration-crowd']) },
        { name: 'mood', notes: ['The heart of the vocabulary — these words become the names people ask for.'], children: leaf(['reflection', 'conversation', 'celebration', 'focus', 'unwind', 'gratitude', 'milestone']) },
        { name: 'drinks', notes: ['Say "scotch" and the glass arrives in the scene.'], children: leaf(['coffee', 'espresso', 'whiskey', 'scotch', 'rum', 'wine', 'beer', 'tea', 'hot-chocolate', 'water']) },
      ],
    },
    {
      name: 'cigars',
      notes: ['The living catalog. Every cigar logged in a journal joins it — the community writes the catalog by smoking.'],
      children: [
        { name: 'brands', notes: ['Grows from the journal: brand → line → cigar, built from what people actually smoke.'] },
        { name: 'vitolas', children: leaf(['robusto', 'toro', 'corona', 'churchill', 'lancero', 'gordo', 'belicoso', 'torpedo', 'perfecto', 'petit-corona', 'lonsdale', 'panatela']) },
        { name: 'wrappers', children: leaf(['natural', 'maduro', 'oscuro', 'claro', 'colorado', 'colorado-maduro', 'connecticut', 'habano', 'sumatra']) },
        { name: 'origins', children: leaf(['cuba', 'nicaragua', 'dominican-republic', 'honduras', 'mexico', 'ecuador', 'brazil', 'cameroon', 'united-states']) },
        { name: 'strength', children: leaf(['mild', 'mild-medium', 'medium', 'medium-full', 'full']) },
      ],
    },
    {
      name: 'flavor-wheel',
      notes: ['Ten families, one shared tasting language. Tap what you taste; intensity is a slide.'],
      children: [
        { name: 'earth', notes: ['Soil, Leather, Mineral, Moss, Mushroom, Peat.'] },
        { name: 'wood', notes: ['Cedar, Oak, Hickory, Mesquite, Charred Wood, Sandalwood.'] },
        { name: 'spice', notes: ['Black Pepper, White Pepper, Red Pepper, Cinnamon, Clove, Nutmeg, Anise.'] },
        { name: 'sweet', notes: ['Caramel, Honey, Vanilla, Molasses, Maple, Brown Sugar.'] },
        { name: 'coffee-chocolate', notes: ['Espresso, Black Coffee, Dark Chocolate, Cocoa, Mocha, Roasted Bean.'] },
        { name: 'cream-bread', notes: ['Butter, Cream, Toast, Biscuit, Brioche, Malt.'] },
        { name: 'nut', notes: ['Almond, Walnut, Cashew, Chestnut, Hazelnut, Peanut, Pistachio.'] },
        { name: 'fruit', notes: ['Citrus, Dried Fruit, Berry, Fig, Stone Fruit, Raisin, Prune.'] },
        { name: 'herbal-floral', notes: ['Grass, Hay, Tea, Lavender, Jasmine, Mint.'] },
        { name: 'smoke-char', notes: ['Campfire, Tobacco, Ash, Burnt Caramel, Charcoal, Incense.'] },
      ],
    },
    {
      name: 'discovery',
      notes: ['Recommendations grown from journals, not star ratings.'],
      children: [
        { name: 'for-you', notes: ['Flavor-profile similarity against your own entries — cigars whose tasted flavors overlap what you already love.'] },
        { name: 'by-experience', notes: ['"I\'m in the mood for a reflection experience" — ask for a moment, not a medium-bodied Nicaraguan.'] },
        { name: 'kindred-smokers', notes: ['People whose palates and moments rhyme with yours — connection, not just products.'] },
        { name: 'knowledge-graph', notes: ['The deep record the journal builds: cigar × flavor × pairing × weather × company × mood. Richer than any rating.'] },
      ],
    },
    {
      name: 'community',
      notes: ['The deeper sense of connection — people connect with each other through shared vocabulary, not just with products.'],
      children: [
        { name: 'shared-moments', notes: ['Journal entries members choose to share — scenes, not reviews.'] },
        { name: 'vocabulary', notes: ['The experience terms that emerge organically from community data. Because they grow from real journals, they feel authentic — and people start speaking them.'] },
        { name: 'circles', notes: ['Herf nights, lounge meetups, tasting circles — where the vocabulary is spoken out loud.'] },
        { name: 'first-light', notes: ['A gentle path for new smokers. Set expectations honestly — if the pepper surprises, say so before it intimidates.'] },
      ],
    },
    {
      name: 'insights',
      notes: [
        'Anonymized, aggregated trends shared with distributors and manufacturers — helping them understand the people they serve, never telling them what to make.',
        'This positions Revolucion as a trusted fulcrum, not just another retailer.',
      ],
      children: [
        { name: 'occasion-trends', notes: ['Beyond star ratings: "this blend is most often chosen for quiet evening reflection."'] },
        { name: 'pairing-performance', notes: ['"Often exceeds expectations with coffee, but underperforms with whisky pairings."'] },
        { name: 'newcomer-experience', notes: ['"New smokers feel intimidated by it — the pepper is a surprise." Feedback that refines a blend\'s introduction, not its soul.'] },
        { name: 'blend-feedback', notes: ['Insight that helps makers refine blends, vitolas, and marketing — understanding, not instruction.'] },
        { name: 'privacy', notes: ['Anonymized and aggregated, always. No individual journal ever leaves the hive without its author\'s consent.'] },
      ],
    },
    {
      name: 'collaborations',
      notes: ['Products named for the experiences they create, built with makers from community insight.'],
      children: [
        {
          name: 'named-experiences',
          notes: [
            'Names shift from wrapper and origin to experience: when a person smokes it, they speak it, they feel it — a more intimate relationship.',
            'The labels emerge organically from community data, so they feel authentic rather than invented.',
          ],
          children: [
            { name: 'conversation', notes: ['For the table that will not stop talking.'] },
            { name: 'reflection', notes: ['For the quiet evening that asks nothing of you.'] },
            { name: 'celebration', notes: ['For the milestone that deserves smoke rings.'] },
          ],
        },
        { name: 'makers', notes: ['Manufacturers and distributors who build to the vocabulary — partners in the ecosystem, guided by insights.'] },
        { name: 'beyond-cigars', notes: ['The vocabulary outgrows the leaf: chocolates, coffees, spirits named to the same experiences.'] },
      ],
    },
    {
      name: 'humidor',
      notes: ['Your collection, kept and aging.'],
      children: [
        { name: 'my-collection', notes: ['What you hold now — counts, dates acquired.'] },
        { name: 'wishlist', notes: ['What discovery has convinced you to try next.'] },
        { name: 'aging', notes: ['What rests, and how long it has rested.'] },
      ],
    },
    {
      name: 'mission',
      notes: [
        'Curating meaningful experiences — not selling cigars. The journal is the foundation that grows the mission.',
        'Ecosystem loop: journal → shared vocabulary → discovery and community → anonymized insights → experience-named products → richer journals.',
      ],
    },
  ],
}

interface TileSpec { segments: string[]; name: string; children: string[]; notes: string[] }

function collectTiles(node: HiveTile, segments: string[], out: TileSpec[]): void {
  out.push({
    segments: segments.slice(),
    name: norm(node.name),
    children: (node.children ?? []).map(c => norm(c.name)),
    notes: node.notes ?? [],
  })
  for (const child of node.children ?? []) {
    collectTiles(child, [...segments, norm(child.name)], out)
  }
}

async function preflight(attempts: number): Promise<{ rootName: string; topNames: string[] } | undefined> {
  for (let i = 1; i <= attempts; i++) {
    const inf = await send({ op: 'inflate', segments: [] }).catch((e: Error) => ({
      ok: false as const, error: e.message, id: '', data: undefined,
    }))
    if (inf.ok) {
      const root = (inf.data ?? {}) as { name?: string; children?: { name?: string }[] }
      return {
        rootName: root.name ?? '/',
        topNames: (root.children ?? []).map(c => String(c.name ?? '')).filter(Boolean),
      }
    }
    console.log(`[revolucion] preflight ${i}/${attempts} — bridge not ready (${inf.error}), retrying...`)
    await new Promise(r => setTimeout(r, 3000))
  }
  return undefined
}

async function main(): Promise<void> {
  const pre = await preflight(5)
  if (!pre) {
    console.error('[revolucion] ABORT: no renderer. Open the app on localhost with ?claudeBridge=1, then re-run.')
    process.exit(1)
  }
  console.log(`[revolucion] live root "${pre.rootName}" holds: ${pre.topNames.join(', ') || '(none)'}`)

  // MERGE MODE: "revolucion" may already exist as a styled tile with a stub
  // tree (styles, journal/cigar-wheel, abc/123). Never replace — union my
  // children into any pre-existing cell's membership and touch nothing else.
  // `update` sets only the slots present in the payload, so properties
  // (tile imagery, substrate) survive a children-only update.
  const existingChildren = new Map<string, string[]>()
  if (pre.topNames.includes(ROOT_KEY)) {
    const ex = await send({ op: 'inflate', segments: [ROOT_KEY] })
    if (!ex.ok) {
      console.error(`[revolucion] ABORT: cannot inflate existing "${ROOT_KEY}": ${ex.error}`)
      process.exit(1)
    }
    const walkEx = (node: any, path: string[]): void => {
      const kids = Array.isArray(node?.children) ? node.children : []
      existingChildren.set(path.join('/'), kids.map((k: any) => String(k?.name ?? '')).filter(Boolean))
      for (const k of kids) if (k?.name) walkEx(k, [...path, String(k.name)])
    }
    walkEx(ex.data, [ROOT_KEY])
    // Re-run sentinel: "mission" only exists once THIS build has run —
    // a second pass would duplicate every note.
    if ((existingChildren.get(ROOT_KEY) ?? []).includes('mission')) {
      console.warn('[revolucion] ABORT: ecosystem already built (mission present) — re-run would duplicate notes.')
      process.exit(1)
    }
    console.log(`[revolucion] merging into existing tree: ${(existingChildren.get(ROOT_KEY) ?? []).join(', ')}`)
  }

  const tiles: TileSpec[] = []
  collectTiles(TREE, [ROOT_KEY], tiles)
  const totalNotes = tiles.reduce((n, t) => n + t.notes.length, 0)
  console.log(`[revolucion] plan: ${tiles.length} cells + ${totalNotes} notes under "${ROOT_KEY}"`)

  if (!pre.topNames.includes(ROOT_KEY)) {
    // Fresh case — atomic root layer: existing top cells + new sibling.
    const nextRoot = [...pre.topNames, ROOT_KEY]
    process.stdout.write(`[revolucion] root layer ← [${nextRoot.join(', ')}] ... `)
    const rootRes = await send({ op: 'update', segments: [], layer: { name: pre.rootName, children: nextRoot } })
    console.log(rootRes.ok ? 'ok' : `FAIL: ${rootRes.error}`)
    if (!rootRes.ok) process.exit(1)
  }

  // Phase 1: structure (normalized names; segments == children keys).
  // Membership = existing children first (tile order stays still), then mine.
  let okStruct = 0, failStruct = 0
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]
    const have = existingChildren.get(t.segments.join('/')) ?? []
    const merged = [...have, ...t.children.filter(c => !have.includes(c))]
    process.stdout.write(`[struct ${i + 1}/${tiles.length}] ${t.segments.join('/')} ← ${merged.length} children${have.length ? ` (${have.length} kept)` : ''} ... `)
    const layer: { name: string; children?: string[] } = { name: t.name }
    if (merged.length) layer.children = merged
    const res = await send({ op: 'update', segments: t.segments, layer })
    if (res.ok) { okStruct++; console.log('ok') }
    else { failStruct++; console.log(`FAIL: ${res.error}`) }
  }
  console.log(`[revolucion] phase 1: ${okStruct} ok, ${failStruct} failed`)

  // Phase 2: notes (free text) on their owning cell.
  let okNotes = 0, failNotes = 0, noteIdx = 0
  for (const t of tiles) {
    if (!t.notes.length) continue
    const parentSegments = t.segments.slice(0, -1)
    const cellLabel = t.segments[t.segments.length - 1]
    for (const text of t.notes) {
      noteIdx++
      process.stdout.write(`[note ${noteIdx}/${totalNotes}] ${t.segments.join('/')} ... `)
      const res = await send({ op: 'note-add', segments: parentSegments, cell: cellLabel, text })
      if (res.ok) { okNotes++; console.log('ok') }
      else { failNotes++; console.log(`FAIL: ${res.error}`) }
    }
  }
  console.log(`[revolucion] phase 2: ${okNotes} ok, ${failNotes} failed`)
  console.log(`[revolucion] DONE — ${okStruct} cells + ${okNotes} notes under "${ROOT_KEY}"`)
}

main().catch(err => { console.error(err); process.exit(1) })
