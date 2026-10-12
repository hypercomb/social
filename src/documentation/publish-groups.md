# Publish groups

**Status: BUILT (jwize, 2026-10-10/11).** *"Individual publish changes or
change groups but keep it minimal… an icon you can set the name and color…
These groups are actually a behavior that you get to put tiles in, assign
icons and colors in the hive itself."* Answers: **top of the hive, select then
tap, per layer.**

## What it is

A behaviour like any other. Light **Publish groups** in the Beehaviors pool,
then on a layer, and that layer gets a strip of icons at the top of the hive —
one per group, each in its own colour, with a `+` at the end.

| Gesture | Does |
|---|---|
| select tiles, tap a group's icon | they join it — or leave it, when every selected tile is already in |
| tap an icon with nothing selected | its editor: name, icon (the shared chooser), colour, **Publish**, **Ungroup** |
| `+` | a new group, taking in whatever is selected |
| hover an icon | its members light in its colour (`group:preview`, show-cell) |

**Publish** sends each member's branch through `publishBranch`, one after the
other — never in parallel, because every publish read-modify-writes the host's
signed index and two at once can drop each other's entry. The toast says how
it went, and why when it could not (no host, no signer — the same
`publish.failure.*` texts the Publish panel uses).

## The word — `groups`

Every act on the strip has a word (`hypercomb-essentials/src/sharing/groups.queen.ts`),
acting on the layer you stand in through the same acts the strip calls:

```
groups                          this layer's groups and who is in them
groups on | off                 light or put out the strip here
groups new <name>               a new group — the selected tiles join it
groups add <group> [tiles]      tiles join (the selection when none are named)
groups drop <group> [tiles]     tiles leave (the selection when none are named)
groups rename <group> <name>
groups color <group> <colour>   blue amber green pink red violet, 1–6, or #rrggbb
groups icon <group> <icon>
groups publish <group>          publish every member
groups ungroup <group>          take the group off the layer
```

A group is named by its name in any case; a name with spaces is quoted
(`groups add "my blog" one, two`); tiles go by comma or by space. The word
keeps its whole line (`rawArgs`) — `publish` is itself a behaviour word, and
`groups publish blog` must not also open the Publish panel. `groups on` / `off`
emit the panel's own `features:enable` / `features:remove` with `silent: true`
(the deposit is the answer; the panel stays shut). `groups new` lights the
strip here if it was not. Unknown groups, tiles and sub-words are said, never
guessed, and write nothing. No `machine` grammar: publishing reaches outward,
and default-deny stays the policy. Proof: `scripts/drive-groups-word.cjs`
(11 checks).

The strip is a hexagons surface: a takeover view, an owner-counted cover (the
chat window), a published visitor shell or a dormant behaviour takes it away.

## The data — marks the members wear, never a parent

| What | Where | Shape |
|---|---|---|
| the behaviour | the layer | `publish:groups`, empty payload (the panel's ordinary deposit) |
| a group | the same layer | `publish:group` `{ meaning, name, icon, color }` — one record per group |
| a member | the member tile | `group` `{ sig, meaning }` — the ordinary group mark (`pheromones/enrollment-acts.ts`) |

- **Identity is the meaning** (`publish:<random>`), and the group's signature
  is DERIVED from it (`groupSignature(meaning)`, `documentation/group-signatures.md`).
  It is never written into the `publish:group` payload: `writeDecoration`
  declares every 64-hex string in a payload as a ref, and a group signature
  names no bytes, so a host would 404 on it forever.
- **Name, icon and colour are appearance.** Changing them writes a new
  `publish:group` record and drops the old one; no member is touched, because
  the meaning — what they wear — does not change.
- **Remove by what a read found.** History's write boundary canonicalizes the
  records it commits (`HistoryService #canonicalArtifactReferences`), so the
  slot can hold a different sig than `writeDecoration` returned. Every edit
  re-reads the layer and removes the group's records by the sigs found there;
  writes run one after another.
- **Read members from each child's own head.** A child gaining a mark does not
  move the sig its parent lists in `children` (names are the truth, resolved
  to heads when read), so the strip resolves each child by name.
- **Ungroup, not delete** (`hide-first-delete-second.md`): it takes the marks
  and the group's record off the layer — an ordinary layer edit; undo brings
  it back.

## Files

- `hypercomb-essentials/src/sharing/publish-groups.ts` — the pure half (kinds,
  palette, `decideTap`, `groupsInSlotOrder`), spec beside it.
- `hypercomb-essentials/src/sharing/publish-groups.drone.ts` — the strip (a
  framework-free element contributed through the shell-surface registry), the
  reads, the writes, publish.
- `show-features.drone.ts` `CAPABILITIES['publish:groups']` — the roster row.
- `show-cell.drone.ts` — `group:preview { labels, color }`, the hover light.
- `groups.queen.ts` — the word; its parser (`parseGroupsLine`,
  `resolveGroupColor`) is in the pure half.
- Proof: `scripts/drive-publish-groups.cjs` (13 checks),
  `scripts/drive-groups-word.cjs` (11 checks).

## Not built (yet)

- Groups listed inside the Publish panel itself; today the strip and the word
  are the doors.
