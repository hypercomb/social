// Mirror pass for the AGENTS creation — behaviors/assistant/agents.
// Extends the existing behaviors mirror; never re-runs it.

const WebSocket = require('ws')
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'

let counter = 0
function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { try { ws.close() } catch {} ; reject(new Error('bridge timeout')) }, 60_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `mirror-agents-${Date.now()}-${++counter}` })))
    ws.on('message', raw => {
      clearTimeout(t)
      try { resolve(JSON.parse(String(raw))) } catch (e) { reject(e) }
      ws.close()
    })
    ws.on('error', e => { clearTimeout(t); reject(e) })
  })
}

const must = async (req, what) => {
  const r = await send(req)
  if (!r.ok) throw new Error(`${what}: ${r.error}`)
  return r
}

const ASSISTANT = ['behaviors', 'assistant']
const AGENTS = [...ASSISTANT, 'agents']
const ORCHESTRATOR = [...ASSISTANT, 'orchestrator']

const PARTS = [
  ['agent-waggle',
    'How a bee dances tells you WHAT KIND of thing is running before you read a word. The base is the tutorial\'s loved figure-8 (sin 7.4t across 30, sin 14.8t down 11); every pattern is a sibling of it. model dances it unchanged; script paces a flat triangle wave (deterministic work should not look like it is deliberating); system holds a slow circle; the orchestrator walks the same figure-8 three times as wide and a third the speed. Also gives the WAGGLE AREA — the patch of air the bee dances in, which is what a cursor can actually be aimed at.\n\nsource: hypercomb-essentials/src/diamondcoreprocessor.com/presentation/avatars/agent-waggle.ts'],
  ['agent-model',
    'Whose model is that? Vendor decides the colour family (every Claude bee clay, every GPT bee teal, every Gemini bee sky) and tier shades within it (deep models darkest, fast models lightest), so a swarm of several vendors reads across a room. Pure string matching over model names — a model it has never heard of gets vendor `unknown` and a stable hue derived from its own name, so nothing breaks when a new model ships.\n\nsource: hypercomb-essentials/src/diamondcoreprocessor.com/presentation/avatars/agent-model.ts'],
  ['agent-emblem',
    'The mark on a bee\'s back, saying what sort of worker it is at a glance: burst = an AI model thinking, gear = a script running, ring = background housekeeping, eye = the orchestrator watching. Colour says WHICH behaviour, the mark says WHAT SORT. Baked into the same atlas as the drawing, so it costs nothing to render.\n\nsource: hypercomb-essentials/src/diamondcoreprocessor.com/presentation/avatars/bee-ab-atlas.ts'],
  ['agent-registry',
    'What is working in this hive right now. Queued asks ARE the agents — they persist as ask records in the optimization pool, so a bee survives a reload. Any behaviour can raise one through agent:start / agent:progress / agent:end, and install:sync raises its own.\n\nsource: hypercomb-essentials/src/diamondcoreprocessor.com/assistant/agent-registry.service.ts'],
  ['agent-avatar',
    'Which bee you see for which behaviour. Every behaviour has its own avatar type: a participant override wins, then what the behaviour declares on its VisualBeeDescriptor, then a palette derived from its name — so an undeclared behaviour still flies a distinct bee. Colours recolour the AB drawing; imageSig flies a resource of your own instead.\n\nsource: hypercomb-essentials/src/diamondcoreprocessor.com/presentation/avatars/agent-avatar.ts'],
  ['agent-bee',
    'The bees themselves — one sprite per agent, flying over the tiles it is working on, holding a constant size on screen so a zoomed-out hive still shows it. Separate from the peer swarm because each behaviour has its own texture. Clicks are taken in a capture-phase hit test, so pressing a bee never pans, navigates or selects.\n\nsource: hypercomb-essentials/src/diamondcoreprocessor.com/presentation/avatars/agent-bee.drone.ts'],
  ['agent-panel',
    'What opens when you click a bee: the request, where the answer will land, the running activity the responder reports, and a box to hand it more context while it is still in flight. A panel, not a takeover — the hive stays visible behind it, so it locks the input gate instead of entering a view mode.\n\nsource: hypercomb-essentials/src/diamondcoreprocessor.com/assistant/agent-panel.view.ts'],
  ['agent-progress-op',
    'How work in another process tells the hive what it is doing. A responder sends agent-progress over the bridge ({ cell: ask sig, text: activity, kind: status }) and the bee\'s panel shows it live. Writes nothing — no layer, no note, no record — so a chatty responder can report as often as it likes.\n\nsource: hypercomb-essentials/src/diamondcoreprocessor.com/assistant/claude-bridge.worker.ts (agent-progress) + scripts/bridge/_ask-drain.cjs progress'],
]

const ORCHESTRATOR_PARTS = [
  ['orchestrator-drone',
    'The bee that watches the other bees. Sweeps the agent registry every 15s and raises findings: waiting (queued a long time with nothing picking it up), silent (said it was working then went quiet), overlap (two live agents on one tile), failed, rogue (alive long past any reasonable run). Calm while everything is healthy, dances when it has something to say. It REPORTS, it never intervenes — a stalled ask is still the participant\'s request, and retiring someone else\'s work on a timer would destroy data to satisfy a heuristic.\n\nsource: hypercomb-essentials/src/diamondcoreprocessor.com/assistant/orchestrator.drone.ts'],
  ['orchestrator-sweep',
    'The half of the watch that cannot run in a browser: stray log files a run left in the repo, behaviours registered in code with no tile in the behaviors mirror, and mirror notes citing a source path that no longer exists. Findings print as JSON for a parked session AND ride the agent-progress op onto the orchestrator\'s own bee, so repo drift shows up in the same place as a stalled ask.\n\nsource: scripts/bridge/orchestrator-sweep.cjs'],
]

const ORCHESTRATOR_NOTE =
  'The orchestrator — one behaviour whose whole job is that nothing goes wrong quietly.\n\n'
  + 'Background work fails silently: an ask sits pending because nothing is bridged, a routine claims a tile and never reports again, two passes fight over the same tile, something fails at 3am and nobody sees the toast. The orchestrator sweeps for exactly those shapes and says so — in the hive (the agent registry) and in the repo (stray logs, behaviours with no mirror, notes citing files that are gone).\n\n'
  + 'It reports, it never intervenes. Making the state visible is the job; deciding what to do about it belongs to the participant.\n\n'
  + 'source: hypercomb-essentials/src/diamondcoreprocessor.com/assistant/orchestrator.drone.ts'

const AGENTS_NOTE =
  'Agents — see what is working in the hive, and talk to it.\n\n'
  + 'Every unit of AI work in flight is drawn as a bee over the tiles it is working on: a queued /opus ask, a routine that announced itself, an install or sync pass. Click the bee and the request opens — what was asked, where the answer will land, what it is doing right now — and you can add more context while it works.\n\n'
  + 'Each behaviour has its OWN avatar type. Decorate it if you want a particular look; if you do not, the behaviour still gets a distinct bee derived from its name.\n\n'
  + 'source: hypercomb-essentials/src/diamondcoreprocessor.com/assistant/agent-registry.service.ts'

async function main() {
  // Preflight: confirm we are talking to the hive that holds the mirror.
  const before = await must({ op: 'layer-at', segments: ASSISTANT }, 'layer-at behaviors/assistant')
  const existing = await must({ op: 'inflate', segments: ASSISTANT }, 'inflate behaviors/assistant')
  const names = (existing.data?.children ?? []).map(c => c.name)
  if (names.length === 0) throw new Error('behaviors/assistant has no children — wrong renderer?')
  console.log('[mirror] existing assistant behaviours:', names.join(', '))

  // 1. Union both behaviours into the collection — one atomic root update,
  //    existing children first so the tile order does not move.
  const children = [...names]
  for (const add of ['agents', 'orchestrator']) if (!children.includes(add)) children.push(add)
  await must({ op: 'update', segments: ASSISTANT, layer: { children } }, 'update behaviors/assistant')

  // 2. The parts, 1:1 with the source files.
  await must({ op: 'update', segments: AGENTS, layer: { children: PARTS.map(p => p[0]) } }, 'update agents children')
  await must({ op: 'update', segments: ORCHESTRATOR, layer: { children: ORCHESTRATOR_PARTS.map(p => p[0]) } }, 'update orchestrator children')

  // 3. Pheromones: collection membership + what it is.
  for (const segments of [AGENTS, ORCHESTRATOR]) {
    for (const name of ['assistant', 'behavior']) {
      await must({
        op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name },
      }, `tag ${name}`)
    }
  }

  // 4. Notes. note-add is NOT idempotent — only write when the cell has none.
  const noted = await send({ op: 'note-list', segments: AGENTS })
  const already = Array.isArray(noted.data) ? noted.data.length : (noted.data?.notes?.length ?? 0)
  if (!already) {
    await must({ op: 'note-add', segments: ASSISTANT, cell: 'agents', text: AGENTS_NOTE }, 'note agents')
  } else {
    console.log('[mirror] agents already has notes — left alone')
  }

  const orchNoted = await send({ op: 'note-list', segments: ORCHESTRATOR })
  const orchCount = Array.isArray(orchNoted.data) ? orchNoted.data.length : (orchNoted.data?.notes?.length ?? 0)
  if (!orchCount) {
    await must({ op: 'note-add', segments: ASSISTANT, cell: 'orchestrator', text: ORCHESTRATOR_NOTE }, 'note orchestrator')
  } else {
    console.log('[mirror] orchestrator already has notes — left alone')
  }

  for (const [parent, parts] of [[AGENTS, PARTS], [ORCHESTRATOR, ORCHESTRATOR_PARTS]]) {
    for (const [cell, note] of parts) {
      const has = await send({ op: 'note-list', segments: [...parent, cell] })
      const count = Array.isArray(has.data) ? has.data.length : (has.data?.notes?.length ?? 0)
      if (count) { console.log(`[mirror] ${cell} already noted`); continue }
      await must({ op: 'note-add', segments: parent, cell, text: note }, `note ${cell}`)
    }
  }

  // 5. Verify with fresh path-addressed reads (never inflate — parent child
  //    sigs are stale hints under per-page history).
  for (const [parent, parts] of [[AGENTS, PARTS], [ORCHESTRATOR, ORCHESTRATOR_PARTS]]) {
    const check = await must({ op: 'layer-at', segments: parent }, `verify ${parent.join('/')}`)
    console.log(`[mirror] ${parent[parent.length - 1]} layer children:`, (check.data?.children ?? []).length)
    for (const [cell] of parts) {
      const part = await send({ op: 'layer-at', segments: [...parent, cell] })
      const notes = await send({ op: 'note-list', segments: [...parent, cell] })
      const n = Array.isArray(notes.data) ? notes.data.length : (notes.data?.notes?.length ?? 0)
      console.log(`[mirror] ${cell}: layer=${part.ok ? 'ok' : part.error} notes=${n}`)
    }
  }
  console.log('[mirror] done. before-head was', JSON.stringify(before.data).slice(0, 120))
}

main().catch(err => { console.error('[mirror] FAILED:', err.message); process.exit(1) })
