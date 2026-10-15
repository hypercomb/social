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

**A group publishes where its page does** (2026-10-13). The page's domains are
its own switches at the top of the Publish panel. A member that names no host
of its own takes them — written as its own host marks (`setBranchHosts`), the
record every publish reads, so the member's own Publish row then says where it
went. With no domain on for the page and no own host standing in, the toast
says where the switch is ("Turn on a domain for this page in Publish …")
rather than the general "add a host".

**Proven against a real host** (`scripts/drive-publish-groups-live.cjs`, 8
checks): the content host's own worker served from this machine
(`node scripts/local-content-host.mjs 4291 <shell>`); a group of two on a page
of three; the host only CARRIED and switched on for the page — no own host, no
host-sync opt-in. The page itself publishes ("Published — its host is serving
it.") and, WHILE it does, `groups publish blog` → "Published Blog"; the HOST's
signed index (the `hive:indexes` pool, `<pool>/<pubkey>`) names `site`,
`site/one` and `site/two` on door `localhost:4291` — neither publish dropped
the other (publish-differential.md, "Two writes, one index") — and not
`site/three`. Run it against
a dev shell that does not live-reload (`--live-reload=false --watch=false`):
another session's edits otherwise reload the page mid-run.

**A host on this machine is a publish node** (2026-10-13). Until then a page
WITH children never finished publishing to one — "Still uploading" after the
120 s wait, while leaves published in seconds. `addPublishNodes` admitted only
a dotted, port-less name, so `localhost:4291` was dropped, `markPublic` (no
node, no public host) staged nothing, and the page's freshly sealed root —
the one atom no tile write had already backed up — never left; a leaf's seal
IS its backed-up head, which is why leaves worked. Loopback hosts (any
`*.localhost`, 127.x, ::1, with a port) are now nodes, by the same rule that
already chose http for them (`LOOPBACK_HOST_RE`, host-sync.service.ts; pinned
in host-sync.swarm-target.spec.ts). Other hosts keep the strict shape.

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
guessed, and write nothing. Proof: `scripts/drive-groups-word.cjs`
(11 checks).

**A model may say it** (jwize 2026-10-13: "the whole idea is that we can
publish groups"). `machine` declares `reach: 'editing'`, `scope: 'network'` —
inside the default grant — pinned in `commands/machine-declarations.spec.ts`.
Its `refuse` admits every form but three: `ungroup` (a whole group taken off
the layer — only the participant says it), `add`/`drop` with no tiles named,
and `new` while the participant has tiles selected (both would act on a
selection a model cannot see — name the target on the machine seam).

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
- `publish-panel.component.{ts,html}` + `publish-panel.groups.scss` — the
  panel's Groups section.
- Proof: `scripts/drive-publish-groups.cjs` (13 checks),
  `scripts/drive-groups-word.cjs` (11 checks),
  `scripts/drive-publish-panel-groups.cjs` (5 checks),
  `scripts/drive-publish-groups-live.cjs` (8 checks, against a real host).

## In the Publish panel

The panel's folded **Groups** section lists the layer's groups — icon in its
colour, name, **Publish (n)** — and publishes one from there, through the same
act. It is the door that stays open over a view: the strip is a hexagons
surface, but `p` reaches the panel anywhere, and the panel still lists the
groups. The panel is shell code and cannot ask the drone, so it is TOLD: the
drone announces `publish-groups:render { segments, groups[] }` (last-value
replayed, every render, empty where the behaviour is not lit) and the panel
shows only the announcement for the page it is describing; the row's button
sends `publish-groups:publish { segments, meaning }` back. Its styles are their
own sheet (`publish-panel.groups.scss`) so the panel's main sheet never grows
toward the per-sheet `anyComponentStyle` budget. Proof:
`scripts/drive-publish-panel-groups.cjs` (5 checks).
