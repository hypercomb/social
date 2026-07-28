# Swarm Participant Filter + Participant-Scoped Adoption

**Status: BUILT 2026-07-28.** Jaime's directive: in a big swarm you don't want to
adopt an entire hierarchy across everyone. Click participant names at the top to
filter the canvas to those participants' tiles; no selection = everyone shows.
Individual tile adoption is unchanged; with participants selected, one gesture
adopts their offered branches — which gets all their tiles.

## Shape

- **State** — `sharing/swarm-filter.service.ts` (`SwarmFilterService`, IoC
  `@diamondcoreprocessor.com/SwarmFilterService`), modeled on `SpotlightService`:
  a multi-select `Set<pubkey>`, **in-memory, session-only** (a filter surviving a
  reload while the peers who justified it are gone is a trap — same posture as
  spotlight and session hides). Emits `swarm:filter { participants }` (EffectBus,
  last-value replay) on every change; `reconcile()` on `swarm:peers-changed`
  drops departed pubkeys. Empty selection = no filter.

- **The authoritative filter runs at the SOURCE** — `swarm.drone.ts`
  `#registerTileSource`, before the registry's `kind:name` dedup. This is
  load-bearing for same-name tiles: if Alice and Bob both publish `dolphin` and
  only Bob is selected, the pre-dedup filter makes Bob's entry the survivor, so
  its `layerSig`/image/index are Bob's — which is also what adoption needs.
  Filtering only in show-cell would drop the tile whenever the dedup race
  happened to be won by an unselected peer.

- **Belt-and-braces in show-cell** — one more union-delete after the existing
  filter chain (`#participantFilter`, fed by `swarm:filter`), catching entries
  served from a stale `#sourceEntriesCache` in the toggle frame. Own tiles are
  never filtered (`localCellSet` guard — the selection scopes PEERS only). The
  toggle handler mirrors the `swarm:peers-changed` invalidation exactly
  (`#layerCellsCache` + `#sourceEntriesCache` + `renderedCellsKey` +
  `#slots.clear()`) — the slot machine must reseed or unselected peers stay
  painted. While a `tags:filter` flatten override is active the participant
  filter does not apply (the flatten bypasses the union chain; the two are
  mutually exclusive by design).

- **UI** — the presence banner's participant badges (the names at the top) are
  the toggles: click a peer badge (or their row label in the expanded panel) to
  select/deselect; selected identities get a visible ring. The caret expands the
  panel (expansion no longer rides badge clicks). With a selection active, an
  **Adopt n tiles** chip appears in the strip.

- **Adoption** — the chip builds participant-grouped picks from
  `peerTilesGroupedAtCurrentSig()` restricted to the selected pubkeys (only
  entries with a valid 64-hex `layerSig`) and emits the EXISTING verb:
  `tile:action { action:'adopt-selected', selections:[{label, pubkey}…] }`.
  `SwarmAdoptDrone` already folds selections sequentially; every existing gate
  (code consent, complete-or-defer closure, read-back, receipts) applies per
  branch, unchanged. Individual tile adoption keeps working exactly as before.

## Doctrine notes

- Adopt is adopt: the filter is a VIEW affordance; the chip is one gesture that
  feeds the existing adopt path — no new decision surface, no target picker.
- Nothing persists: no localStorage, no pool, no lineage writes. The filter is
  observation posture, like spotlight.
- `swarm:filter` was an unclaimed effect namespace (verified); payload is a
  plain object per convention.
