# Claude Skills — census and the lazy-load contract

Censused 2026-07-31. Mirror: `behaviors/assistant/skills` (built by
`scripts/mirror-claude-skills.cjs`, extends the behaviors mirror — never
re-run mirror-behaviors).

A **skill** is the unit of *taught* behaviour: a `SKILL.md` instruction file
with a trigger description, loaded into a Claude session only when its
situation matches. Skills are to sessions what drones are to the hive —
packaged, addressable, interchangeable capability.

## The three origins (three collections in the mirror)

### hive-skills — this repo's own (`.claude/skills/`)
Every one of them drives the hive through the Claude Bridge (`ws://localhost:2401`):

| skill | what it does |
|---|---|
| `bridge-listen` | Park a session on the broker; answer `kind:'ask'` optimizations as notes on target tiles |
| `feedback-loop` | One cycle: feedback inbox → tile-linked questions → drain answers → meaning-loop steps → notes-digest re-feed |
| `tutor-build` | Subtree → study deck JSON in the `tutor` slot + `visual:tutor:deck` decoration |
| `website-build` | Cells decorated `visual:website:page/:pending` → standalone HTML pages via put-resource |

### anthropic-skills — bundled with the Claude app
Document formats (`docx`, `pdf`, `pptx`, `xlsx`), visual craft (`dataviz`,
`artifact-design`, `artifact-capabilities`, `algorithmic-art`),
self-maintenance (`skill-creator`, `consolidate-memory`, `morning`,
`schedule`, `setup-cowork`).

### harness-skills — built into Claude Code
Recurring execution (`loop`), app driving (`run`), review passes (`review`,
`security-review`, `simplify`), harness config (`update-config`,
`keybindings-help`, `fewer-permission-prompts`), reference (`claude-api`),
scaffolding (`init`), plugin `automation-recommender`.

## The lazy-load contract (Claude Bridge incorporation)

The mirror tiles hold **name + trigger + source — never the instructions**.
Nothing is preloaded into any session. The dispatch shape:

1. An ask (or feedback item, or routine trigger) arrives over the bridge.
2. The router — a parked `bridge-listen` session, or the feedback-loop cycle —
   matches it against the skill census: the tile *descriptions* are the
   routing table ("build a website" → `website-build`, "make this studyable"
   → `tutor-build`, "every 3 hours" → `loop` + `feedback-loop`).
3. The answering session imports **that one skill at that moment** — by its
   invocation name through the Skill tool, or by reading the `SKILL.md` at
   the tile's source path — runs it inside the workflow, and drops it.

The tile is the address; the skill stays on disk until chosen. This is the
same principle as signature-addressed modules: lightweight pointers,
expansion strictly on demand. A new skill joins the system by adding one
tile to the census — no dispatcher code changes.

## Extending the census

Add the skill to the appropriate array in
`scripts/mirror-claude-skills.cjs` and re-run it (idempotent: children
union, notes only written where absent). New skills for the hive itself go
in `.claude/skills/<name>/SKILL.md` — write the trigger description
carefully; it is both Claude's activation matcher and the bridge's routing
entry.
