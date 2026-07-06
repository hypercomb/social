# The Tuning Garage — Installer Feature-Gating, Two-Lens Review, Capability Dedup & Recipes

> **status: design — not built (as of 2026-06-18).** Installer capability-tag dedup, two-lens review, and signature-addressed tuning recipes; no code shipped yet.

**Status:** design (not yet built). Supersedes the ad-hoc notes around installer defaults.
**Owning subsystems:** DCP installer (`diamond-core-processor`), `hypercomb-essentials` sharing/capability, `hypercomb-shared` shell UI + sigbag storage.

> The installer is a **mechanics workshop / Gran Turismo tuning garage**: every available part is laid on the bench, a novice picks a preset ("recipe") and goes, an expert opens every panel and tunes each worker. The **accept gate (`actions:available`) is the "lock in your tune" moment** — nothing runs before it. Two qualities held together: **simplicity** (pick a recipe) and **sophistication** (per-worker tuning).

This design was produced by a multi-agent pass (5 code-mapping agents → 3 independent design approaches → 3-lens judge panel → synthesis → adversarial critique) and then **corrected against the critique**. The most important correction is recorded in §4: the original draft proposed reusing `genotype` as the dedup key, which is verifiably wrong (`genotype` is a coarse subsystem cohort, not a feature key). The corrected mechanism is opt-in and safe.

## Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Tag-vocabulary governance | **Seed vocabulary + write-time validation** (see `capability-tags.md`); warn on divergence, no runtime registry |
| 2 | Tie-break: baseline vs adopted | **Baseline (own domain) wins**; an explicit pin is the only way to prefer an adopted provider |
| 3 | Recipe scope | **One global active recipe** (`recipe.active`) across all adopted branches |
| 4 | Manifest production | **Precompute + cache by immutable branch-root sig** at adopt time |

These can be revisited; they are recorded so the rest of this doc is decision-complete.

---

## 0. Principles this design must not violate

- **Signatures are identity + composition.** Manifests and recipes are signature-addressed resource blobs — sig-named files at the content root, written via `putResource` — referenced by sig; consumer choice is never inline in shareable content. These artifacts are [DNA](dna.md) — content-addressed, merkle-versioned, immutable, composing upward to root. "DNA" is a documentation lens over the *existing* `kind` discriminant (layer / dependency / bee / resource / content): there is no `DnaService`, no `dna` field, no new OPFS folder — the signature is the only universal primitive.
- **Layer purity.** The shared layer holds canonical primitives only. All consumer tune state lives in the participant-local settings sigbag, so the **branch lineage sig is byte-identical before and after a full tune** (the cardinal anti-skew invariant — see [`feedback_viewport_not_in_history`]).
- **Accept-gated.** Fold/resync fire only on portal "Done" (`actions:available`). Passive close discards the pending diff.
- **Two-store split.** Registry markers (DCP's `__content__`/`__lineages__` stores — legacy naming, pending their own pool migration) and module bytes (`DcpStore`) drift independently; restore reconciles both.
- **Minimalism.** No new state library, no new OPFS folder, no new mesh kind. Reuse `EventTarget` + EffectBus, the `decorations` slot, the settings sigbag, and IoC. (This is the DNA guardrail in practice: feature-gating composes over the existing content-addressed artifacts; it never invents a parallel store or transport.)

---

## 1. Installer default-allow policy

The existing **provenance gate is preserved verbatim**. The new capability layer lives *inside* the already-ON set and never relaxes the content gate.

### 1.1 Top-level rule (unchanged)

`tree-node.ts:13-21` and `home.component.ts:180-207` stay as-is:

```
off-by-default  ⇔  kind === 'content' AND adopted at runtime
everything else (baseline / packages / own-data / logical) → ON
```

- **Baseline / own data / manually-installed packages:** ON. Baseline code runs regardless of the switch (this is the fix for the historical "all features marked off" bug — never reintroduce a code-OFF default on baseline).
- **Freshly-adopted content root:** OFF (master switch; must be flipped + Done).
- **Descendants of an enabled root:** ON via cascade.
- **Un-latched adopted nodes:** `defaultEnabled(kind)` = data ON / code OFF.
- **Content-only auto-enable exception** (`home.component.ts:944-956`): a branch with no code anywhere auto-enables on arrival.

**Audit must-fix:** the `subtreeHasCode` check that drives the content-only auto-enable must be computed from **resolved provider bee kinds**, never a manifest's self-declared `kind`. A manifest claiming "content-only" while pointing at a code sig must not light code past the gate.

### 1.2 The capability refinement (additive, inside the ON set)

A **competing-capability tag** (§4) may have several *eligible* providers. Among providers the consumer has **already authorized** (enabled + passed the trust gate + clicked Done), the resolver activates **exactly one per competing tag**. Losers become *candidates* (visible alternatives), not disabled features.

Two hard invariants:

1. **The resolver can never turn a `kind==='content'` worker ON.** It only chooses, among already-authorized workers, which single one wins each *competing* tag. A newly-adopted provider of an already-won tag arrives as a **losing candidate**, never an auto-activating feature.
2. **Per-tag `defaultEnabled` in a manifest is a publisher *suggestion*, never authority.** A code-kind provider still passes the trust gate (`hatchBlocker:'untrusted'`). A remote publisher cannot auto-run adopted code on a consumer.

### 1.3 Where each default lives (existing primitives, new keys)

| State | Storage | Default |
|---|---|---|
| Per-node toggle | `ToggleStateService` `localStorage['dcp.toggleState']` | `defaultEnabled(kind)` |
| Per-branch master switch | settings sigbag `feature.<branchSig>` | absent = OFF |
| Per-capability enable | settings sigbag `cap.enable.<tag>` *(new)* | absent → manifest suggestion → policy default |
| Per-capability manual pin | settings sigbag `cap.winner.<tag>` *(new)* | absent → resolver tie-break |
| Active recipe | settings sigbag `recipe.active = <recipeSig>` *(new)* | absent |

No new localStorage for shareable state; no new OPFS folder; no new state library.

---

## 2. Consumer-facing presentation — two lenses on one branch

A segmented **"Bench / Files"** control in the DCP installer header. Both lenses read the **same `home.component` signals** (`toggleMap`, `nodeMap`, `activeSigSet`) so there is no second source of truth; switching is instant and neither lens hides what the other shows.

### 2.1 Lens A — the Workshop Bench (`cap-bench.component.ts`, new)

Sits beside `tree-view.component.ts`, fed by the same signals projected through a new `CapResolver`. **Rows are competing-capability TAGS, not files.** Tags group under their family by prefix (`render:`, `input:`, `files:`) — the family is an accordion header (a part bin), the tags are the tunable parts. Reuses `tree-row`/`toggle` rendering. Each row shows:

- Tag label (i18n via `cap.<tag>` keys), winning provider name + first-8-hex sig.
- The existing `toggle` component bound to `cap.enable.<tag>`.
- A **provider-count badge** ("3 providers") when alternatives exist; expanding lists every candidate with its provenance breadcrumb (`tree-row` renders `domain/path/`) and a **radio to re-pin** the winner.
- A **worker-state badge** — the literal answer to "already started by another package vs not-yet-registered":

| State | Visual | How it's computed |
|---|---|---|
| **ACTIVE HERE** | teal | this branch's provider is the resolved winner; sig in `activeSigSet`, `iocKey` resolves to its own instance |
| **ALREADY STARTED BY ANOTHER PACKAGE** | graphite ◯ (reuse `isActiveElsewhere`, `tree-node.ts:38-50`) | `CapResolver.providerOf(tag).domain !== thisNode.domain` — tag already satisfied live by a different package's instance occupying the `iocKey` (IoC first-wins). Toggle shows "would replace `<domain>`'s provider" |
| **NOT YET REGISTERED / available** | muted | candidates exist, none in `activeSigSet`, `iocKey` empty — this would claim the tag first |
| **EGG** 🥚 | existing `hatchBlocker` | bytes `undelivered`/`untrusted` — Allow/Retry, unchanged |

The recipe picker sits at the top of the bench (§5).

### 2.2 Lens B — the File Explorer (full fidelity)

The branch **in its entirety** — every sig-addressed layer / bee / dependency / resource as a navigable folder/file node with name + kind + first-8-hex sig + audit badge. **Reuse `diamond-core-processor/tree-view` as primary** (renders all six `TreeNodeKind`s with sig, kind, eggs, audit) and `hypercomb-shared/ui/file-explorer/opfs-explorer.component.ts` as the raw-OPFS fallback for inspecting the actual sig-named files in the branch folder/sigbag.

From any bench tag, "inspect" jumps to the winning provider's node (`bee-inspector.component.ts`). Toggling a code node in the explorer writes the **same** `dcp.toggleState` key the bench uses, so the bench reflects it immediately — the drop from curated bench into raw branch.

### 2.3 How switching works

Both components mount in the DCP shell; the segmented control flips a `signal<'bench'|'files'>`. Both subscribe to `toggleMap` / `activeSigSet` / `CapResolver` `cap:resolved`. No state is copied — two projections of one model. **Shell-parity rule:** the lens host must be added to both `hypercomb-web/src/app/app.{ts,html}` and `hypercomb-dev/src/app/app.{ts,html}`.

---

## 3. Restore-time review and the lock-in gate

### 3.1 Flow: adopt → see → tune → lock-in → register/dedup → render

1. **ADOPT (unchanged):** `SwarmAdoptDrone` fires `portal:open` with `#branch=<sig>`. `home.component.#fillBranchSection` resolves the subtree, marks `freshlyAdopted`, master switch OFF. On fill, the **cached feature manifest** for the branch-root sig is produced if absent (§4.2, decision 4).
2. **SEE:** the installer joins this manifest with any present peers' manifests → `Map<tag, providers>` → Bench renders one row per competing tag; File Explorer renders the raw branch. `registry:snapshot` streams live — **nothing is committed**.
3. **TUNE:** consumer picks a recipe (batch write of pending `cap.enable.*` + `cap.winner.*`) or flips individual tags / re-pins providers. All writes are **pending overlay intent only**; the layer is untouched (no lineage-sig skew). The portal's `+adds/−removes` counter reflects this.
4. **LOCK IN YOUR TUNE (the accept gate — UNCHANGED sole trigger):** "Done" → `portal-overlay.apply()` → `actions:available`. **Passive close (×, backdrop, Escape, touch-drag) discards everything** and fires `dcp:embed-closed` (`portal-overlay.component.ts:299-309`, `swarm-adopt.drone.ts:161-181`). This is the only place anything installs or runs.
5. **REGISTER / DEDUP (on `actions:available`):** `SwarmAdoptDrone.#onDcpDone` (`swarm-adopt.drone.ts:328`) reads the accepted snapshot (now carrying `caps[]`), computes ADDS/REMOVES against the recoverable `hc:last-folded` receipt, folds enabled content via the existing `#commitBranch`/`importTree` cascade. **Only the winning provider's sig per competing tag enters the active set** — the preloader imports one bee per such tag (see §6 for the allow-set mechanism). Losing candidates' bytes may land in the `sign('bees')` pool (incremental, immutable; legacy `__bees__/` is a read-fallback drain) but are never imported.
6. **RENDER:** hive reads `RegistrySnapshot.caps` (fail-open) as a code-activation filter alongside `isInLogical`. Winning workers drive their surfaces; bench badges flip to "active here".

### 3.2 Restore reconciles both stores (the two-store split)

Restore is step 5 driven by a saved logical root instead of a fresh adopt. For each manifest feature it reconciles registry markers (DCP's legacy `__content__`/`__lineages__` stores, pending their own pool migration) against `DcpStore` bytes with **bytes-present-before-marker** discipline:

- providerBeeSig bytes present in `DcpStore` **and** marker present → enable-eligible.
- bytes present, marker missing → append marker.
- marker present, **bytes missing** → render as `undelivered` egg, trigger a byte pull. **Never** add a feature to the logical whose bytes the hive can't load (that produces a silent missing worker).

Mirror the host-sync read-back receipt discipline: a dropped byte must not advance the install. *(Note: per the current map, the restore API exists but is unwired and this reconciliation code does not yet exist — this is the seam to build, not a reuse.)*

---

## 4. Capability tags — one-of-each-feature across many swarm participants

### 4.1 The tagging scheme (CORRECTED — opt-in `capability`, not `genotype`)

**Do not reuse `genotype`.** Verified against the codebase: `genotype` is a **coarse subsystem cohort label** authored for the cohort *visibility* toggle (`genotype:set-visible`). One value spans many co-operating drones — `genotype='sharing'` is declared by **9** drones (swarm, nostr-mesh, content-broker, follow, mesh-adapter, avatar-swarm, ambient-presence, subscribe-consent, swarm-adopt). "One winner per tag" over `genotype` would dispose essential drones. `genotype` stays exactly as-is for cohort visibility — a different axis.

Instead, introduce a **new, optional, fine-grained field** on `Bee.base`:

```ts
// hypercomb-core/src/bee.base.ts — additive, optional
capability?: string   // form '<family>:<noun>', e.g. 'render:tiles', 'input:pointer'
```

- Declared **only by bees that genuinely COMPETE** for one slot. The Phase 0 audit (see `capability-tags.md`) found this set is **11 slots** across ~90 bees: `render:tiles`, `render:host`, `render:background`, `visual:screensaver`, `nav:zoom`, `nav:pan`, `input:touch`, `editor:tile`, `clipboard:core`, `files:dropbox`, `assistant:bridge`. Everything else is a co-operating cohort or additive singleton and stays untagged.
- **Where `capability` lives:** on the **ultimate `Bee` base** (`hypercomb-core/src/bee.base.ts`). `Drone`, `QueenBee`, `Worker`, `NurseBee`, and any future **view-behavior** base all `extends Bee`, so every bee kind inherits the field — no per-kind special-casing in the static extractor (§6.2). Kind-specific concerns (e.g. consuming the `render:host` container) belong on the specialized base, **not** on `Bee`.
- **Wiring caveat (must-fix):** the three Worker-owned slots (`ClipboardWorker`/`ClaudeBridgeWorker`/`PixiHostWorker`) already `extends Worker → Bee` ✓. But **`TileEditorDrone` and `TouchGestureCoordinator` extend *nothing*** — they self-register in IoC but are plain classes despite the names, so they cannot inherit `capability`. Fix structurally: **promote them to proper `Bee` subclasses** (e.g. an editor / view-behavior base), not by special-casing the extractor to read off plain classes.
- **Untagged and cohort-tagged bees run exactly as today** (IoC first-wins per `iocKey`). The resolver's default for an unrecognized/absent tag is **RUN ALL — no dedup.** This structurally protects swarm/assistant/meeting/movement subsystems.
- Vocabulary is the same flat `<family>:<noun>` shape as decoration kinds (`files:dropbox`, `visual:website:page`), so visual-bees' existing `decorationKind` can act as a capability tag with zero code change.
- `capability` is **code metadata extracted statically at build time** (§6), carried in the layer/manifest bytes — never read by instantiating untrusted adopted bees, never stored in the layer (layer purity preserved).

### 4.2 The feature manifest (a `DecorationRecord`, rides the existing slot)

Produced at adopt time by reading each bee's statically-extracted `capability` (decision 4: cached by branch-root sig), emitted via `writeDecoration` (`decoration-manifest.ts:101-128`) → sig appended to the branch root's `decorations` slot → **rides the merkle tree for free, no new transport, no new mesh kind**. This is the recursive-layer-composition rung in action: structured feature data attaches via the `decorations` slot (a flat sig array) on the branch sub-layer, never by extending the layer primitive's shape — so the manifest is just more [DNA](dna.md) cascading to root:

```ts
DecorationRecord<FeatureManifest> {
  kind: 'feature:manifest',
  appliesTo: <branch root lineage segments>,
  payload: {
    features: Array<{
      tag: string,            // capability tag, e.g. 'render:tiles'
      exclusive: boolean,     // true = competing (one-winner); false/absent = run-all
      providerBeeSig: string, // 64-hex; bytes in the sign('bees') pool
      iocKey: string,         // '@ns/ClassName' (Bee.iocKey)
      defaultEnabled: boolean,// SUGGESTION only; trust gate still applies to code
      label?: string, iconName?: string, descriptionKey?: string,
    }>
  }
}
```

**Publisher-write-once, consumer-read-only.** Consumer choice never enters this resource — it lives only in the settings sigbag (§1.3). This is the structural guarantee that the branch lineage sig is byte-identical before and after a full recipe apply.

> Storage note: feature manifests are **SHAREABLE** decoration content, so `writeDecoration` writes them via `putResource` as sig-named resources at the content root (`decoration-manifest.ts:84-119`) — they ride the merkle tree and replicate through the existing resource pipeline. The optimization substrate — the `sign('optimization')` pool (the legacy `__optimization__` folder is absorbed and deleted on boot) — is a **separate decoration substrate** for PERSONAL decorations (Q&A, comms) that must NOT leak across peers; it has its own bridge ops (`optimization-add`/`optimization-list`) and is never referenced from the `decorations` slot (`decoration-manifest.ts:16-32`). Do not conflate the two: public decoration content → sig-named resources at the content root; personal decoration content → the `sign('optimization')` pool. (`decoration-manifest.ts` also carries a stale interface comment at line ~68 mis-stating where the record is stored — fix that before building on it.)

### 4.3 `CapResolver` — observe, don't mutate

New singleton, IoC `@diamondcoreprocessor.com/CapResolver`, an `EventTarget` self-registering at module load like `VisualBeeRegistry`. It **subscribes to the existing `window.ioc.onRegister`** (`ioc.web.ts:73`) — it does **not** modify `register()` and adds **no** EffectBus coupling to `ioc.web.ts`.

For every registered instance declaring a `capability`, it records a candidate keyed by tag:

```ts
type CapProvider = {
  tag: string; iocKey: string; domain: string;   // from bee.namespace
  beeSig: string | null;                          // best-effort; see dev note
  exclusive: boolean;
  state: 'own' | 'shared';
}
```

- `providerOf(tag): CapProvider | null` — the live winner.
- `candidatesFor(tag): CapProvider[]` — drives bench alternatives.
- `resolve(tag): void` — applies the tie-break ladder, seeds the allow-set (§6). **Called only at the accept gate.**
- `map(): Record<tag, {...}>` — for the bench and `window.__hcCapabilityReport()`.

**Dev-shell determinism (must-fix):** on the `hypercomb-dev` direct-import path (port 4250, the primary test target) bees register outside the preloader, so `beeSig === null`. With no sig, tier-4 lowest-sig is unavailable; define a deterministic non-sig fallback (e.g. `iocKey` lexical order) so **dev and web resolve identically**. Resolution must work with `beeSig === null`.

### 4.4 The deterministic tie-break ladder

`resolveCapability(tag, candidates, pins)` is **one pure function** used identically for local dedup, swarm merge, and recipe apply. Among **enabled** candidates of an **exclusive** tag:

1. **Explicit pin** — `cap.winner.<tag>` (manual) or recipe pin, if that candidate is present + enabled → **wins. COMMITTED.**
2. **Host-trust rank** — own domain > adopted-trusted operator > unknown peer. **Display-only / transient.** *Per-consumer; does not commit* (decision 2: baseline-wins is realized here for the live preview, but the committed winner falls through to tier 4 unless pinned).
3. **Already-running** — the candidate whose `iocKey` is the current IoC first-wins occupant, so the bench agrees with reality. **Display-only / transient.**
4. **Lexically-lowest `providerBeeSig`** (lowercase hex) — total, clock-free, spoof-free, **identical on every peer. COMMITTED.**

Only tiers **1 and 4 commit**; tiers 2–3 govern only pre-gate display. This is what guarantees "one of each feature on *every* peer." **Recency / `created_at` is explicitly rejected** (spoofable; diverges per relay-replay and receive timing — see [`project_swarm_replaceable_replay`]).

> Decision 2 nuance: "baseline wins" is the *display* default (tier 2) and the expected outcome whenever the consumer's own baseline ships the tag — but the *committed* guarantee across peers is the pin-or-lowest-sig rule. If you want baseline to win deterministically on every peer, baseline must carry a built-in pin (recommended: the `simple`/`desktop` seed recipes pin baseline providers explicitly).

### 4.5 IoC first-wins is the runtime backstop; tag-dedup is the chooser

Tag-dedup prevents the consumer from *choosing* redundant code; IoC first-wins (`ioc.web.ts:15-30`) prevents redundant code from *running*. Byte-identical providers across peers collapse for free (same SHA-256 → `#beeCache` loads once). Behavior-identical-different-bytes → IoC keeps one, `CapResolver` records the other as a `shared` alternative.

**Scope guard (must-fix):** this resolution is scoped **strictly to code activation**. The visual tile-source `(kind, name)` union (`tile-source-registry.ts`) is left untouched, to avoid the documented partial-child-set / leftover-tiles render regressions.

### 4.6 Worked example — a real contest (two renderers colliding on one `iocKey`)

The only situation where two providers genuinely contend for one slot is an `iocKey` collision — e.g. two `ShowCellDrone`-class renderers from different packages, both registering `@diamondcoreprocessor.com/ShowCellDrone`, both declaring `capability: 'render:tiles'`, `exclusive: true`.

| Provider | tag | providerBeeSig | domain | trust (Dave) |
|---|---|---|---|---|
| Dave baseline `ShowCellDrone` | `render:tiles` | `0b00…` | dave (own) | own |
| Bob `ShowCellDrone` | `render:tiles` | `1c4b…` | bob.com | trusted operator |
| Carol `ShowCellDrone` | `render:tiles` | `9e02…` | carol.com | unknown peer |

- Bench shows ONE row, "3 providers".
- No pin → display preview shows baseline (tier 2 own-domain). **Committed** resolution: no pin → tier 4 lowest-sig. `0b00… < 1c4b… < 9e02…` → **baseline `0b00…` wins on every peer identically.** Bob's and Carol's show graphite ◯ "already started by another package".
- Dave re-pins Bob's → writes `cap.winner.render:tiles = 1c4b…` → tier 1, committed, survives recipe re-apply.
- Byte-identical case: if Bob and Carol shipped the *same* sig, `#beeCache` loads it once — dedup for free, no contest.

A non-exclusive (cohort) tag like the 9-drone `sharing` cohort is **never** put through this — all nine run.

---

## 5. Recipes — the signature-addressed preset primitive

### 5.1 What a recipe IS

A recipe is a **signature-addressed `DecorationRecord`** of the same family as the manifest, `kind:'recipe:tune'`, written via `writeDecoration` → `putResource` as a sig-named resource at the content root (`<recipeSig>`). **Not a layer, not a new store** — it dedupes, forks, and shares by sig like every other resource.

```ts
DecorationRecord<RecipeTune> {
  kind: 'recipe:tune',
  appliesTo: [],                 // recipes are context-free presets (decision 3: global)
  payload: {
    name: 'mobile' | 'desktop' | 'embedded' | 'simple' | 'artistic' | <custom>,
    label?: string,
    pins:   Record<tag, providerBeeSig>,  // chosen winner per tag (sig reference)
    enable: Record<tag, boolean>,         // tag-level on/off (sparse; absent = policy default)
    base?: recipeSig,                     // composition: child layers over parent
  }
}
```

`pins`/`enable` are **exactly** what `resolveCapability()` consumes — a recipe is a **frozen, shareable seed for the resolver**, not a parallel system. Referenced from the settings sigbag by sig: `recipe.active = <recipeSig>` (decision 3: one global active recipe).

### 5.2 Composition with the §4 dedup

Applying a recipe = (1) write each `enable.<tag>` and (2) seed each `cap.winner.<tag>` from `pins`, all **pending overlay** until Done. The recipe's pin is a pre-recorded tier-1 input to the **same** one-provider-per-tag resolution. If a recipe pins a tag whose provider isn't present, the resolver falls through to tier 4 — **a recipe never force-installs a missing feature** (mesh stays slim). The bench surfaces "pinned provider not present" honestly.

### 5.3 Precedence (one explicit ladder — expert override survives recipe re-apply)

```
manual override (cap.winner.<tag> written on the bench)
  >  active recipe pin (recipe.active → pins[tag])
  >  default tie-break ladder (§4.4: pin → lowest-sig)
```

Manual overrides are a **higher tier** than the recipe, so switching recipes never silently clobbers an expert's tune. A "reset to recipe" gesture explicitly clears the `cap.winner.*` overrides for that recipe's tags.

### 5.4 Seed recipes (shipped baseline-signed)

Bundled sig-named resource blobs (shipped via `putResource`) referenced from a built-in recipe index:

- **simple** — enable only `core:*` (navigation, show-cell, selection); pin baseline providers; everything else off.
- **desktop** — full `input:*` / `editor:*` / `clipboard:*` / `move:*` / `keyboard:*`.
- **mobile** — pin `input:*` to touch providers, enable pinch-zoom, drop hover-only tags, disable heavy `visual:*` decorators.
- **embedded** — read-only: enable `render:*` / `visual:*`, disable all `editor:*` / `clipboard:*` / `sharing:*`.
- **artistic** — enable `substrate:*` / `visual:*` / avatar / screensaver; disable dashboard / website build.

### 5.5 Authoring and sharing

`CapResolver.exportRecipe(name)` snapshots the live bench state (`pins`/`enable`) and `putResource`s it → recipe sig (a "Save tune as recipe" action mirroring `saveBranch`). Share = hand someone the sig (swarm resource stream, clipboard sig-drag, or host HTTP). Import = fetch the resource, list it in the picker — **the consumer still passes it through their own accept gate**. Community forks one, edits → new content → new sig → shareable.

### 5.6 Worked example — apply "mobile", then fine-tune one worker

1. Dave taps **"mobile"** → `recipe.active = <mobileSig>` (pending). Resolver seeds `pins`/`enable` from the recipe.
2. Bench updates live — each tag's winner + enable snaps into place; portal pending counter shows deltas. **Nothing runs yet.**
3. Dave wants the substrate background on mobile → flips `visual:substrate` ON → pending `cap.enable.visual:substrate = true`. This is a **manual override above the recipe**, so it survives a later "mobile" re-apply.
4. Dave clicks **Done** → `actions:available` → `#onDcpDone` → `CapResolver.resolve()` per affected tag (override > recipe pin > ladder), seeds the allow-set, the preloader activates exactly one provider per exclusive tag.
5. Render: touch pointer active, substrate active (his override), hover dormant. Re-tapping "mobile" tomorrow keeps substrate on (override tier wins); "reset to recipe" clears it.

---

## 6. Two critical fixes from the adversarial pass

### 6.1 Resolver runs *before* registration, via an allow-set — not post-hoc disposal

`ioc.web.ts` register() is **first-wins and disposes the loser at register() time** (`ioc.web.ts:26-28`). A resolver that ran *after* registration and tried to pick a different winner would point at an already-disposed ghost (EffectBus subs torn down), with no way to revive it or evict the live first-wins occupant.

**Fix:** for exclusive tags, the resolver **pre-seeds an allow-set** (`Set<providerBeeSig>` of committed winners) at the accept gate; the **`ScriptPreloader` consults it before instantiating** an exclusive-tagged bee, so the loser is **never constructed or registered**. Non-exclusive bees are unaffected (run-all). This replaces "construct everything then dispose losers."

### 6.2 Tags are extracted statically at build time

At adopt time the adopted bees are untrusted and **not instantiated**, so `capability` cannot be read at runtime without violating the trust gate. The essentials build already emits per-bee doc entries (`BeeDocEntry`/`layerDocs`); **carry `capability` + `exclusive` there**, so manifest production reads the tag from already-fetched layer/manifest JSON — never by running adopted code. This also resolves the dev-shell determinism gap (§4.3).

---

## 7. Data shapes, files, IoC keys, events (concrete index)

**Core (additive metadata only):**
- `hypercomb-core/src/bee.base.ts` — **new optional** `capability?: string` (+ `exclusive` convention via manifest). `genotype` unchanged (cohort visibility). `iocKey` reused for provenance.

**Build:**
- essentials build — emit `capability`/`exclusive` into the per-bee doc entry so it lands in layer/manifest bytes (static extraction, §6.2).

**New singleton (essentials):**
- `hypercomb-essentials/src/diamondcoreprocessor.com/capability/cap-resolver.ts` — `CapResolver`, IoC `@diamondcoreprocessor.com/CapResolver`, `EventTarget`, self-registers, subscribes to `window.ioc.onRegister`. Emits `cap:resolved {tag, winnerSig}`. Exposes the allow-set to `ScriptPreloader`.
- `resolveCapability(tag, candidates, pins): string | null` — pure function, the single dedup definition (bench + swarm merge + recipe apply).

**New UI (DCP + shell):**
- `diamond-core-processor/src/app/cap-bench/cap-bench.component.ts` — Lens A; reuses `tree-row`/`toggle`; fed by `home.component` signals + `CapResolver`.
- Segmented "Bench / Files" control in the DCP installer header; File Explorer lens reuses `tree-view.component.ts` + `hypercomb-shared/ui/file-explorer/opfs-explorer.component.ts` + `bee-inspector.component.ts`.

**Storage (existing sigbag, new keys):**
- settings sigbag: `cap.enable.<tag> = boolean`, `cap.winner.<tag> = providerBeeSig`, `recipe.active = recipeSig`. Sync read from `#settingsCache`, async one-marker-per-change append (`dcp-domain-storage.ts:646-653` pattern). Existing `feature.<branchSig>` master switch retained.
- per-node toggle: `ToggleStateService` `localStorage['dcp.toggleState']` (unchanged).

**Resources:**
- content root `<sig>` (sig-named resource files at the OPFS root) — feature manifest `kind:'feature:manifest'`, recipes `kind:'recipe:tune'`, via `writeDecoration`/`putResource`.

**Events (EffectBus, last-value replay):** reuse `decorations:changed`, `registry:snapshot`, `actions:available`, `fold:receipt`, `genotype:set-visible`. **New:** `cap:resolved`. **No new event from `ioc.web.ts`.**

**RegistrySnapshot extension (fail-open):** `registry-snapshot.ts` gains optional `caps?: { tag; winnerSig; enabled; candidates }[]`. Old DCP builds post no `caps` → hive treats absent as "no opinion, resolve locally", never "nothing active". Keep payload to winner + enabled + candidate-count (not full provider records) to bound postMessage size.

---

## 8. Phased build sequence

0. **Competition audit — DONE** (9-agent workflow, verdict *sound*). Result: **11 contended slots** (listed in §4.1 and `capability-tags.md`), out of ~90 bees. The remainder are co-operating cohorts (sharing=9+3, presentation overlay stack=4, zoom/pan feeders=5, editor feeders=5, meeting=5, assistant orchestration=7, history=6, …) that must stay untagged. Note the only iocKey double-registrations (`PinchZoomInput`, `TouchGestureCoordinator`) are benign tree-shaking re-registrations of the same class, not contention.
1. **`capability` field + base-class fix + static extraction + manifest production (no behavior change).**
   - a. Add the optional `capability?: string` field to the ultimate `Bee` base (`hypercomb-core/src/bee.base.ts`) so all kinds inherit it.
   - b. **Base-class fix (prerequisite):** promote the two base-less slot owners to proper `Bee` subclasses so they can carry the field — `TileEditorDrone` → an editor / view-behavior base; `TouchGestureCoordinator` → the appropriate input base. (Pure refactor, no behavior change; verify both still self-register under their existing `iocKey`.) The other 9 owners already inherit via `Drone`/`Worker`.
   - c. Tag exactly the 11 audited owners with their `capability` (and `exclusive: true`).
   - d. Emit `capability`/`exclusive` into the bee doc entry in the essentials build (static extraction — never read off instantiated adopted bees).
   - e. Add the `feature:manifest` walk at `#fillBranchSection` (cached by branch-root sig) → `writeDecoration`. Verify the sig rides the branch root's `decorations` slot. No resolver yet.
2. **`CapResolver` (observe-only).** Singleton subscribing to `onRegister`, building `Map<tag, candidates>`. Add `window.__hcCapabilityReport()`. Verify in **hypercomb-dev (port 4250) first** that `beeSig === null` fallback resolves identically to web.
3. **Bench lens (read-only).** `cap-bench.component.ts` rendering tag rows + worker-state badges from `CapResolver` + `activeSigSet`. Segmented control + File Explorer lens. Mount in **both** web and dev shells.
4. **Allow-set + resolution at the gate.** `cap.enable.<tag>`/`cap.winner.<tag>` writes; `CapResolver.resolve()` wired into `#onDcpDone` only; allow-set consulted by `ScriptPreloader` *before* instantiating exclusive bees (§6.1). Scope strictly to code activation. **Verify branch sig is byte-identical before/after a tune** (cardinal anti-skew test).
5. **Recipes.** `recipe:tune` resource shape, seed recipes, picker, `exportRecipe`, precedence ladder. Compose with §4 dedup.
6. **Swarm merge + restore reconciliation.** Feed present-peer manifests into the same `resolveCapability`. Wire restore's two-store reconciliation (bytes-present-before-marker). Extend `RegistrySnapshot.caps` (fail-open). Run the 3-peer worked-example test.
7. **Vocabulary doc + validation.** Ship `capability-tags.md` (done — see sibling file); validate declared `capability`/manifest tags against the seed vocabulary at manifest-write time (warn on divergence — decision 1).

---

## 9. Remaining open items (deferred, not blocking)

- **Recipe per-branch override** (we locked global): revisit if a single global tune proves too coarse across very different adopted branches.
- **Author-rank tie-break** (we locked baseline-wins): only worth it if a real case appears where an adopted worker should beat baseline without a per-consumer pin — and only with the cross-peer-determinism cost made explicit.
- **Lineage-sig-skew CI gate:** recommend wiring the "branch root sig byte-identical before/after full recipe apply + fine-tune" assertion into CI as a permanent guard.

---

## Related memory / docs

- [`project_installer_workshop_recipes`] — the workshop/recipes vision
- [`project_installer_package_code_defaults_on`] — the `kind==='content'` off-default rule
- [`feedback_install_gated_on_accept`] — accept-gate semantics
- [`project_dcp_two_store_split`] — registry markers vs module bytes
- [`feedback_viewport_not_in_history`] — keep participant-local state out of the layer
- [`project_swarm_replaceable_replay`] — why `created_at` is rejected as a tie-break
- `capability-tags.md` — the seed capability vocabulary
