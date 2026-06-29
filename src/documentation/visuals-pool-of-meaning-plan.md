# Visuals Pool of Meaning — Exact Build Plan

> **status: SUPERSEDED / PARKED (2026-06-27).** The "Index" section below (a
> per-lineage sigbag) is **wrong** — it predates the catch-all + `sign(meaning)`
> resolution. Visuals are **parked behind the storage migration** (see
> `sign-meaning-pool-migration-plan.md`); they were never the right place to
> improvise storage. Kept only for the render-hook detail (write after
> `loadCellImages`, before the supersede guards) and the field projection, which
> remain valid. Do not build from the storage parts here.

## Goal

Passivate a scope's children-visuals as a **shareable, derived member** so a
**cold reload** — and a **peer** — render from one content-addressed blob
instead of re-resolving each child's props. Pool-of-meaning model, not a folder.

## Why the first attempt was wrong (do not repeat)

1. **`__visuals__` named folder** → violates "no folders-as-meaning; the sigbag
   max IS the root" (`history-sigbag-as-root.md` §1–2).
2. **`parentLayerSig` key** → content-addressing **forbids** parent-pointers (a
   parent's sig hashes its children; a child naming its parent is circular,
   §4). "Up" is a **time query**, never a stored reference.
3. **`__optimization__` is the wrong home** → that namespace is the firewall
   that keeps optimizations OUT of host-sync + swarm publish (funny-gauss
   Phase-0 comment). Visuals must be **swarm-shareable**, so they cannot live
   there. `__optimization__` is for the private, add-only feedback/Q&A **set**.

## The corrected storage shape

```
MEMBER (the data, shareable)        INDEX (current per scope, local)
__resources__/<memberSig>           per-lineage visuals sigbag
  { kind:'visuals',                   <ns>/<lineageSig>/0000
    appliesTo:[…path],                <ns>/<lineageSig>/000x  ← max = CURRENT
    version:1,
    payload:[ {label, imageSig?,      each marker = { visuals:<memberSig> }
      borderColor?, hasLink?,         points INTO __resources__
      hasSubstrate?, hideText?,
      hasBranch?}, … ] }
```

- **Member** = the visuals collection, **content-addressed in the SHARED
  `__resources__` pool** (swarm-pullable by sig, self-healing on render,
  deduped). Built with the signature-node pattern (`CAPTURE → SIGN →
  REFERENCE`). `appliesTo` lives **inside the bytes**, so the member is
  self-describing.
- **Index** = the scope's **own per-lineage sigbag** — `lineageSig =
  sign(path)` (the scope's identity, **NEVER a parent**) → `000x` markers,
  **max marker = current visuals**. The sanctioned sigbag primitive (same as
  `__history__`), separate namespace (optimization purity), append-only.
  Snapshot-first reads only the max; the future incremental stack uses the
  whole chain — "optimizations are layers that stack" = the sigbag IS the
  stack.

Invalidation is structural: `lineageSig` (path) is **stable**; when the
children change, a **new marker** is appended and max moves. No content-sig
folder key, ever.

## Phases

### Phase A — Member write (the passivation, snapshot-first)

1. **`VisualsNode`** (essentials, `presentation/tiles/visuals-node.ts`):
   - `capture(appliesTo: string[], cells: Cell[]) → memberSig`: build the
     record, `store.putResource(blob)`, return the sig.
   - `resolve(memberSig) → payload | null`: `store.getResource`, parse.
2. **Per-scope visuals-sigbag API** (the one net-new storage piece; mirror the
   history-sigbag marker mechanics, separate shareable namespace):
   - `appendVisualsMarker(lineageSig, memberSig)`: append a `000x` marker
     `{ visuals:<memberSig> }`. Dedup: if max already points at `memberSig`,
     no-op (no churn).
   - `currentVisualsMember(lineageSig) → memberSig | null`: read the max marker.
3. **Render hook** (already validated on the dev shell): in `streamCells`,
   **right after `await loadCellImages(allCells, dir)` and BEFORE the
   `if (superseded()) return` guards** — a superseded stream's cells still match
   the path captured at call time. Compute `lineageSig = sign(currentPath)`
   (the scope's path sig, **not** parentLayerSig), `memberSig = await
   VisualsNode.capture(path, allCells)`, `appendVisualsMarker(lineageSig,
   memberSig)`. **Idle-scheduled, best-effort, off the critical path.**

### Phase B — Member read (the speedup)

On cold render, before the per-child resolve: `memberSig =
currentVisualsMember(lineageSig)`; if present, `payload =
VisualsNode.resolve(memberSig)`; **seed the per-label caches**
(`cellImageCache`, `cellBorderColorCache`, `cellLinkCache`,
`cellHideTextCache`, `cellSubstrateCache`) from the payload so the existing
fast-path renders from them. **Guard:** if the payload's labels don't cover the
current children, fall through to today's path (self-healing).

### Phase C — Swarm sharing

The `memberSig` rides the broadcast/observe meta (the name-first
advertisement). A peer pulls the member from `__resources__` by sig — no
re-render. (No separate transport; the resource pool already self-heals.)

### Phase D — Incremental stack (future)

Append a **delta** member per change instead of a full snapshot; current =
compose the sigbag's markers.

## Reused vs net-new

- **Reused:** `putResource`/`getResource` (shared content pool); the validated
  render hook; the signature-node pattern; the cell→visual projection.
- **Net-new:** the per-scope visuals-sigbag API (the index) — mirrors the
  `__history__` marker write/read in a separate, shareable namespace.

## The one decision to confirm

The index is a **per-lineage sigbag** (sanctioned, like `__history__`), keyed by
`lineageSig`. `history-sigbag-as-root.md`'s end state is "sigbags at the root,
no typed folders" — **not built yet**. So either:
- **(rec.)** build it now as a per-lineage sigbag in its own namespace
  (`lineageSig`-keyed, not a flat parent-keyed bag — that was the rejected
  `__visuals__`), and let the eventual sigbag-as-root collapse re-home it with
  every other sigbag; or
- **wait** for sigbag-as-root so the visuals sigbag lands at the root with the
  rest.

## Guardrails

- No named meaning-folder; no parent key (`lineageSig` only).
- Member in `__resources__` (shared) — **not** `__optimization__` (firewalled).
- Off the render critical path (idle, best-effort, additive — a miss falls
  through to today's path; cannot regress rendering).
- Distinct from funny-gauss's per-scope `__optimization__` **set** (feedback/Q&A,
  private); visuals are the **derived, shareable** sibling.
