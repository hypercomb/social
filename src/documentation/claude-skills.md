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

### community-skills — the ecosystem's top 100 (`mirror-community-skills.cjs`)
There are thousands of published skills; the mirror carries the ~100 the
ecosystem itself ranks highest — by stars (superpowers ~94K, karpathy-guard
~144K), installs (frontend-design 277K+, code-reviewer #1 on Agensi), author
credibility (Trail of Bits, Expo, Anthropic official) and singular capability
(skill-seekers, loki-mode, tapestry). Ten domain collections:

| domain | headline skills |
|---|---|
| `engineering-method` | superpowers, karpathy-guard, TDD, subagent-driven-development, get-shit-done |
| `code-workflow` | code-reviewer, git-commit-writer, pr-description-writer, changelog-generator |
| `design-frontend` | frontend-design, web-artifacts-builder, ui-ux-pro-max, shadcn-ui, d3js |
| `testing-automation` | playwright-automation, webapp-testing, ios-simulator, expo-skills |
| `security` | trail-of-bits-security, ffuf-web-fuzzing, threat-hunting-sigma |
| `research-data` | deep-research, recursive-research, tapestry, postgres-readonly |
| `content-seo` | claude-seo, humanize-writing, content-research-writer, building-blog |
| `business-ops` | lead-research-assistant, brand-build-library, competitive-ads-extractor |
| `media-creative` | imagen-generation, image-enhancer, pixelbin-media, slack-gif-creator |
| `integration-orchestration` | composio-connect (1000+ apps), mcp-builder, skill-seekers, loki-mode, n8n |

Curated 2026-07-31 from: [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills),
[travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills),
the MCP Market skills leaderboard, Agensi marketplace install counts, and
claudeskills.info rankings. Re-curate by editing the arrays in the script and
re-running (idempotent).

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
