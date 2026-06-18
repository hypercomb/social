# Capability Tags — Seed Vocabulary

Companion to [`feature-tuning-garage.md`](feature-tuning-garage.md). This is the **seed vocabulary** for the optional `capability?: string` field on `Bee.base` and the `tag` field in a `feature:manifest`.

A capability tag exists **only to mark workers that genuinely compete for one slot**. If a bee does not contend with another bee for the same responsibility, **it must not carry a `capability` tag** — it runs unconditionally (run-all default). Tagging a co-operating cohort is a bug: it would put essential, complementary drones through one-winner selection.

> Do **not** confuse `capability` with `genotype`. `genotype` is a coarse subsystem-cohort label used for the cohort *visibility* toggle (`genotype:set-visible`); one `genotype` spans many co-operating drones (`sharing` = 9 drones). `capability` is fine-grained and competitive. They are orthogonal axes; a bee may carry both, one, or neither. (`genotype` is a live `public genotype?: string` field on `Bee.base`, and `genotype:set-visible` — payload `{ genotype, visible }` — is a real event consumed in `tile-overlay.drone.ts`. The `capability` field this doc describes is **not yet built** — see the design framing below.)

> **A third, orthogonal axis: `kind`.** Beyond `capability` (which competing provider wins one slot) and `genotype` (which cohort toggles visible), there is `kind` — the **asset-DNA** classification axis: `layer` | `bee` | `dependency` | `resource` | `content`. `kind` answers *what species of distributed network artifact (DNA) is this* — the signature is the address, the bytes are immutable, and artifacts compose upward so mutations cascade to root (see [`dna.md`](dna.md)). It is orthogonal to `capability` and `genotype`: a `bee`-kind artifact may also carry a `capability` tag and a `genotype` cohort label. DNA is documentation-only vocabulary riding the **existing `kind` discriminant** — it must **never** become a `DnaService`, a `dna` field, or a new OPFS folder. The only universal primitive is the signature.

## Grammar

```
tag        := family ':' noun ( ':' qualifier )*
family     := lowercase word
noun       := lowercase word
qualifier  := lowercase word        # optional, for sub-variants
```

- All lowercase, `:`-separated, no spaces.
- The **family** is the bench accordion group ("part bin").
- The **noun** identifies the contested slot.
- Two providers with the **same full tag** compete; the resolver picks one (pin → lexically-lowest sig).

## Validation rule (decision 1)

At manifest-write time, validate each declared tag against this document:
- **Exact match** → accept.
- **Near-miss** (e.g. `file:dropbox` vs the listed `files:dropbox`, or an unknown family) → **warn**, write through unchanged. The warning is the dedup safety net; without it, `file:` and `files:` silently both run.
- New legitimate tags → add them here in the same PR that introduces the competing provider.

No runtime registry, no alias auto-rewrite (deferred — see open items in the design doc).

## Seed families and tags

The Phase 0 competition audit (9-agent workflow over all ~90 essentials bees; enumerate → classify → adversarial verify, verdict **sound**) found **11 genuinely-contended slots**. These — and only these — get a `capability` tag (`exclusive: true` in the manifest). Each has exactly one provider today; the tag exists so a community alternative *replaces* the incumbent rather than running alongside it.

| Tag | Provider today | File | Fork-likelihood |
|---|---|---|---|
| `render:tiles` | `ShowCellDrone` | `presentation/tiles/show-cell.drone.ts` | medium |
| `render:host` ⚠️ | `PixiHostWorker` (Worker) | `presentation/tiles/pixi-host.worker.ts` | medium |
| `render:background` | `BackgroundDrone` | `presentation/background/background.drone.ts` | low |
| `visual:screensaver` | `ScreensaverDrone` | `presentation/screensaver/screensaver.drone.ts` | low |
| `nav:zoom` | `ZoomDrone` | `navigation/zoom/zoom.drone.ts` | medium |
| `nav:pan` | `PanningDrone` | `navigation/pan/panning.drone.ts` | medium |
| `input:touch` | `TouchGestureCoordinator` (plain class) | `navigation/touch/touch-gesture.coordinator.ts` | low |
| `editor:tile` | `TileEditorDrone` (plain class) | `editor/tile-editor.drone.ts` | medium |
| `clipboard:core` | `ClipboardWorker` (Worker) | `clipboard/clipboard.worker.ts` | low |
| `files:dropbox` | `FileDropDrone` | `files/file-drop.drone.ts` | low |
| `assistant:bridge` | `ClaudeBridgeWorker` (Worker) | `assistant/claude-bridge.worker.ts` | high |

> ⚠️ **`render:host` owns the Pixi `Application`/canvas/root container and emits `render:host-ready`**, which `BackgroundDrone`, `TileOverlayDrone`, `TileSelectionDrone`, `AvatarSwarmDrone`, and `ScreensaverDrone` all consume. It is the highest-confidence slot and was the one slot missing from the first draft of this file.

### Wiring caveat — put `capability` on the ultimate `Bee` base

`capability` lives on the **ultimate `Bee` base** (`hypercomb-core/src/bee.base.ts`). Every kind — `Drone`, `QueenBee`, `Worker`, `NurseBee`, and any future **view-behavior** base — `extends Bee`, so all inherit the field; the static extractor needs no per-kind special-casing.

The three Worker-owned slots (`ClipboardWorker` / `ClaudeBridgeWorker` / `PixiHostWorker`) already `extends Worker → Bee` ✓. But **`TileEditorDrone` and `TouchGestureCoordinator` extend *nothing*** — plain classes that self-register in IoC despite their names, so they cannot inherit `capability`. Fix structurally: **promote them to proper `Bee` subclasses** (e.g. an editor / view-behavior base). Do not special-case the extractor to read off base-less plain classes.

### Speculative tags — real concept, no taggable bee today (do NOT add yet)

- `input:pointer` — pointer handling is distributed across `SelectionInputDrone`, `DesktopMoveInput`, `SpacebarPanInput`, `MousewheelZoomInput`; no single driver bee.
- `input:keyboard` — owned by `keymap.service.ts` (a **service**, not a Bee).
- `editor:image` — owned by `image-editor.service.ts` (a **service**, not a Bee).
- `visual:substrate` — `SubstrateDrone` is single-owner *additive* (image-fill on blank tiles); leave untagged until a second substrate-fill provider appears.

### Benign double-registrations (NOT contention)

`@diamondcoreprocessor.com/PinchZoomInput` and `@diamondcoreprocessor.com/TouchGestureCoordinator` are each registered from two modules (their own file **and** `zoom.drone.ts:865-872`). This is a deliberate tree-shaking workaround (re-importing the plain class so esbuild keeps its `new …()` side-effect) — the **same** class, last-write-wins, not two competing providers. The resolver must not mistake these for a contest.

## Explicitly NOT tagged (run-all cohorts)

These are **co-operating**, not competing — they must stay untagged so every member runs. (They keep their coarse `genotype` cohort label for visibility, which is a different mechanism.) Confirmed by the audit:

- **`sharing` (genotype) — 9 core drones + 3 relay-config queens, all required:** swarm, nostr-mesh, content-broker, follow, mesh-adapter, ambient-presence, subscribe-consent, swarm-adopt, **avatar-swarm** (note: `AvatarSwarmDrone` has `genotype='sharing'` — tagging it `render:avatar-swarm` would dispose its sharing siblings), plus use-live-relay / mesh-block / mesh-clear queens. (Also `SpotlightScrollInput` / `SpotlightService` — non-Bee, untaggable.)
- **Presentation overlay/feedback stack (4)** — `TileOverlayDrone`, `TileSelectionDrone`, `MovePreviewDrone`, and the icon-providing `TileActionsDrone` paint **distinct, non-overlapping layers** on the shared `render:host` container. They co-operate; none replaces another. The base renderer slot is already `render:tiles`.
- **Zoom/pan input feeders (5)** — mousewheel / pinch / spacebar / touch-pan delegates all feed the single `nav:zoom` / `nav:pan` state owners. The owners are the slots; the feeders are not.
- **Editor input feeders (5)** — `image-drop`, `image-paste`, `resource-attach`, link feeders supply content into `editor:tile`. Complementary, not the editor slot.
- **Icon providers (registry-fed)** — many drones register overlay icons into `IconProviderRegistry`/`ICON_REGISTRY`; they additively populate one action set.
- **`movement` (4)** — move + layout.queen + move-preview + input handlers (complementary).
- **`assistant` orchestration (7)** beyond the single `assistant:bridge` slot — conversation, atomize, structure-drop, ai-key, llm.queen, etc.
- **`meeting` (5)** — signaling, video, controls, hive WebRTC state (complementary).
- **`history` (6), `selection`, `format`, slash-command queens (~25), `notes`, `settings`, `dashboard`, `recording`, `computation`** — single-owner / additive, no competing alternative.

If a second implementation of any of these ever genuinely contends for one slot, introduce a fine-grained `capability` tag for *that specific slot only* — never tag the whole cohort.
