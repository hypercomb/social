# How to bee! — progressive onboarding & the Progression gate

**Status:** design (agreed with Jaime 2026-07-07) · not built
**Owner concept:** turn `/help` from a flat command dump into a gated, gamified learning path; ease newcomers into the whole program by holding advanced surfaces back until they are earned.

---

## 1. The idea

`/help` today auto-introspects the entire ~97-command surface into flat clustered islands — every bit of jargon at once. **How to bee!** replaces that landing with a **walkable hierarchy of Stages → Lessons**, ordered as a real learning arc: the plain essentials first, the jargon and odd behaviors held to the end. Completing a stage's lessons earns it a ✓, lights up the next stage, and **graduates** the real features that stage teaches (they stop being held back in the live app). Learn-by-doing: wherever possible a lesson **checks itself off when the user actually performs the action** — the tile they create *is* the proof.

The full pre-existing command reference is **not deleted** — it relocates to its own root and becomes the deepest, last-unlocked level ("Grow your powers").

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

## 3. Curriculum (first draft)

Six stages, chronological, jargon deferred. Each stage = a hexagon at the `/help` root; each lesson = a hexagon child. Human titles/instructions live in **notes** (tile *names* stay normalized lowercase-hyphen, per the bridge normalization rule). Only Stage 1 lit initially.

| Stage | Lessons | Auto-complete trigger | Graduates (unlocks) |
|---|---|---|---|
| **1 · Look Around** | Pan the view · Zoom in & out · Meet a tile (hover) | pan / zoom / hover effects | basic navigation chrome |
| **2 · Make Something** | Create your first tile · Name it · Give it a face (image) | history commit / image-set (*these become real first tiles*) | create/edit affordances |
| **3 · Go Deeper** | Step inside a tile · Add a couple of children · Step back out | `explorerEnter` / back-nav | navigation into/branches |
| **4 · Change & Undo** | Edit a tile · Undo · Redo ("you can always go back") | history undo/redo effects | history controls |
| **5 · Organize** | Select several · Move one · Tag them | selection / move / tag effects | selection, move, tags, notes |
| **6 · Share & Beyond** | Make it yours (settings) · Share your hive · **Grow your powers** → portal to the full command reference + Beehaviors | mixed: manual "got it" for concept tiles | sharing/swarm, Beehaviors, slash commands, the flat reference |

**Aesthetic (per Jaime's prefs — no flashy effects, chrome cold/clean, plain hexagons):**
- unlock = **brighten** (dim → lit, no sparkle)
- done = clean **green ring + ✓ badge**
- locked = subtle **dim + gray ring + small lock glyph**

Completing the whole path may mint a small **"graduated" keepsake tile** (a real first-class artifact) in the user's hive.

Lessons run on the **real hive** (a fresh profile starts empty, so it's safe and the artifacts are genuinely the user's). Detection is global via EffectBus, so the user can perform the action anywhere and the path checks it off on return. An optional subtle **quest-log HUD** can show current lesson + progress without forcing a return to `/help`.

---

## 4. Build phases (each shippable + dev-verifiable on 4250)

- **Phase 0 — Author the tree (bridge only).** Script the `/help` stages + lessons as real tiles: normalized names, titles/instructions in notes, a `learn:lesson` decoration per node (`{stage, order, unlockAfter, trigger, unlocks}`). Relocate the existing flat reference to its own launcher root; Stage 6 portals to it. Verify via chrome driver. Pure data — zero code risk. *This is the literal "use the bridge to organize the help collection into a hierarchy" deliverable.*
- **Phase 1 — Progression engine + tile states.** `LearnProgress` (done-set + unlocked-set, localStorage) · `LearnWatcher` (EffectBus auto-complete + manual "got it" fallback) · the three tile states in `show-cell` · lock navigation into a locked stage. Makes it a *gated, gamified* path. Convert `/help` to a normal root + rewire the command-bar Help icon to navigate there.
- **Phase 2 — Hold back view-behaviors.** New `kind:'locked'` substrate + `isFeatureLocked` + `feature:unlocked`; view-behavior drones also gate on it; stage-complete unlocks; Beehaviors panel renders locked-and-dimmed (non-restorable, distinct from user-hidden).
- **Phase 3 — Full program eases in (Tier 2).** The `Progression` service as the single unlocked-set source; per-user runtime suppression hooks for slash autocomplete, command-bar chrome, and (optionally) keymap; unlock manifest drives it; graduated escape hatch + existing-profile default. Biggest lift.
- **Phase 4 — Polish.** Graduation artifact, quest-log HUD, i18n (en/ja + fallback), web/dev shell parity, `build:essentials` for production OPFS bundles.

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
