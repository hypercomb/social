// Mirror pass for the ORCHESTRATOR CONSOLE + per-model bee branding.
//
// EXTENDS the agents/orchestrator mirror laid down by scripts/mirror-agents.cjs
// — it never re-runs it. Children are UNIONED with whatever is already there,
// notes are only written when the cell has no note with the same first line,
// and every new part tile gets the declared `part` keyword. Running it twice
// changes nothing.
//
// What this pass adds:
//
//   agents/agent-livery              bees are NAMED on screen
//   orchestrator/orchestrator-report the panel that answers "how is it going?"
//   orchestrator/orchestrator-audit  every worked tile gathered into one view
//   orchestrator/orchestrator-carry  go and look, then complete it
//   orchestrator/orchestrator-commentary  it generalizes, on its own clock
//
// and adds a note to the three tiles whose MEANING changed underneath them:
// agent-model (branding is now three steps), agent-bee (it perches, and it is
// named), agent-panel (you can step into any agent's log and come back).

const WebSocket = require('ws')
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
const DRY = process.argv.includes('--dry')

let counter = 0
function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { try { ws.close() } catch {} ; reject(new Error('bridge timeout')) }, 60_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `mirror-console-${Date.now()}-${++counter}` })))
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

const log = (...a) => console.log('[mirror]', ...a)

const ASSISTANT = ['behaviors', 'assistant']
const AGENTS = [...ASSISTANT, 'agents']
const ORCHESTRATOR = [...ASSISTANT, 'orchestrator']
const PART_KEYWORD = 'part'

/** Child NAMES of a layer. The root of a drained hive has no named
 *  directories, so `list-at` cannot answer this — resolve each child sig. */
async function childNamesOf(segments) {
  const layer = await send({ op: 'layer-at', segments })
  if (!layer.ok) return []
  const sigs = Array.isArray(layer.data && layer.data.children) ? layer.data.children.map(String) : []
  const names = []
  for (const sig of sigs) {
    const res = await send({ op: 'get-resource', sig })
    if (!res.ok) continue
    try {
      const name = JSON.parse(res.data.text).name
      if (typeof name === 'string' && name.trim()) names.push(name.trim())
    } catch { /* not a layer */ }
  }
  return names
}

async function noteFirstLines(segments) {
  const res = await send({ op: 'note-list', segments })
  const data = res.ok ? res.data : []
  const items = Array.isArray(data) ? data : (Array.isArray(data && data.notes) ? data.notes : [])
  return items.map(n => String((n && n.text) || '').split('\n')[0].trim())
}

/** Union new children in, keeping the existing order so no tile moves. */
async function ensureChildren(segments, wanted) {
  const have = await childNamesOf(segments)
  const missing = wanted.filter(n => !have.includes(n))
  if (!missing.length) { log(`= /${segments.join('/')} — all ${wanted.length} already present`); return have }
  if (DRY) { log(`+ /${segments.join('/')} would add ${missing.join(', ')}`); return have }
  await must({ op: 'update', segments, layer: { children: [...have, ...missing] } }, `update ${segments.join('/')}`)
  log(`+ /${segments.join('/')} ← ${missing.join(', ')}`)
  return [...have, ...missing]
}

/** note-add is NOT idempotent, so match on the note's first line. */
async function ensureNote(parent, cell, text) {
  const first = text.split('\n')[0].trim()
  const seen = await noteFirstLines([...parent, cell])
  if (seen.includes(first)) { log(`= ${cell} already carries "${first.slice(0, 44)}…"`); return false }
  if (DRY) { log(`+ ${cell} would get "${first.slice(0, 44)}…"`); return true }
  await must({ op: 'note-add', segments: parent, cell, text }, `note ${cell}`)
  log(`+ ${cell} noted`)
  return true
}

async function markPart(segments) {
  if (DRY) return
  await must(
    { op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name: PART_KEYWORD } },
    `mark part ${segments.join('/')}`,
  )
}

// ── the new parts, 1:1 with what they are ────────────────────────────

const AGENT_PARTS = [
  ['agent-livery',
    'A bee wears its name. The model or behaviour name is baked onto the abdomen in the same atlas bake as the drawing, sized to a fixed width so it never overflows the body — and a name plate rides beside the bee at its dance CENTRE rather than on the bee itself, because a caption riding a figure-8 cannot be read. Before this, hovering was the only way to know which bee was which.\n\n'
    + 'source: hypercomb-essentials/src/diamondcoreprocessor.com/presentation/avatars/bee-ab-atlas.ts (liverySvg) + presentation/avatars/agent-bee.drone.ts'],
]

const ORCHESTRATOR_PARTS = [
  ['orchestrator-report',
    'The panel you get when you press the orchestrator — a report, not a request. A headline that answers "is everything going smoothly?", the counts under it, which vendors are running, and RUNNING NOW: one row per live agent showing the last thing it actually said. Each row opens that agent\'s own log and comes back; the ◎ beside it flies to the layer that agent\'s bee is dancing on.\n\n'
    + 'Three destinations that are deliberately different: a finding goes INTO the tile, ◎ goes to the tile\'s PARENT layer (a bee flies over its tile, so the parent is where you can see it), and the tiles list enters the tile.\n\n'
    + 'Stepping into a log must not close the panel — closing puts the perched bee down and clears the audit view, so a naive swap would destroy the audit you were reading.\n\n'
    + 'source: hypercomb-essentials/src/diamondcoreprocessor.com/assistant/agent-panel.view.ts'],
  ['orchestrator-audit',
    'Every tile that has an agent on it, gathered into one view from wherever in the hive those tiles actually live, so the whole of what is running can be walked from one place. Pressing the orchestrator does three things at once: it perches top-left out of the way, it gathers this set, and it opens its report.\n\n'
    + 'Transient by construction — nothing is committed, no layer and no lineage, and it clears the moment you enter one of the tiles, which is the point: the click takes you to the real work. Gathered rows keep their absolute path, so entering one travels to the tile\'s real home rather than a copy.\n\n'
    + 'source: hypercomb-essentials/src/diamondcoreprocessor.com/assistant/orchestrator.drone.ts (audit) + presentation/tiles/show-cell.drone.ts (render:gather-set)'],
  ['orchestrator-carry',
    'A finding you cannot act on is just a complaint. Press GO on one and the hive travels to where the trouble is, carrying that finding with it; when you arrive, COMPLETE IT is waiting, and it acts on the hive — on an overlap it keeps the agent still reporting and stops the rest, on a failure it stops the agents the finding names.\n\n'
    + 'What is carried across the trip is the finding\'s KEY, never the object: every sweep rebuilds them all. Each finding also remembers WHERE to go, captured when it was raised — by the time somebody presses the button, the agent that explained where it belongs may already be retired.\n\n'
    + 'This does not break "it reports, it never intervenes". That rule bans acting ON A TIMER — retiring somebody\'s request because a heuristic ran out of patience. A participant who walked to the tile and pressed the button has made a decision the orchestrator is not entitled to make alone.\n\n'
    + 'source: hypercomb-essentials/src/diamondcoreprocessor.com/assistant/orchestrator.drone.ts (hold / held / release / complete)'],
  ['orchestrator-commentary',
    'The orchestrator says, in its own words, what has been going on — a generalization over the findings and over what has changed since it last spoke, so its log reads as a narrative you can scroll back through instead of a pile of alerts. It diffs against what it saw last time ("since last: 2 finished, 1 started") and names the QUIETEST agent, because a count cannot tell you which one is drifting.\n\n'
    + 'Two clocks, because both failure modes are real: it speaks at most every 3 minutes when something has CHANGED, and still speaks every 12 minutes when nothing has — a hive stuck quietly for an hour has to say so out loud.\n\n'
    + 'The all-clear is said once per state for the same reason. Emitted every sweep it appended an identical line every 15 seconds, and since the log keeps only the last 40 entries, ten quiet minutes evicted every finding and every summary from it. A watcher that floods its own log has destroyed the record it exists to keep.\n\n'
    + 'source: hypercomb-essentials/src/diamondcoreprocessor.com/assistant/orchestrator.drone.ts (#summarize)'],
]

// ── notes for tiles whose meaning changed underneath them ────────────

const AMENDMENTS = [
  [AGENTS, 'agent-model',
    'Every model is its own brand — branding is three steps, not two.\n\n'
    + 'VENDOR decides the colour family, TIER shades within it, and now MODEL carries its own accent inside that shade: a few degrees of hue, its own saturation, its own wing tint. The third step had to exist because the first two gave a vendor only three appearances to share among all its models, so same-weight siblings collided — sonnet and fable are both "balanced" and came out byte-identical.\n\n'
    + 'The accent is the SMALLEST of the three effects and is bounded so it can never overrule the other two: hue moves at most 4°, when the two closest vendor families are 23.6° apart; lightness moves a fraction of a tier step, so an accent can never make a deep model read as balanced. The wing swings furthest, because a wing carries no family meaning and is the largest area on the bee.\n\n'
    + 'The accent is derived from the model\'s own name, so a model that ships tomorrow gets its own look with no catalog to maintain — but a plain string hash is not enough: it moves by the size of the edit, so o1 and o3 rounded to the same bee. Names differ by one character constantly (grok-2/grok-4, gemini-1.5/gemini-2.5), so one input bit has to change every output bit.\n\n'
    + 'source: hypercomb-essentials/src/diamondcoreprocessor.com/presentation/avatars/agent-model.ts'],
  [AGENTS, 'agent-bee',
    'A bee can PERCH, and a bee is named.\n\n'
    + 'Pressing the orchestrator takes it out of the hive and parks it top-left, on every layer, held against a screen-space corner that is re-resolved as you pan and zoom — it has stopped working over a tile and started watching all of them. Pressing it again, or closing its panel, puts it back down.\n\n'
    + 'The bee drone must reach the orchestrator through IoC, never by importing it: a value import inlines the whole drone into the bee bundle and mints a second registration of it.\n\n'
    + 'source: hypercomb-essentials/src/diamondcoreprocessor.com/presentation/avatars/agent-bee.drone.ts'],
  [AGENTS, 'agent-panel',
    'The panel can change its subject without closing.\n\n'
    + 'From the orchestrator\'s report you can step into any agent\'s own log and come back with the ‹ button. That swap is guarded: closing the panel announces itself, and that announcement is what puts a perched bee down and clears the gathered audit view — so a swap that closed and reopened would destroy the audit you were halfway through reading.\n\n'
    + 'source: hypercomb-essentials/src/diamondcoreprocessor.com/assistant/agent-panel.view.ts'],
]

async function main() {
  // Preflight: the mirror this pass EXTENDS has to already be here. If it is
  // not, we are pointed at the wrong hive and must not write anything.
  const assistant = await childNamesOf(ASSISTANT)
  if (!assistant.includes('agents') || !assistant.includes('orchestrator')) {
    throw new Error(`behaviors/assistant has no agents/orchestrator mirror to extend (saw: ${assistant.join(', ') || 'nothing'}) — wrong renderer?`)
  }
  log('extending behaviors/assistant —', assistant.join(', '))

  await ensureChildren(AGENTS, AGENT_PARTS.map(p => p[0]))
  await ensureChildren(ORCHESTRATOR, ORCHESTRATOR_PARTS.map(p => p[0]))

  for (const [parent, parts] of [[AGENTS, AGENT_PARTS], [ORCHESTRATOR, ORCHESTRATOR_PARTS]]) {
    for (const [cell, note] of parts) {
      await ensureNote(parent, cell, note)
      await markPart([...parent, cell])
    }
  }

  for (const [parent, cell, note] of AMENDMENTS) await ensureNote(parent, cell, note)

  // The parts laid down by the ORIGINAL agents pass were never marked — only
  // the two collections were tagged. Half a collection carrying the mark is
  // worse than none of it: render and behaviour resolve from the mark, so an
  // unmarked part is invisible to everything that reads it. Marking is
  // additive and content-addressed, so re-marking an already-marked tile is a
  // no-op.
  for (const parent of [AGENTS, ORCHESTRATOR]) {
    for (const cell of await childNamesOf(parent)) await markPart([...parent, cell])
  }
  if (!DRY) log('every part in both collections now carries the `part` keyword')

  // Verify with fresh path-addressed reads — a parent's child sigs are stale
  // hints under per-page history, so never trust inflate for this.
  log('── verify ──')
  for (const [parent, parts] of [[AGENTS, AGENT_PARTS], [ORCHESTRATOR, ORCHESTRATOR_PARTS]]) {
    const children = await childNamesOf(parent)
    log(`/${parent.join('/')} → ${children.length} children: ${children.join(', ')}`)
    for (const [cell] of parts) {
      const layer = await send({ op: 'layer-at', segments: [...parent, cell] })
      const notes = await noteFirstLines([...parent, cell])
      log(`  ${cell}: layer=${layer.ok ? 'ok' : layer.error} notes=${notes.length}`)
    }
  }
  for (const [parent, cell] of AMENDMENTS) {
    log(`  ${cell}: notes=${(await noteFirstLines([...parent, cell])).length}`)
  }
  log(DRY ? 'dry run — nothing written' : 'done')
}

main().catch(e => { console.error('[mirror] FAILED:', e.message); process.exit(1) })
