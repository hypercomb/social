// Mirror pass for the CLAUDE SKILLS census — behaviors/assistant/skills.
// Extends the existing behaviors mirror (like mirror-agents.cjs); never re-runs it.
//
// A skill is a packaged instruction set a Claude session can invoke. Three
// origins, three group cells, each skill a tile 1:1 with its source:
//   hive-skills      — this repo's .claude/skills (drive the hive over the bridge)
//   anthropic-skills — bundled with the Claude app (documents, viz, memory, art)
//   harness-skills   — built into Claude Code (workflow, review, config, scheduling)

const WebSocket = require('ws')
const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'

let counter = 0
function send(req) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BRIDGE)
    const t = setTimeout(() => { try { ws.close() } catch {} ; reject(new Error('bridge timeout')) }, 180_000)
    ws.on('open', () => ws.send(JSON.stringify({ ...req, id: `mirror-skills-${Date.now()}-${++counter}` })))
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
const SKILLS = [...ASSISTANT, 'skills']

const HIVE = [
  ['bridge-listen',
    'Parks a Claude Code session on the bridge as the hive\'s deep immediate tier. A persistent watcher polls the broker; each new kind:\'ask\' optimization (minted by the ASK SCREEN that /opus, /sonnet, /haiku open) wakes the session, which answers as a NOTE on the target tile(s) and retires the ask.\n\nsource: .claude/skills/bridge-listen/SKILL.md'],
  ['feedback-loop',
    'One cycle of the self-feeding loop: reads the host\'s feedback inbox (kind:\'feedback\'), turns items into tile-linked questions; drains answered questions (kind:\'qa-answer\') into notes or EXECUTES creation work on the hive; runs the meaning-loop steps (transcript ingest, pheromone sweep, ai:meta); re-feeds a notes-digest into new questions.\n\nsource: .claude/skills/feedback-loop/SKILL.md'],
  ['tutor-build',
    'Turns a hive subtree into a study deck. Walks cells, reads notes + tags + children, mints recall items (prompt/answer/hint), writes one deck JSON into the scope cell\'s tutor slot plus a visual:tutor:deck decoration so the study toggle appears. Ambiguities route to the feedback window as Q&A.\n\nsource: .claude/skills/tutor-build/SKILL.md'],
  ['website-build',
    'Turns cells into embedded website pages, 1:1 — the cell\'s lineage path IS the route. Finds visual:website:page / :pending decorations, gathers each cell\'s notes and attachments, generates one standalone HTML document per cell, writes it back with put-resource + decoration-add (replaceKind).\n\nsource: .claude/skills/website-build/SKILL.md'],
]

const ANTHROPIC = [
  ['docx', 'Create, read, edit Word documents and templates — headings, tables of contents, tracked changes, find-and-replace, images.\n\nsource: Anthropic bundled skill (anthropic-skills:docx)'],
  ['pdf', 'Everything PDF: read/extract text and tables, merge, split, rotate, watermark, fill forms, encrypt, OCR scanned pages.\n\nsource: Anthropic bundled skill (anthropic-skills:pdf)'],
  ['pptx', 'Slide decks and presentations — create, parse, edit, combine, split .pptx/.potx, layouts, speaker notes.\n\nsource: Anthropic bundled skill (anthropic-skills:pptx)'],
  ['xlsx', 'Spreadsheets as primary input or output — open, fix, chart, clean messy tabular data, convert between formats.\n\nsource: Anthropic bundled skill (anthropic-skills:xlsx)'],
  ['dataviz', 'Design-system method for every chart, graph, dashboard or stat tile — form heuristic, colour formula with validator, mark specs, interaction rules. Read before writing the first line of chart code.\n\nsource: Anthropic bundled skill (dataviz)'],
  ['artifact-design', 'Design guidance and fundamentals for published Artifact pages — calibrates how much design investment a page warrants.\n\nsource: Anthropic bundled skill (artifact-design)'],
  ['artifact-capabilities', 'The runtime powers a published Artifact can be granted — live data, shared state across viewers, self-updating pages — with the typed call definitions.\n\nsource: Anthropic bundled skill (artifact-capabilities)'],
  ['skill-creator', 'Makes more skills: create from scratch, edit, run evals, benchmark performance, optimize a skill\'s trigger description.\n\nsource: Anthropic bundled skill (anthropic-skills:skill-creator)'],
  ['algorithmic-art', 'Generative art with p5.js — seeded randomness, flow fields, particle systems, interactive parameter exploration.\n\nsource: Anthropic bundled skill (anthropic-skills:algorithmic-art)'],
  ['consolidate-memory', 'Reflective pass over the session\'s persistent memory files — merge duplicates, fix stale facts, prune the index.\n\nsource: Anthropic bundled skill (anthropic-skills:consolidate-memory)'],
  ['morning', 'Renders the user\'s morning brief as a styled HTML artifact, or sets it up as a recurring weekday task.\n\nsource: Anthropic bundled skill (anthropic-skills:morning)'],
  ['schedule', 'Scheduling in two flavours: recurring/one-time scheduled tasks, and scheduled cloud agents (routines) on a cron.\n\nsource: Anthropic bundled skills (anthropic-skills:schedule + schedule)'],
  ['setup-cowork', 'Guided Cowork setup — install role-matched plugins, connect tools, try a first skill.\n\nsource: Anthropic bundled skill (anthropic-skills:setup-cowork)'],
]

const HARNESS = [
  ['loop', 'Runs a prompt or slash command on a recurring interval, or lets the model self-pace with scheduled wakeups — the primitive behind "run the feedback loop every 3 hours".\n\nsource: Claude Code built-in (/loop)'],
  ['run', 'Launches and drives this project\'s app to see a change actually working — prefers a project skill that covers launching, falls back to per-project patterns.\n\nsource: Claude Code built-in (/run)'],
  ['init', 'Initializes a CLAUDE.md with codebase documentation — the file that teaches every future session this repo\'s doctrine.\n\nsource: Claude Code built-in (/init)'],
  ['review', 'Reviews a GitHub pull request; /code-review covers the working diff, and /code-review ultra fans a multi-agent cloud review over the branch.\n\nsource: Claude Code built-in (/review, /code-review)'],
  ['security-review', 'Complete security review of the pending changes on the current branch.\n\nsource: Claude Code built-in (/security-review)'],
  ['simplify', 'Reviews changed code for reuse, simplification, efficiency and altitude cleanups, then applies the fixes. Quality only — not a bug hunt.\n\nsource: Claude Code built-in (/simplify)'],
  ['claude-api', 'Reference for the Claude API / Anthropic SDK — model ids, pricing, params, streaming, tool use, MCP, caching. Read before answering anything LLM-shaped from memory.\n\nsource: Claude Code built-in (claude-api)'],
  ['update-config', 'Configures the Claude Code harness via settings.json — hooks, permissions, env vars. Automated "whenever X happens" behaviours live here, not in memory.\n\nsource: Claude Code built-in (update-config)'],
  ['keybindings-help', 'Customizes keyboard shortcuts, chord bindings, ~/.claude/keybindings.json.\n\nsource: Claude Code built-in (keybindings-help)'],
  ['fewer-permission-prompts', 'Scans transcripts for common read-only calls and adds a prioritized allowlist to project settings.\n\nsource: Claude Code built-in (fewer-permission-prompts)'],
  ['automation-recommender', 'Analyzes a codebase and recommends Claude Code automations — hooks, subagents, skills, plugins, MCP servers.\n\nsource: plugin claude-code-setup:claude-automation-recommender'],
]

const GROUPS = [
  ['hive-skills', HIVE,
    'The four skills this repo teaches a Claude session — and every one of them drives the hive through the Claude Bridge (ws://localhost:2401). They are the existing bridge algorithm in packaged form: listen (bridge-listen), loop (feedback-loop), and two generators that write back into cells (tutor-build, website-build).\n\nsource: .claude/skills/'],
  ['anthropic-skills', ANTHROPIC,
    'Skills bundled with the Claude app — document formats (docx/pdf/pptx/xlsx), visual craft (dataviz, artifact design + capabilities, algorithmic art), and self-maintenance (skill-creator, consolidate-memory, morning, schedule, setup-cowork). Capabilities any session brings to the hive for free.\n\nsource: Anthropic app bundle'],
  ['harness-skills', HARNESS,
    'Skills built into Claude Code itself — the workshop the assistant works in: recurring execution (loop), running the app (run), review passes (review, security-review, simplify), harness configuration (update-config, keybindings, permissions), and the API reference (claude-api).\n\nsource: Claude Code built-ins'],
]

const SKILLS_NOTE =
  'Skills — the packaged instruction sets a Claude session can invoke, censused 2026-07-31.\n\n'
  + 'A skill is the unit of TAUGHT behaviour: a markdown instruction file (SKILL.md) with a trigger description, loaded into a session the moment its situation matches. Three origins live here as three collections: hive-skills (this repo\'s own — all of them bridge drivers), anthropic-skills (bundled with the app), harness-skills (built into Claude Code).\n\n'
  + 'Why they are mirrored: the Claude Bridge algorithm dispatches work to sessions, and skills are what a session can DO. A bridge that knows the skill census can route an ask to the right packaged behaviour — "build a website" → website-build, "make this studyable" → tutor-build, "every 3 hours" → loop + feedback-loop — instead of re-explaining the task each time.\n\n'
  + 'LAZY LOAD is the contract: these tiles hold NAME + TRIGGER + SOURCE, never the instructions themselves. Nothing is preloaded into any session. When the bridge (or a parked bridge-listen session) matches an ask to a tile, the session imports that one skill at that moment — by its invocation name through the Skill tool, or by reading the SKILL.md at the tile\'s source path — runs it inside the workflow, and drops it. The tile is the address; the skill stays on disk until chosen.\n\n'
  + 'source: src/documentation/claude-skills.md'

async function main() {
  const before = await must({ op: 'layer-at', segments: ASSISTANT }, 'layer-at behaviors/assistant')
  const existing = await must({ op: 'inflate', segments: ASSISTANT }, 'inflate behaviors/assistant')
  const names = (existing.data?.children ?? []).map(c => c.name)
  if (names.length === 0) throw new Error('behaviors/assistant has no children — wrong renderer?')
  console.log('[mirror] existing assistant behaviours:', names.join(', '))

  // 1. Union `skills` into the assistant collection.
  const children = [...names]
  if (!children.includes('skills')) children.push('skills')
  await must({ op: 'update', segments: ASSISTANT, layer: { children } }, 'update behaviors/assistant')

  // 2. The three groups, then each group's skills 1:1 with sources.
  await must({ op: 'update', segments: SKILLS, layer: { children: GROUPS.map(g => g[0]) } }, 'update skills children')
  for (const [group, parts] of GROUPS) {
    await must({ op: 'update', segments: [...SKILLS, group], layer: { children: parts.map(p => p[0]) } }, `update ${group} children`)
  }

  // 3. Pheromones on the collections.
  for (const segments of [SKILLS, ...GROUPS.map(g => [...SKILLS, g[0]])]) {
    for (const name of ['assistant', 'skill']) {
      await must({ op: 'decoration-add', segments, kind: 'tag', appliesTo: [], payload: { name } }, `tag ${name}`)
    }
  }

  // 4. Notes — note-add is NOT idempotent; only write where none exist.
  const noteIfEmpty = async (parentSegments, cell, text, label) => {
    const has = await send({ op: 'note-list', segments: [...parentSegments, cell] })
    const count = Array.isArray(has.data) ? has.data.length : (has.data?.notes?.length ?? 0)
    if (count) { console.log(`[mirror] ${label} already noted`); return }
    await must({ op: 'note-add', segments: parentSegments, cell, text }, `note ${label}`)
  }

  await noteIfEmpty(ASSISTANT, 'skills', SKILLS_NOTE, 'skills')
  for (const [group, parts, groupNote] of GROUPS) {
    await noteIfEmpty(SKILLS, group, groupNote, group)
    for (const [cell, note] of parts) {
      await noteIfEmpty([...SKILLS, group], cell, note, `${group}/${cell}`)
    }
  }

  // 5. Verify with fresh path-addressed reads.
  for (const [group, parts] of GROUPS) {
    const check = await must({ op: 'layer-at', segments: [...SKILLS, group] }, `verify ${group}`)
    console.log(`[mirror] ${group} children:`, (check.data?.children ?? []).length)
    for (const [cell] of parts) {
      const part = await send({ op: 'layer-at', segments: [...SKILLS, group, cell] })
      const notes = await send({ op: 'note-list', segments: [...SKILLS, group, cell] })
      const n = Array.isArray(notes.data) ? notes.data.length : (notes.data?.notes?.length ?? 0)
      console.log(`[mirror] ${group}/${cell}: layer=${part.ok ? 'ok' : part.error} notes=${n}`)
    }
  }
  // 6. ONE build revision for the whole pass (documentation/build-revisions.md).
  //    This pass stamps many anchors — the assistant collection, the skills
  //    cell, three group cells, ~30 skill cells, plus tags and notes — so the
  //    census is restorable as a single step rather than 40 loose commits.
  const rev = await send({ op: 'build-record', segments: SKILLS, label: 'claude skills census' })
  console.log(rev.ok
    ? `[mirror] build rev ${rev.data.label} seal=${String(rev.data.seal).slice(0, 12)}${rev.data.unchanged ? ' (unchanged)' : ''}`
    : `[mirror] build rev FAILED: ${rev.error}`)

  console.log('[mirror] done. before-head was', JSON.stringify(before.data).slice(0, 120))
}

main().catch(err => { console.error('[mirror] FAILED:', err.message); process.exit(1) })
