# The Meaning Loop — plan up, read down

**Status: PINNED direction (Jaime, 2026-07-20). Phase 1 live on the dev hive.**
Companions: `pheromones.md` (the signal substrate this borrows),
`signature-system.md` (expansion doctrine), `feedback-channel.md` +
`.claude/skills/feedback-loop/SKILL.md` (the routine that runs the loop).

## The habit, verbatim

> "We gotta get in the habit of using the tiles and the notes and the
> hierarchy and the pheromone tags to create meaning within the hive …
> first you build it up as a plan and then you read it down as a target
> and we continue this cycle in the areas that we want. …
> The pheromone becomes the discovery for AI work."

The hive is the memory. An AI session's private notes are scaffolding;
the durable context for any branch lives **on the branch itself** —
its hierarchy (structure), its notes (prose), its pheromones (intent),
and its meta chain (build history). Claude memory files may say *where*
to look; they must never be the only place *what was decided* lives.

## The cycle

```
 transcript / conversation / meeting
        │  put-resource → transcriptSig
        ▼
 PLAN UP   interpret → tiles + notes (+ pheromones for intent)
        │  write ai:meta on the branch (references transcriptSig, prevMetaSig)
        ▼
 …time passes; routine or session returns…
        ▼
 READ DOWN   layer-at branch → notes → pheromones → latest ai:meta
        │    → prevMeta chain = accurate context, no guessing
        ▼
 DISCOVER   pheromone sweep finds AI-work intent (jwize.com:website, …)
        │    and pending ai:request records
        ▼
 ASK        mint a dashboard question — never generate unasked
        ▼
 GENERATE   on an approving answer: hand off to a fresh session scoped
        │    to that node; results land as sig-addressed artifacts
        ▼
 write the next ai:meta  ──────────────►  (loop)
```

Every arrow is bridge ops on existing primitives. Nothing new is invented.

## The records (all signature-addressed)

### 1. `ai:meta` — the build meta, in the history

A decoration (kind `ai:meta`, `replaceKind: true`) on the branch's scope
cell. The payload is a **signature reference**, never inline content:

```jsonc
// decoration payload
{ "metaSig": "<sig of the meta resource>" }

// the meta resource itself (put-resource → metaSig)
{
  "v": 1,
  "target": "revolucion/journal",        // scope cell, inflate-normalized segments
  "at": 1789338000000,
  "pass": "lounge-gamification tiles",   // short label for this pass
  "did": ["…what this pass actually built…"],
  "contextSigs": ["<transcriptSig>", "…"],  // ANY sig can be handed in as context
  "pending": ["…work identified but not yet done…"],
  "prevMetaSig": "<sig of the previous meta resource> | null"
}
```

Two chains give "all that history" for free:
- **`prevMetaSig`** walks metas directly (fast path).
- The decoration rides the layer's decorations slot, so every meta update
  is a **history marker** on the cell's lineage — time-travel via markers
  reaches every meta ever written even if a chain link is lost.

Why a decoration (array-vs-folder table in `pheromones.md` applied): one
writer per hive (the author's routine), it travels with adoption — the
build context IS part of the gift ("here's how this branch was grown,
keep growing it"), and Jaime's one-question rule ("is this part of what
I'd hand over?") answers yes for a community-forkable branch.

### 2. Pheromone tags — intent, discoverable

**Today's pheromone = the tag decoration with a namespaced name.** The
pheromone spec already defines a classic tag as "the author's pheromone
with no decay", and the tags panel is already titled *Pheromones*. So
until the deposit-history pool (`sign('pheromones')`) is built, AI-work
intent is deposited as tags:

```
jwize.com:website      this branch is meant to be a website
jwize.com:deck         … a slide deck
jwize.com:game         … a game
jwize.com:tutor        … a study deck
jwize.com:3d           … a three.js space (e.g. the cigar lounge)
jwize.com:hold         negation/pause — do NOT propose work here
```

Grammar: `<authority-domain>:<intent>`. The colon namespaces exactly like
pool meanings do (and keeps names out of the bare-word collision space).
Plain unnamespaced tags stay what they are — human labels, never work
signals. The sweep reads ONLY namespaced names it recognizes; unknown
kinds are ignored, ambient, advisory (pheromone doctrine).

**Scope: pinned at the root, inherited by reading.** A pheromone on a
branch covers its subtree *logically* — child branches "become website
items" because the reader walks down, NOT because anything was stamped
down (APPLICATION SCOPE doctrine: never stamp descendants). Opt a child
out with `jwize.com:hold` on that child. Stamping children explicitly
remains a user choice at deposit time, never a requirement.

### 3. `ai:request` — an attached language-model request

A decoration (kind `ai:request`, `replaceKind: true`) on the node that
should be processed by an AI pass. Payload is a sig reference to:

```jsonc
{
  "v": 1,
  "target": "revolucion/journal/my-lounge",
  "request": "…one-paragraph statement of the work…",
  "contextSigs": ["<metaSig>", "<any other sig>"],
  "model": "claude",                  // advisory: whichever AI makes the most sense
  "status": "pending",                // pending → asked → approved → done | declined
  "askedQId": null,                   // set when the ask-gate question is minted
  "resultSigs": []                    // filled by the hand-off session
}
```

Status transitions are made by re-minting the resource and replacing the
decoration (`replaceKind`) — the old states remain reachable through the
cell's history markers. Append-only stays sacred.

## Read down (the bootstrap every session runs FIRST)

Before building in any area — given a path, or any sig handed in as
context:

1. `layer-at <segments>` — the cell's current layer (fresh, path-addressed).
2. `inflate <segments>` — child NAMES one level down (names are immutable).
3. `note-list <segments>` — the prose meaning.
4. Resolve the decorations slot (`get-resource` per sig): collect tags
   (pheromones), `ai:meta`, `ai:request`.
5. Follow `metaSig` → meta resource → `prevMetaSig` chain as deep as the
   task needs. `contextSigs` expand lazily — signatures stay pointers
   until you need them (expansion doctrine).
6. Only THEN plan the pass. The meta's `pending` list is the target.

## Plan up (what a pass writes back)

1. Tiles: merge-mode `update` — union existing children first, never
   replace membership (one clean tree, normalized names, notes carry prose).
2. Notes: `note-add` — NOT idempotent; guard with a sentinel cell/check.
3. Pheromones: deposit intent tags at the SCOPE cell only.
4. `ai:request` for work identified but deferred to a generation pass.
5. `ai:meta` LAST — it references everything above; write it only after
   read-backs verify the pass landed (`layer-at` + `note-list`).

## Discovery (the pheromone sweep)

A bounded walk (the routine caps depth/cells per cycle) that collects,
per scope cell: recognized intent pheromones + pending `ai:request`s.
For each finding:

- **Never generate.** Mint ONE dashboard question via the existing qa
  system: *"`revolucion` carries `jwize.com:website` — N child branches
  look like site items. Build/refresh pages here?"* Mark the request
  `asked` (with `askedQId`) so the sweep never re-asks.
- A pheromone with no creation need yet is FINE — it is meaning, not a
  work ticket. Only recognized intent kinds + explicit requests mint
  questions.
- `jwize.com:hold` anywhere on the path suppresses proposals below it.

## Overlap discovery — combinations → option tiles (Jaime, 2026-07-20)

Single namespaced pheromones are declared intent. **Overlapping plain
tags are emergent intent**: the human keywords you leave for yourself —
`family`, `photos`, `friends`, `business` — co-occur on a branch, and
the combination means something neither tag says alone (`family` +
`photos` → a photo gallery? a family photo website?).

- **A simple AI reads the overlap.** This is a categorical question, not
  generation — the sweep hands a cheap model (Haiku-class) the branch's
  tag set + child names and gets back zero or a few suggestions from a
  small vocabulary (gallery, website, deck, journal, tutor, game,
  business structure). The powerful engine is reserved for the hand-off.
- **Suggestions materialize as OPTION TILES** — real cells minted under
  the scope cell (first-class citizens, like everything else), each
  carrying: a note explaining *why* ("suggested: family + photos overlap
  here"), the `jwize.com:option` pheromone (visibly a proposal; the
  sweep skips option-marked cells and never re-proposes a seen
  combination), and an `ai:request` whose ask-gate question is the
  accept mechanic.
- **Three fates, all yours:** *discard* (remove the tile — normal remove
  flow), *leave it* (not sure yet — it sits there as ambient
  possibility, costing nothing), or *go ahead* (answer its question yes
  → the hand-off builds out the hive from there, e.g. introducing a
  website).
- Bounded like everything else: propose only on ≥2 overlapping tags with
  a sensible mapping, a handful per cycle, one mark-seen key per
  (scope, sorted-tag-set) so a combination is proposed once.

The pheromone vocabulary the sweep recognizes thus has three tiers:
explicit `ai:request` records, declared intent (`jwize.com:website` …),
and emergent overlap (plain-tag combinations → options). `jwize.com:option`
itself is a marker, never a build signal — an option generates nothing
until its question is answered.

### Capability-aware options (Jaime, 2026-07-20)

Suggestions are grounded in the hive's **installed behavior inventory**,
not a hardcoded vocabulary. The bridge op `behaviors-list` returns every
registered visual bee — `{view, slashCommand, decorationKind, adoptable}`
from the VisualBeeRegistry (e.g. `home, slides, website, tutor`) — and
the sweep reads it before interpreting overlaps:

- **Capability PRESENT** → a "build X here" option: family + photos and
  the hive has `website` → "photo website?" accept = hand-off uses that
  behavior.
- **Capability ABSENT** → a "look for X" option: the overlap wants a
  photo *gallery* and no gallery behavior is installed → the option tile
  proposes *finding/adopting* the external behavior the hive doesn't
  have. Accepting points at the adoption flow — it never auto-installs;
  adoption stays gated on the installer's own accept step, exactly as
  today.

Packages are thus the grammar of suggestions: each behavior package the
community ships widens what every hive can be offered, and the gap
between "what your tags want" and "what your hive can do" becomes a
discovery signal of its own.

## Generation (the hand-off)

When an approving `qa-answer` arrives (drained by the routine):

- **Do not process inline.** The routine's cycle stays small. Start a
  fresh session scoped to the node: `claude -p "<bootstrap>"` from the
  monorepo root, where the bootstrap names the target path + metaSig and
  instructs the session to READ DOWN first (§above), do exactly the
  approved work through the bridge, write `resultSigs` + status `done`
  into the `ai:request`, and finish with a new `ai:meta`.
- Whichever AI makes the most sense: the `model` field is advisory; a
  different engine can be handed the same bootstrap — the contract is
  the records, not the engine.
- The routine records the hand-off (a note on the node) and moves on;
  it never waits for the child session.

## Passive behaviors (the paradigm shift, website first)

**Installing a behavior turns nothing on.** The behavior library is
passive — adopting `website` (or any view behavior) just makes the
capability present. The features window (Beehaviors) toggle deposits /
removes the intent pheromone on the current scope cell — that is ALL it
does. Discovery + ask + generation happen only through AI passes.

- No behavior "looks for stuff" on its own anymore. `visual:website:page`
  decorations remain the generated ARTIFACTS (the render path is
  unchanged); the pheromone is the INTENT that explains and precedes them.
- Migration: every existing site scope root gets `jwize.com:website`
  deposited once, so old sites are discoverable under the new model
  (done for the verified dev-hive site roots in Phase 1).
- Every future behavior follows the same shape: a pheromone kind, a
  sweep rule, an ask template, a generation skill. "Turning it on" is
  always a deposit, never an action.

## Routine integration

The 3-hour `feedback-loop` routine gains three steps (see SKILL.md):
transcript inbox ingestion (plan-up with ask-gates), the pheromone
discovery sweep (bounded, question-minting), and the meta write at the
end of any pass that changed a branch. The loop's existing safeguards
apply unchanged: untrusted-text scrub, execution authority = the host's
dashboard answers ONLY, creation-scoped bridge activity, bounded per
cycle, read-back never eyeballs.

## Safeguards

- **Ask before creating. Always.** A pheromone is never authorization;
  it is discoverable intent. Authorization is the host's qa-answer.
- **Idempotent by construction:** `replaceKind` decorations, sentinel-
  guarded notes, merge-mode updates, `asked` status stops re-asking.
- **Bounded:** the sweep and the ingest are capped per cycle; the loop
  converges, it does not spew.
- **Never wipe, never stamp down:** OPFS user data rules apply; scope
  pheromones live at roots; descendants inherit by reading.
- **The engine is replaceable; the records are the contract.**

## Rollout

- **Phase 1 (DONE 2026-07-20, dev hive):** record shapes in use — first
  `ai:meta` chain on `revolucion/journal`, first `ai:request`
  (my-lounge 3D generation) with its ask-gate question on the dashboard,
  `jwize.com:website` deposited on verified site roots. SKILL.md updated.
- **Phase 2:** features-window toggle → pheromone deposit (essentials
  code: Beehaviors writes the tag instead of flipping active behavior
  state); website behavior stops self-scanning.
- **Phase 3:** transcript inbox dir wired into the routine; hand-off
  sessions launched from drained approvals end-to-end.
- **Phase 4:** when the `sign('pheromones')` deposit-history pool lands,
  intent tags become the author's deposits in that pool unchanged in
  meaning; the sweep reads the field instead of the tag index.

## Verification recipe (no OPFS wipe — ever)

Read-backs only: `layer-at` the scope cell → decorations slot → resolve
sigs → assert the tag/meta/request payloads; `note-list` for notes;
walk `prevMetaSig` one hop. The dashboard question is asserted via the
qa read (`fb.cjs open-qa`), never by eyeballing the rendered page.
