# How to bee! — progressive onboarding & the Progression gate

**Status:** design (agreed with Jaime 2026-07-18) · not built · **re-anchored 2026-07-18**
**Owner concept:** add *earned progression* to `/help`'s existing curated tiers — done-marking, dim-don't-hide, gated unlock — and ease newcomers into the whole program by holding advanced surfaces back until earned.

> **Correction (2026-07-18).** An earlier draft of this doc assumed `/help` was still a flat ~97-command dump. That is **false** — see §1. The curriculum-from-scratch plan it contained is superseded by the delta in §3.

---

## 1. Ground truth — `/help` is ALREADY a progressive tutorial

Verified in `hypercomb-shared/core/help-group.ts` (built 2026-07-09, in the working tree; see `project_help_progressive_tutorial` memory). Three **curated, whitelist-only** tiers (`TIERS`, line 91) rendered as clustered islands:

| Tier | Members |
|---|---|
| **Basics** | 6 `gesture:<id>` — Go In, Go Out, Zoom, Pan, Arrows, Select |
| **Everyday** | `cli:create`, Edit, Copy, Paste, Cut, Remove, Undo, Redo, Fit, Center |
| **Beyond** | Palette, Command Line, Arrange, Arrange Back, Orientation, Public Mode, ／language, ／border, ／accent |

`MORE_MEMBER` ("Show More", key `help:more`) bumps `TIER_KEY = 'hypercomb.help.tier'` in localStorage → the next island reconciles in; it disappears at the last tier. A `Reference` tile leads the page (the full sheet, as the esoteric escape hatch). Anything uncurated **never** gets a tile.

**Therefore: chronological ordering, "no jargon", and "only a few features at the beginning" are already solved.** Do not re-plan them.

## 1b. The complement, not a duplicate

`/tutorial` (alias `/tour`) — the flying bee guide on a transient practice page — is **already built and committed** (`a2e6f185`, 2026-07-17; see `project_bee_tutorial_tour`). Its script already ends by pointing at `/help`. That tour is the **one-time guided walkthrough**; *How to bee!* is the **persistent earned skill tree**. Cross-link them; never duplicate.

### Decisions (Jaime, 2026-07-07)
1. **Lives at `/help`** (reorganized in place), not a new root. The flat reference relocates and is portaled-to from the final stage.
2. **Full program eases in (Tier 2):** hold back view-behaviors *and* slash commands *and* command-bar chrome *and* keymap for not-yet-graduated users, revealing each as its stage completes.
3. **Name: "How to bee!"** 🐝 — the friendly title of the `/help` curriculum.

---

## 2. Architecture — reuse vs. new

Almost everything is cloning an established pattern. The one genuinely new concept is **progressive unlock** — nothing in the tree has any lock/prerequisite/entitlement notion today.

| Need | Reuse (anchor) | New work |
|---|---|---|
| Walkable hierarchy | Normal hive tree at its own root — navigate-into + reference-portals work here (both are deliberately *shadowed* on flat launcher pages, `tile-overlay.drone.ts` ~1856). Bridge-authored → forkable content. | Convert `/help` from launch group to normal root (unregister/repoint `help` in `group-registry.ts` so `isLauncherLocation(['help'])` is false); relocate the flat reference to its own launcher id. |
| "Mark done" (participant-local) | Tutor progress pattern: localStorage `hc:tutor:progress:<locationSig>`, keyed on stable ids, never in the layer sig (`games/tutor/scheduler.ts` 49/191/193-212). | `hc:learn:progress` store of the same shape. |
| Tile states: locked / current / done | Per-cell `borderColor` ring (gray/accent/green), in-place GPU update (`show-cell.drone.ts` ~6395-6407); already-wired `unshared` dim (`hex-sdf.shader.ts` 612-619); persistent corner-badge layer to clone for ✓/🔒 (`presence-badge.drone.ts`). No new shader; no rejected silhouette. | One `Map<label,state>` on `ShowCellDrone`, consulted in the cell-build loop (~5772-5783) exactly like `divergence`/`unshared` already flow; folded into the render cache key (~6135). |
| Auto-detect completion | `window.__hypercombEffectBus` (`emit/on`, replays last sticky value). | A `learn:lesson → effect-name` trigger map + a watcher drone. |
| Hold back **view-behaviors** | Hidden-pool *mechanism shape*: participant-local content-addressed record in `sign('optimization')` pool; reader `isFeatureHidden(segments, featKind)`; `feature:hidden`/`feature:restored` reconcile (`sharing/feature-hidden.ts`, `ui/features-viewer/feature-hidden.ts`). | Hidden pool is **per-tile + view-behavior-only** — can't say "hold globally until earned". Add a sibling **`kind:'locked'` substrate** + `isFeatureLocked` reader + `feature:unlocked` event (keeps user-driven *hide* distinct from tutorial-driven *lock*; supports global/location-less scope). |
| Hold back **slash commands** | — | `slashHidden` is a *static compile-time* flag (`queen.base.ts:59`, honored by the help launcher at `help-group.ts:158`) — **not** per-user/runtime. Need a runtime per-participant filter in slash autocomplete + the help feed. |
| Hold back **keymap** | — | Only global `suppress(reason)` exists (`keymap.service.ts` 52-62, non-`pierce` bindings). Need per-action, per-user gating (lower priority — newcomers won't press unknown shortcuts). |
| Hold back **command-bar chrome** | Launch-group icons / view toggles filter from live sources today. | Filter those sources through the Progression gate. |
| View-behavior + toggle + lifecycle | `VisualBeeRegistry.register(...)`; tutor/site-view mount/teardown already gates on `isFeatureHidden`. | Optional: register the path for a command-line toggle / quest-log HUD. |

### The Progression gate (the new subsystem for Tier 2)
A single participant-local **`Progression` service** (IoC) is the source of truth for what a user has unlocked:
- Holds an **unlocked-set** (feature ids) + a global **`graduated`** flag, persisted in localStorage (doctrine: participant-local, never a layer).
- Every gate-able surface consults it: view-behaviors (via the `locked` pool), slash autocomplete, command-bar icons, keymap.
- Fed by a **unlock manifest** — curriculum data mapping each stage → the feature ids it graduates. Lives on the stage/lesson tiles as an `unlocks: [...]` field in the `learn:lesson` decoration (shared, forkable).
- Emits `progression:changed` / `feature:unlocked`; gate-able surfaces reconcile on it (same pattern as `feature:hidden`).

**Escape hatch (mandatory):** `graduated === true` ⇒ `Progression` reports everything unlocked; the app behaves exactly as today. **Existing/non-empty profiles default to graduated** (detected by a non-empty hive / first-run sentinel) so current users are never hobbled and no hive is reset. A "skip / show everything / graduate" control is always available.

---

## 3. The delta — what *How to bee!* actually adds

The tier roster in §1 stays as the spine (it is already Jaime-curated and jargon-filtered). Four changes turn it from *progressive reveal* into an *earned skill tree*:

| # | Change | Today | After |
|---|---|---|---|
| 1 | **Earned, not free** | `Show More` reveals the next tier for free — nothing is learned | Practicing a tier's items unlocks the next. `Show More` demoted to an explicit **"I already know this"** escape so nobody is ever trapped. |
| 2 | **Dim, don't hide** | The next tier is simply *absent* | Future tiers render **dimmed + gray ring + lock badge** — Jaime asked to *see* what's ahead ("dim out the features and hold them back"). Motivating, and it reuses the verified `unshared` dim recipe. |
| 3 | **Mark off as done** | No completion tracking at all | Each tile earns a **green ring + ✓** when the participant actually performs that gesture/command, auto-detected on the EffectBus. Participant-local. |
| 4 | **Live-app hold-back** (Tier 2) | Nothing is held back outside `/help` | View-behaviors, slash commands, command-bar chrome and keymap are held back for the not-yet-graduated and revealed as tiers complete. |

**Key simplification:** `TIERS[n].keys` **is** the unlock manifest — each tier already lists exactly the features it teaches. No separate manifest, no new curriculum content to author.

## 3b. Hierarchy — RESOLVED (2026-07-18): sub-group pages, no refactor

The earlier framing ("flat islands" vs "dismantle the launcher machinery") was a false binary. A **third path gives the real walkable hierarchy while reusing the launcher machinery**, and two verified facts make it cheap:

1. `isLauncherLocation` (`show-cell.drone.ts:51`) returns true for **any** single segment that resolves to a **registered group id** — so registering a group named `help-basics` automatically makes `/help-basics` a full launcher page (island layout, cards, hover-peek/click-pin) with **zero new rendering**.
2. The `group-launchers` chrome icon strip was **deleted** in `930ead04` (−244 lines), superseded by **pinned-entrances**. Groups no longer auto-render an icon — they surface only when the participant pins them. **So registering extra groups costs no chrome.**

**The shape:**
- `/help` = the **index page** — `Reference` + one tile per tier (Basics / Everyday / Beyond), each carrying the locked / current / done ring state.
- A tier tile's `activate()` → `nav.goRaw(['help-basics'])` → that tier's **own page**, whose `members()` are its lessons, each earning its own ✓ when practiced.
- Walk in → practice → walk back out → the next tier lights up.

This is genuinely the walkable Stages→Lessons tree, achieved by **reusing** the launcher rather than dismantling it: no navigate-into refactor, no chrome pollution, no new renderer. `LaunchGroupBase` already supports everything needed; `WebsitesGroup.activate` is the existing precedent for a group that navigates.

⚠ Verify at build time that a tier sub-group is not accidentally pinnable/listed anywhere it shouldn't be, and that `Show More` semantics move to the index page.

**Aesthetic (per Jaime's prefs — no flashy effects, chrome cold/clean, plain hexagons):**
- unlock = **brighten** (dim → lit, no sparkle)
- done = clean **green ring + ✓ badge**
- locked = subtle **dim + gray ring + small lock glyph**

Completing the whole path may mint a small **"graduated" keepsake tile** (a real first-class artifact) in the user's hive.

Lessons run on the **real hive** (a fresh profile starts empty, so it's safe and the artifacts are genuinely the user's). Detection is global via EffectBus, so the user can perform the action anywhere and the path checks it off on return. An optional subtle **quest-log HUD** can show current lesson + progress without forcing a return to `/help`.

---

## 4. Build phases (each shippable + dev-verifiable on 4250)

> **No bridge authoring is required.** The roster is **code-defined** (`TIERS` in `help-group.ts`), not hive content — so "organize the help collection" is a source edit, not a bridge script. The bridge/chrome driver are still the right tools for **driving and verifying** the result on the dev shell (4250).

- **Phase 0 — Practice detection.** A `LearnWatcher` that maps each tier key (`gesture:<id>`, `cli:*`, keymap cmd, `slash:*`) to the EffectBus signal proving the participant performed it, writing a participant-local done-set (`hc:help:practiced`, localStorage, keyed on the tier key). Ship it **silent** first — no UI — and confirm on the dev shell that real usage marks the right keys. Zero visual risk; de-risks the whole feature.
- **Phase 1 — Show it: done + locked states.** Thread a `Map<label, 'locked'|'current'|'done'>` into `show-cell`'s cell-build loop → green ring + ✓ badge for practiced, dim + gray ring + lock for not-yet-reached tiers (which now **render** instead of being absent). Reuses `borderColor` + the `unshared` dim + a `presence-badge` clone. No new shader.
- **Phase 2 — Earn it: gate the tiers.** Tier N+1 unlocks when tier N's items are practiced; `Show More` becomes the explicit "I already know this" override. This is the behavioural heart — verify it feels good before going further.
- **Phase 3 — Hold back view-behaviors.** New `kind:'locked'` substrate + `isFeatureLocked` + `feature:unlocked`; view-behavior drones also gate on it; tier-complete unlocks; Beehaviors panel renders locked-and-dimmed (non-restorable, distinct from user-hidden).
- **Phase 4 — Full program eases in (Tier 2).** The `Progression` service as the single unlocked-set source; per-user runtime suppression hooks for slash autocomplete, command-bar chrome, and (optionally) keymap; `TIERS[n].keys` drives it; graduated escape hatch + existing-profile default. Biggest lift.
- **Phase 5 — Polish.** Graduation artifact, optional quest-log HUD, i18n (en/ja + fallback), web/dev shell parity, `build:essentials` for production OPFS bundles. Cross-link `/tutorial` ⇄ `/help`.

---

## 5. Invariants (do not violate)

- **Progress & unlocked-set are participant-local (localStorage), never in a layer sig** — same rule as tutor/clipboard/viewport; a shared layer must be byte-identical across peers.
- **Curriculum structure is shared/forkable** — stages/lessons/notes/`learn:lesson` decorations are ordinary hive content (bridge-authored). The unlock manifest rides the decoration.
- **Never trap a power user or reset a hive** — `graduated` short-circuits all gates; non-empty profiles default graduated.
- **Plain hexagons only** — reuse `borderColor` + `unshared` + a badge-layer clone; the custom tile silhouette was previously rejected — do not reintroduce.
- **Tile names normalized; readable text in notes** — the bridge signs segments raw but normalizes children keys; mismatched names fork the tree.
- **No flashy effects; chrome cold/clean.**

---

## 6. Open questions / build-time details
- Exact rewiring of the command-bar Help icon, the `/help` slash, and the `/` keybinding once `/help` is a normal root (the shortcut-sheet popup likely stays as an always-available quick reference).
- Where the relocated flat reference lives (`/reference` vs a new launch-group id) and how Stage 6 portals to it (reference decoration vs activate-navigate).
- Which lessons are reliably auto-detectable vs. manual "got it".
- Whether the quest-log HUD registers as a view-behavior or a lightweight overlay.
