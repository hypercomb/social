# Features Experience Overhaul — one vocabulary, three honest lights

**Status: DESIGN — pinned 2026-07-09. Not built.**
Companion: `content-health.md` (the "why isn't my content showing" half),
`dcp-single-door.md` (the transaction half).

## Problem

The state machinery underneath features is sound — the presentation lies.
Recon (2026-07-09) located the confusion precisely:

1. **One lifecycle, two vocabularies.** The DCP installer world (egg,
   pending, enabled, active-elsewhere — `tree-node.ts`) and the hive world
   (applied, gated, hidden, verified, adopted — `show-features.drone.ts`)
   describe the same journey with unrelated words. The panel is titled
   "Beehaviors" while copy elsewhere says features / behaviors / bees /
   capabilities. The user has no single word for the thing they manage.
2. **ON doesn't mean on.** A gated (unverified, INERT) feature renders a
   green ON switch plus "enabled — not verified by community"
   (`features-viewer.component.ts:528-531`, `en.json:435`). Three truths —
   *allowed*, *verified*, *running* — shown as one green switch.
3. **Half-built states.** The "Hidden here" section exists only as orphaned
   i18n keys (`features.section.hidden`, `features.restore` — never
   referenced). Staging's write path is dead but `portal-overlay` still
   reads `stagedSigs()` (always empty). `authored-sigs.ts` is a stub nothing
   consults, so the gate cannot go fail-closed.
4. **Silent failures.** Adopt/enable failures go only to the transient
   activity log; from the panel a failed adopt is a stuck switch until a
   4–8s leash clears (`features-viewer.component.ts:748-756,936-943`).
5. **Overloaded verbs.** "hide" = retire a beehavior (pool) AND session-hide
   a tile. "add" = attach a beehavior AND merge a peer child. "allow" =
   verification bypass AND code-adopt consent AND make-public.

## The model: three questions, answered everywhere, in the same words

Every feature-shaped thing — a beehavior on a tile, a package in DCP, an
adopted branch, a code node — has a state that is the answer to three
independent questions:

| Question | States | Source of truth |
|---|---|---|
| **Is it here?** | here · arriving… · not delivered yet | bytes present (OPFS pools / layer slots) vs egg/pending |
| **Did you say yes?** | allowed · needs your OK | verified / allowed-root / authored / trusted-domain vs gated |
| **Is it running?** | on · off (kept) · inert (missing module) | IoC-registered + rendering vs hidden pool vs unrecognized kind |

**The honest-switch rule:** the switch shows *running* — only running. A
gated feature's switch is OFF (disabled, with a "needs your OK" chip and the
allow action beside it). It never renders green while inert. This is the
single highest-value fix in the overhaul.

**The chip convention:** each row carries at most one quiet status chip
(existing indicator-pill visual language, cold/clean, no motion):

- `needs your OK` → allow button adjacent
- `arriving…` → download pathway feeds it; becomes switch when bytes land
- `not delivered yet` → egg; plain words, not metaphor
- `off — kept` → lives in the Hidden section, restore is one tap
- `inert — needs a module you don't have` → unrecognized kind
- `running via another package` → DCP active-elsewhere, surfaced at last

Simpleton test for every label: a first-time user reads the chip and knows
(a) what is true and (b) what tapping will do. No jargon survives review.

## One noun, reserved verbs

The user-facing noun is **beehavior** on every hive surface (panel title
already is). DCP keeps "package" for the container, but its rows adopt the
same three-light chips. Raw decoration `kind` strings move to a detail
line, never the primary label.

| Verb | Reserved meaning | Never used for |
|---|---|---|
| **adopt** | bring peer content into your tree | enabling, verifying |
| **allow** | the trust decision (verification gate) | publish, code consent (that's "run code from…") |
| **add** | attach a beehavior to a tile | merging peer children (that's "merge") |
| **turn off / turn on** | running state; off is kept, restorable | tile visibility |
| **hide / show** | tiles only (session visibility) | beehaviors |
| **block / remove** | device-level rejection | anything recoverable |

## Panel structure (Beehaviors)

1. **On this tile** — running beehaviors. Switch + origin ("on this tile" /
   "↳ from {cell}") + chip when gated.
2. **Off — kept here** — the unbuilt Hidden section, built. Lists every
   `kind:'hidden'` record in scope with a one-tap **restore**. The i18n
   keys already exist (`features.section.hidden`, `features.restore`).
3. **Available to add** — unchanged shape; non-addable view bees show
   their slash-command chip (already correct).
4. **From peers** — adopt targets + hierarchy diff (merge), with the
   download pathway stepper as today.

**Row-level outcomes replace stuck switches.** Every action lands one of:
done (state flips), or a plain-words failure on the row itself — "couldn't
fetch — the host isn't answering" / "this kind can't be added from the
panel — use its command" — fed by `content:health` (see companion doc) and
the existing refusal reasons that today go only to the activity log.

## Fail-closed authored wiring

Wire the two TODO producers in `authored-sigs.ts` (commit path marks sigs
you minted), then flip `featureNeedsReview` to consult
`isLocallyAuthored` so your own pages under an adopted root stop depending
on luck-of-domain, and foreign detection can go fail-closed.

## Build checklist (ordered)

1. **Honest switch**: gated rows render OFF+disabled with `needs your OK`
   chip + allow button; kill the "enabled — not verified" line.
   (`features-viewer.component.ts` isOn/gated branch)
2. **Hidden section**: render `kind:'hidden'` records under "Off — kept
   here" with restore; wire the orphaned i18n keys.
3. **Staging removal**: delete dead `toggleStaged/isStaged/clearStaged`,
   the `stagedSigs()` read in `portal-overlay.component.ts:295`, orphaned
   `features.want*/like*/staged*` keys, and the stale staging paragraph in
   `show-features.drone.ts:44-54`.
4. **Verb/noun pass**: apply the reserved-verb table across `en.json` /
   `ja.json` and every surface that names these actions.
5. **Authored producers** + fail-closed gate.
6. **Row-level outcomes**: subscribe panel rows to `content:health` +
   refusal reasons; retire the silent 4s/8s leashes.
7. **DCP chip alignment**: egg → "not delivered yet", active-elsewhere →
   "running via another package" (data exists at `tree-node.ts:38-50`;
   badge design in `feature-tuning-garage.md` stays the reference).
8. **Hygiene**: strip the stray NUL byte in `site-view.drone.ts` (~offset
   45429) that makes grep tooling treat it as binary.

Items 1–3 are small, independent, and remove the worst lies; 4–8 complete
the overhaul.
