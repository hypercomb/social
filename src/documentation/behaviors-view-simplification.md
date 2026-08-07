# Behaviors View Simplification — the store, the light, the badge

Status: **built** (2026-08-06 — panel, drone and i18n reworked; verified on dev.
Still owed: essentials rebuild/deploy for the web shell, the website view's
revision list, and the mirror pass — queued `behaviors-store-simplification`).

The Beehaviors panel (`hypercomb-shared/ui/features-viewer/`, ~1,540 lines) tries to
answer three different questions in one window — what do I have, what is enabled,
what is active here — through a three-rung reach ladder, a roster mode, an
available-to-add section, a hidden/carve-out pool, and gate chips. This plan
replaces all of it with two simple surfaces and one state model.

## State model

Three independent facts about a behavior, never conflated:

| Fact | Meaning | Storage |
|---|---|---|
| **Adopted** | You have it. It sits in your bucket. | Existing (behavior present in hive) |
| **Lit** (on) | The global switch. Off = filtered totally: dormant everywhere AND withheld from swarm. One switch, one meaning — unchanged from the enablement roster. | Existing `behavior-enablement` records |
| **In use** | At least one decoration carrying the current revision references it. | **Derived** — counted, never stored |

Adopting is one gesture, no verb needed. The row itself shows state:

- **dim** — off (or not yet adopted)
- **lit** — on, idle
- **lit + badge** — on and in use (the badge is the count of current-revision decorations)

The community-verification gate collapses into the first flip to lit — turning
the light on IS your OK. No "needs your OK" chip, no inline allow override UI.

## Membership is positive — the decorations ARE the website

A composite behavior (a website) is not "the branch under its root, minus
carve-outs." It is exactly the set of tiles carrying its web-part decorations.

- No decoration → never in the site. Nothing to exclude, nothing to hide.
- A freshly adopted Website with no decorated parts shows an empty site — correct.
- **Renders where**: a behavior acts exactly where (a) its decoration sits with
  the current revision AND (b) its light is on. Two conditions, no override ladder.

This deletes the entire subtractive apparatus: hidden pool, off-kept-here
restore rows, per-page carve-out records, site-root master switch, and the
descendant-override reset. None of it has a job when inclusion is opt-in.

## Revisions are the website's history

Every web part is stamped with the revision it belongs to. Therefore:

- **A revision is a snapshot**: the set of decorations sharing that number is a
  complete, self-describing version of the site.
- **Only current-revision parts show as on.** Stale parts from an older build
  drop out naturally — no switching off, no cleanup.
- **The website's view lists its revisions.** Latest renders by default;
  choosing an older entry shows the site exactly as it was, because those
  decorations still exist, still stamped. Jumping between versions = choosing
  which revision the view reads. Non-destructive, same shape as the installer's
  loadable-revisions line.

## The two surfaces

### 1. Store view ("Beehaviors") — no tile subject

One flat searchable list of every behavior the app knows. Per row: icon, name,
description, the light, the in-use badge. Click the row = flip the light.
That's the whole surface. No tabs, no context, no sections beyond
adopted-first ordering.

### 2. Tile view ("On this tile") — standing on a tile

- Rows for the decorations this tile carries — these ARE the applied
  behaviors. Remove = remove the decoration.
- An Apply picker offering only lit behaviors from the store. Applying writes
  the decoration at this tile, stamped with the current revision.
- Openable view behaviors keep their Open action.

## Deleted from the current panel

- The reach ladder tabs (this tile / its context / your hive)
- Roster-as-a-third-mode (the roster becomes the whole store view)
- "Available to add" with its addable/gated/globalOff branching
- The "Off — kept here" hidden-pool section and restore rows
- Origin/scope attribution chips ("part of the website at …")
- Master-switch descendant-override reset
- Gate chip + inline allow override (folds into first flip to lit)

## Survives (mechanism, not UI)

- `behavior-enablement` global on/off + wake records (the light)
- `feature-verified` marking (written by the first flip to lit)
- Decoration add/remove plumbing (`features:enable` path)
- Download pathway stepper (adoption progress) — unchanged
- Hidden-pool records already written remain readable; the rework stops
  minting new ones. Drain plan decided at implementation time.

## Owed when implemented

- Rework of `features-viewer.component.{ts,html,scss}` into the two surfaces
- Revision list in the website's view (jump-between-versions)
- Mirror pass: update the behaviors mirror tiles/notes to the new model
  (run or queued — never neither)
