# Agents — the work you can see

An **agent** is one unit of work in flight in the hive: a queued `/opus` ask
waiting for a bridged Claude Code, a routine that announced itself, an install
or sync pass. Each one is drawn as a **bee** flying over the tiles it is
working on. Click the bee and the request opens — what was asked, where the
answer will land, what it is doing right now — and you can hand it more context
while it is still working.

The hive was already doing the work. This makes the work visible, addressable,
and interruptible.

## The parts

| Part | Where |
|---|---|
| Registry — what is working right now | `essentials/…/assistant/agent-registry.service.ts` |
| Waggle — how each kind dances | `essentials/…/presentation/avatars/agent-waggle.ts` |
| Models — whose model, and how heavy | `essentials/…/presentation/avatars/agent-model.ts` |
| Avatars — which bee for which behaviour | `essentials/…/presentation/avatars/agent-avatar.ts` |
| Emblems — the mark on the bee's back | `essentials/…/presentation/avatars/bee-ab-atlas.ts` |
| Bees — the sprites, the dance, the click | `essentials/…/presentation/avatars/agent-bee.drone.ts` |
| Panel — what opens when you click one | `essentials/…/assistant/agent-panel.view.ts` |
| `agent-progress` — how a responder reports | `essentials/…/assistant/claude-bridge.worker.ts` |
| Step ledger — what a responder DID, durably | `essentials/…/assistant/chat-steps.ts` |
| Orchestrator — the bee that watches the bees | `essentials/…/assistant/orchestrator.drone.ts` |
| Orchestrator sweep — the repo half | `scripts/bridge/orchestrator-sweep.cjs` |

## Reading a bee

Three things are legible before you click anything:

| Signal | Says |
|---|---|
| **The dance** | what KIND of work it is — a model thinking, a script running, background housekeeping, the orchestrator watching |
| **The colour** | WHICH behaviour, or for a model, WHOSE — the vendor family |
| **The mark** | the kind again, up close: burst, gear, ring, eye |

### Kinds and their waggles

The base is the tutorial's loved figure-8 (`tutorial-overlay.view.ts`):
`sin(7.4t) · 30` across, `sin(14.8t) · 11` down — the 1:2 Lissajous a real
honeybee traces. Every pattern is a sibling of it.

| Kind | Dance | Mark |
|---|---|---|
| `model` | a compact version of the loved figure-8 | burst |
| `script` | a flat, even patrol — a triangle wave, no dance to it | gear |
| `system` | a slow circle | ring |
| `orchestrator` | the same compact figure-8 at ⅓ the speed | eye |

A script's motion is deliberately not a dance: deterministic work should not
look like it is deliberating.

The dance keeps one compact size for every status, so its width does not pulse
as work moves between waiting and working. Each dance stays close to its tile
and pauses as soon as the pointer enters its hit area, leaving a still target
for the click. Nothing flashes.

`kindFor()` derives the kind from the behaviour name unless the caller
declares one. Anything that is not a recognised model, the sync lane, or the
orchestrator is a `script`.

### Vendors and tiers

A hive can have several models working at once, from several vendors, so a
model bee's look is built in two steps (`agent-model.ts`):

- **Vendor** decides the colour family: anthropic clay, mistral amber, local
  moss, openai teal, google sky, meta indigo, deepseek violet, xai magenta.
  Assigned so no two families share a hue — a spec enforces the separation.
  These are *not* anyone's brand assets.
- **Tier** shades within the family: `deep` darkest, `fast` lightest. So opus
  and haiku are obviously siblings and obviously not each other.

The vendor comes from the MODEL name, not the behaviour that invoked it: a
routine called `summarise` running `gpt-4o` flies a teal GPT bee, not a bee
named after the routine. A model nobody has catalogued gets vendor `unknown`
and a stable hue derived from its own name — nothing breaks when a new model
ships, it just has no family until someone names it.

## Where agents come from

There is no parallel store. Asks already persist as `kind:'ask'` records in the
`sign('optimization')` pool (`llm.queen.ts`), so **those are the agents** —
which is why a queued ask still has its bee after a reload. On top of that:

- `ask:queued` → an agent appears (status `pending`)
- `ask:answered` → its answer landed; it finishes and the bee leaves
- `agent:start` / `agent:progress` / `agent:end` → the **generic lane**. Any
  behaviour can raise a bee by emitting these.
- `install:sync` → the long-op lane, already emitted by install and resync

```ts
EffectBus.emit('agent:start', {
  id: 'website-build:1', behavior: 'website',
  request: 'Build the landing page', targets: ['home'], segments: ['sites'],
})
EffectBus.emit('agent:progress', { id: 'website-build:1', activity: 'writing the page' })
EffectBus.emit('agent:end', { id: 'website-build:1', ok: true, summary: 'page written' })
```

## Reporting from another process

Work that happens outside the browser — a bridged Claude Code answering an ask
— reports through the bridge:

```bash
node scripts/bridge/_ask-drain.cjs progress <ask-sig> "reading 12 notes" working
```

That sends the `agent-progress` bridge op, which emits `agent:progress`. It
writes no layer, no note and no record, so a responder can report as often as
the work has something to say.

## Adding context

The panel's text box mints another `kind:'ask'` record carrying
`mode:'context'` and the original ask's signature. The original record is never
rewritten — content is immutable, so a follow-up is a new record pointing at
the first. `_ask-drain.cjs` folds pending context into the question it answers
and retires the context records with the ask; `watch-asks.cjs` prints a
`{"context": "<ask-sig>", …}` line so a parked session learns about a follow-up
to work it may already be doing.

## Avatars — one per behaviour

Every behaviour has its own avatar type, resolved most-specific first:

1. **Participant override** — `hc:behavior-avatars` in localStorage, keyed by
   the behaviour's stable `view` name. Set through
   `AgentAvatarRegistry.setOverride(behavior, spec)`. Always wins.
2. **Declared** — `avatar` on the behaviour's `VisualBeeDescriptor`. Declared,
   never seeded (same doctrine as `pheromones`): re-asserted on every module
   load, never written to storage, so a module update cannot clobber a
   participant's choice and there is no stale default to migrate.
3. **Derived** — a palette from the behaviour's name. The default, and the
   reason an undeclared behaviour still flies a bee you can tell apart. Hues
   are spread by the golden angle, because short similar names (`haiku`,
   `sync`, `website`) land on top of each other under a plain modulo.

A spec is four colours, or an `imageSig` — a resource signature for an image to
fly instead of the bee drawing. Signature doctrine: the bytes live once at the
content root, the avatar holds the pointer.

```ts
registry.register({ view: 'website', /* … */, avatar: { body: '#7eb6d6', stripe: '#0c1118' } })
```

The drawing itself is always AB (`bee-ab-atlas.ts`) — one loved shape,
recoloured per behaviour and baked to a small atlas of flap frames. Bakes are
shared between behaviours that resolve to the same colours.

## Why sprites and not the swarm mesh

The peer/op swarm (`avatar-swarm.drone.ts`) draws up to 2048 bees in ONE draw
call, which it can do because every bee shares one texture. Agent bees do not
share a texture — each behaviour has its own — and there are only ever a
handful. So they render as individual sprites: per-behaviour textures, per-bee
hit testing, negligible cost. The swarm keeps its fast path.

Bees hold a **constant screen size**, counter-scaled against the world
container, so a zoomed-out hive still shows a bee you can see and hit.

## The orchestrator

One behaviour whose whole job is that nothing goes wrong quietly. It sweeps
the registry every 15s and raises findings:

| Finding | Means |
|---|---|
| `waiting` | queued a long time with nothing picking it up (is a Claude Code bridged?) |
| `silent` | said it was working, then reported nothing for minutes |
| `overlap` | two live agents working the same tile |
| `failed` | ended badly |
| `rogue` | still alive long past any reasonable run |
| `sweep` | a repo-side finding pushed in from the bridge |

It has its own bee — calm while everything is healthy, dancing when it has
something to say — and clicking it opens the same panel as any other agent,
where its activity log IS the findings list. When there is nothing running and
nothing outstanding it stands down completely: an idle hive should be an empty
hive.

**Opening it is the audit.** The watcher perches top-left, out of the way, and
every tile an agent is tending is gathered into ONE NORMAL VIEW — real tiles,
painted by the hive's own renderer, each with its bee dancing over it, exactly
the way work is read everywhere else in the hive. Agents with no tile target
dance in the open in the same view. Clicking a bee opens its request as usual;
clicking a tile travels to the real work (which puts the gathered view down —
the click takes you to the real place). Pressing the watcher again, or closing
its panel, puts everything down. There is no separate console, board, or list:
the audit is made of the same material as the hive.

**It reports, it never intervenes.** A stalled ask is still the participant's
request, and a slow routine may be slow for a good reason. Retiring or
restarting someone else's work on a timer would destroy data to satisfy a
heuristic, so it does not. It makes the state visible and leaves the decision
where it belongs.

In a backgrounded tab the browser throttles timers to roughly once a minute,
so the sweep slows down when nobody is looking. That is fine — and worth
knowing before you conclude it has stopped.

### The repo half

`scripts/bridge/orchestrator-sweep.cjs` covers what a browser cannot see:

- **logs** — stray `*.log` / `nohup.out` a run left behind (only files git can
  see; an ignored build dir is nobody's problem)

Findings print as JSON for a parked session and ride the `agent-progress` op
onto the orchestrator's own bee (prefixed `sweep: `, which is what keeps the
drone from hearing its own progress lines and turning them into findings). It
writes no file, no layer and no note.

```bash
node scripts/bridge/orchestrator-sweep.cjs
```

## Clicking

Hit testing runs in a **capture-phase window listener**, not through Pixi
interactivity, because tile navigation is driven by its own window pointer
listeners. Capturing first is the only way to take the press before the hive
treats it as a tile click, and `stopPropagation` there stops the whole cascade:
pressing a bee never pans, navigates or selects. A press anywhere else is
untouched.

There are two targets per bee: the bee itself, and the **waggle area** — the
patch of air it is dancing in, drawn as a faint trace and hit-tested as an
ellipse over the pattern's reach. The bee wins when the cursor is on it, but
the area is what makes this usable: you should not have to chase a dancing
insect with a mouse.

The panel is a panel, not a takeover — the hive stays visible and navigable
behind it, so you can keep moving through tiles and watching the other bees.
Its native text controls own typing without globally locking hive navigation. 
