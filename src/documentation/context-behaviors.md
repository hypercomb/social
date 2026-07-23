# Context Behaviors — managing the tile you're standing IN

**Status: DESIGN (Jaime, 2026-07-20). First slice — the `/dashboard`
toggle — BUILT.** Companions: `meaning-loop.md` (passive behaviors +
pheromone discovery), `shell-surfaces.md`, `pheromones.md`.

## The gap, verbatim

> "Since there's no tile on the current tile you should be able to
> somehow manage the current context behaviors instead of clicking a
> tile and setting the behaviors on the tile like we do. … you literally
> get tiles per feature, and since those markers are in the history we
> can use them logically to create those tiles — nothing fancy, it
> should all be minimal."

Today behaviors are managed by clicking a CHILD tile. The page you are
standing inside has no tile of its own, so its behaviors have no
management surface — and hive-global features (the dashboard is the
first) have no home at all.

## Scope model — one primitive, three reaches

The same record (a behavior/pheromone decoration, in the cell's history)
at three depths, mirroring the pheromone panel's reach control:

| Reach | Where the record lives | Entry point |
|---|---|---|
| **node** | a child cell | click its tile (today's flow, unchanged) |
| **context** | the cell you are IN | the manage-context mode (below) |
| **global** | the hive ROOT cell | same mode at root, or a "whole hive" reach in the panel |

"Turn the dashboard on globally" = deposit its record on the root —
visible from anywhere, one primitive, no special global store. This is
the application-scope doctrine (pinned at a scope root, descendants
inherit by READING — never stamped down) applied to features themselves.

## Manage-context mode

Entering "manage this context" (a shortcut or a small icon — NOT a tile
click) does two things at once:

1. **The canvas swaps.** The context's normal tiles disappear
   temporarily; in their place, **one ephemeral tile per active
   feature** on this context. These feature tiles are minted logically,
   at read time, from the behavior markers already in the cell's history
   — a projection like the tag-filter flatten, never stored, wipe-safe,
   never truth. Minimal rendering: deterministic glyph + feature name.
2. **The Beehaviors panel opens alongside.** Panel and feature tiles are
   two views of the same records — toggling in the panel adds/removes
   feature tiles live; the tiles make the context's active surface
   *visible*, the panel makes it *editable*.

Exit restores the normal tiles. You were always logically standing in
the thing you were updating.

## Return semantics (the rule that keeps navigation honest)

- Managing a **child's** behaviors (via its tile): on exit you are back
  at the **parent** context — you went somewhere, you come back up.
- Managing the **current context** (via the shortcut/icon): exit returns
  you to **yourself** — it was an update ON the context, not a walk into
  a tile. Nothing about your position changed.
- `/dashboard` already follows this rule (BUILT): bare `/dashboard`
  navigates to the global dashboard remembering where you stood; running
  it again returns you to that exact spot. Right-click keeps its normal
  meaning (up one level) throughout — the dashboard is a plain page,
  not a modal. `/dashboard here` keeps the old per-location minting.
  Guard: toggle-in refuses when no dashboard cell exists (never mint a
  phantom segment) and says how to get one.

## Availability vs activation (meaning-loop tie-in)

The features panel in this mode is the **passive library**: turning a
feature on deposits its record (context or root reach) and nothing else.
Discovery of what to DO with it belongs to AI passes (pheromone sweep →
ask-gate → hand-off). Behaviors never self-activate work; the dashboard
is "on" globally means the surface is available and `/dashboard` shows
the questions — not that anything starts happening.

## Rollout

1. **DONE** — `/dashboard` toggle semantics (dashboard/dashboard.queen.ts;
   dev shell live, web needs the next essentials deploy).
2. Manage-context entry (shortcut + icon) + the feature-tile flatten
   (read-time projection from the context's decorations).
3. Beehaviors panel reach selector: this tile / this context / whole
   hive — reusing the pheromone panel's reach vocabulary.
4. Migrate website + dashboard availability onto root/context-scope
   deposits (meaning-loop Phase 2 — the features toggle becomes a pure
   pheromone deposit).
