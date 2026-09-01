# Example Hives on First Boot

**Status: BUILT + VERIFIED 2026-07-28.** Authored (`scripts/build-example-hives.ts`,
art from `scripts/example-hives-art.cjs`), published to content.jwize.com
(all three heads + covers verified 200), offered by
`sharing/example-hives.worker.ts` + the `hc-example-hives-offer` shell surface,
with its behaviour tile at `behaviors/swarm/example-hives`. Verified on a fresh empty-root
origin: offer appears, Add folds honey-garden (7 tiles, images stream from the
CDN, in-layer marks travel), dismiss persists, reload re-offers nothing and the
adopted content is durable.

A brand-new Hypercomb install lands in something alive instead of an empty canvas:
a small set of published example hives is **offered** on first boot, and adopting
one rides the existing adopt machinery — gated on the participant's explicit
accept, never auto-written into their tree.

## 1. The shape

Three legs, all reusing existing primitives:

1. **Authoring** — the example hives are ordinary branches in the authoring hive
   (built over the Claude bridge, ws:2401), under one parent branch `examples`.
   Each example is small (≤ 9 tiles), media-rich (every tile carries an image),
   and mobile-friendly (every content tile carries the `mobile:friendly`
   pheromone from the mobile experience plan, so the mobile load gate renders it
   the moment it folds — tags are in-layer and travel with adoption).

2. **Publishing** — `npx tsx scripts/publish-content.ts /examples/<name> --r2`
   per example. The existing one-command publish: re-links the chain, walks the
   closure (layers, decoration records, tile-properties image sigs — the walk
   mines every embedded 64-hex ref), pushes missing sigs to the relay and the
   public CDN (content.jwize.com = Blossom worker over R2), then resolves and
   verifies the branch **head** (the sig the parent points at — what a consumer
   folds).

3. **The first-boot offer** — the web shell ships a data file listing the
   published heads. When the app is up and the participant's hive root is empty,
   an offer card appears. Accepting an example folds it through
   `SwarmAdoptDrone` exactly like any other adopt. Dismissing persists a flag
   and nothing is ever written.

## 2. The examples manifest (data, not code)

`hypercomb-web/public/examples.json` — deployed with the shell, fetched
lazily (`no-store`) only after the empty-root check passes. Signatures live in
this data file, never hardcoded in TypeScript (doctrine ratchet). Absent file
(dev shell, offline) → no offer, no error.

```json
{
  "version": 1,
  "domains": ["jwize.com", "content.jwize.com"],
  "examples": [
    {
      "name": "<branch child name — becomes the adopted tile's name>",
      "head": "<64-hex head sig>",
      "tiles": 8,
      "coverSig": "<64-hex image resource sig, resolvable on the CDN>",
      "description": { "en": "…", "ja": "…" }
    }
  ]
}
```

Descriptions are data (per-locale strings in the manifest) because they must
render *before* adoption; everything else about an example — notes, images,
structure — lives in the hive branch itself and arrives with the fold.

## 3. First-boot detection

- Runs **after** boot (never on the ensure-install critical path — that code
  runs before the import map and before any drone exists). Home: an essentials
  worker (`sharing/example-hives.worker.ts`), self-registering like
  `MeetingInviteWorker` — the same pattern the static-hive visit path uses.
- Emptiness is read through the canonical placement API and is
  **cold-miss-aware**: `resolveLayerAt(history, lineage.domain, [])` returning
  `null` on a fresh install is empty; a present root layer counts as empty only
  when `childNamesOfStrict(history, root)` yields `{ names: [], coldMiss:
  false }`. A cold read that merely *looks* empty must never offer (it would
  show the card to a participant who already has a hive).
- Gate: empty root + offer not previously dismissed
  (`hc:example-hives:dismissed`, participant-local localStorage — no new pool
  of meaning) + `/example-hives.json` reachable → emit the offer effect
  (`examples:offer`, EffectBus with last-value replay).

## 4. Adoption path (the existing machinery, untouched)

On accept for example `e` (all via IoC — `SwarmAdoptDrone.adoptResolvedBranch`
is a public instance API, the exact call the publish script's consumer line
uses):

```
ContentBrokerDrone.noteDomainsForSig(e.head, manifest.domains)   // tier-2.5 host hint; works on loopback + private mode
SwarmAdoptDrone.adoptResolvedBranch(
  { layerSig: e.head, at: [], domain: manifest.domains[0], label: e.name },
  { silent: true },   // no Beehaviors panel routing for a fresh user's content-only fold
)
```

- The broker pulls the layer closure (`layersOnly` — resources stream at render
  over HTTP from the noted domains; `hc:known-domains` persistence keeps them
  resolving across reloads, and `noteDomainsForSig` pushes the host to the
  service worker for `/@resource/` requests).
- The fold is the same complete-or-defer `#commitBranch` cascade every adopt
  uses: `importTree` children-by-name, read-back verified, `markAdoptedRoot`,
  sync receipt, `fs:changed` + processor act. Outcomes surface honestly:
  `committed`/`exists` close the card entry; `unavailable` (retry ladder armed)
  shows a waiting state with counts from the broker's `adopt:progress` effect.
- The examples are content-only **by construction** (no bees, no dependencies,
  and no website-page slots — so the foreign-content review gate has nothing to
  gate; images and notes render ungated). If a future example ever declared
  code, the drone's existing consent gate would fire — nothing here bypasses
  it.
- **Never auto**: the fold happens only on the participant's click. A dismissed
  card discards everything. No passive close ever folds (install-gated-on-accept
  doctrine). The empty-root gate means the card can never appear over existing
  content, so the sync-mode "re-home over same-named root child" edge cannot
  arise.

## 5. UI surface

- `ExampleHivesOfferComponent` in `hypercomb-shared/ui` — registered via
  `registerShellSurface()` + the shell-surfaces barrel (never an `<hc-*>` tag in
  either `app.html`; web/dev parity for free).
- Cold, clean chrome. Per example: cover image (fetched from the CDN by
  `coverSig`), name, description, tile count, one **Adopt** button. One quiet
  **Start empty** dismiss.
- Adopt shows progress with counts (loaders always show counts) and closes when
  the fold lands.
- Every string through i18n (`en.json` + `ja.json`).

## 6. Doctrine compliance

- **OPFS**: nothing wipes, nothing writes outside the adopt fold. Verification
  is signature comparison, never storage clearing.
- **No new pools of meaning**; the dismissed flag is participant-local
  localStorage.
- **No hardcoded 64-hex sigs in code** — heads live in `examples.json`.
- **Adopt is adopt** — one gesture folds; no merge surface, no target picker.

## 7. Authoring notes

- Example content tiles each carry: an image (sig-addressed resource referenced
  from tile properties), a note explaining what the tile demonstrates, and the
  `mobile:friendly` tag. The branch root carries a group signature
  (`group:examples:<name>`) on every member so each example adds/deletes as one
  unit.
- Images are generated locally (pure-node PNG writer) — no external fetches, no
  licensing questions, honey-and-hex generative art.
