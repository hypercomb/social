# Install Push-Only Model

## 1. Motivation

Today, every Hypercomb load calls `LayerInstaller.install()` from the runtime mediator, which fetches `manifest.json` on cache miss and iterates every layer/bee/dependency to verify OPFS. Individually cheap, collectively it lives in the startup path and — more importantly — it's the window in which a stale manifest can overwrite uncommitted DCP patches.

The push-only model moves update responsibility from the receiver to the publisher. Hypercomb reads whatever is already in OPFS; updates only land when DCP explicitly pushes them. This:

- Removes a network round-trip from every page load.
- Makes uncommitted working-copy state inviolate across reloads.
- Gives the user control over *when* updates are absorbed.
- Stays cross-domain agnostic — anyone can set up their own push transport.

## 2. Core Principles

1. **Load is inert.** Hypercomb's boot path performs zero network I/O against `manifest.json`. It reads the current state from OPFS and renders.
2. **First-time bootstrap is the only exception.** If the domain's OPFS layers directory is empty, a one-shot install runs. After that, never again automatically.
3. **DCP push is the sole update path.** All changes to what Hypercomb loads flow through an explicit push action in DCP.
4. **Pull-before-push.** DCP always reconciles against Hypercomb's current state before advancing a branch. There is no such thing as a blind overwrite.
5. **Transport is pluggable.** The push *mechanism* is not prescribed. Same-origin deployments write OPFS directly; cross-origin deployments bridge via postMessage; hosted deployments upload to a storage backend. Community forks can implement whatever transport suits them.

## 3. Primitives

The entire model is four verbs:

### 3.1 Working Copy

DCP's local, uncommitted patches. Nameless, ephemeral, not a branch. Lives in `__patches__/{domain}/` as it does today.

Until a push lands, the working copy has no identity. There is no "current branch" state to track — DCP is just "editing against some base."

### 3.2 Push(label)

The commit event. Performs:

1. **Pull** — read Hypercomb's current `head.json` and the patch log at `__patches__/{domain}/`.
2. **Resolve** — compute the set difference between Hypercomb's patches and DCP's locally-known patches. Classify conflicts by comparing touched file signatures.
3. **Linearize** — append DCP's new patches after Hypercomb's new ones, producing a linear extension.
4. **Append & advance** — write the new patch records, new layer signatures, and advance the named label pointer.

If `label` does not exist, the push creates it (a new branch). If `label` exists, the push fast-forwards it (or is rejected if it's not a proper ancestor).

On conflict — two patches touching the same file signature — the push halts and surfaces to the user. The user picks theirs, picks ours, or edits the merged file manually in DCP.

### 3.3 Make HEAD

Walks along a branch's linear timeline. Takes any past state on the current branch and promotes it to HEAD by appending compensating operations. Unchanged from the existing linear-history rule. Never crosses branches — to move to a different branch, use Checkout.

### 3.4 Checkout(label)

Pulls `label`'s HEAD into DCP as the new working-copy base. Any uncommitted patches the user already has get rebased on top (same resolve step as push's step 2) or, on conflict, surfaced for manual reconciliation.

## 4. Branch Model

Branches are labels on signature-addressed HEADs. No central registry — a branch exists because a push landed. Consequences:

- **No explicit "create branch" primitive.** Push with a new label creates it.
- **No "current branch" before first push.** Working copy is branch-less until named.
- **The first-ever push on a domain is the genesis push.** No parent. Equivalent to what `manifest.json`'s root package represents today.
- **Branch discovery** = listing the labels in the push history.

### 4.1 Label Namespacing

Labels are namespaced per-user (e.g. `alice/v2`, `bob/v2`). Two DCPs pushing independently with coincidentally-identical short names do not collide; their branches coexist as distinct timelines. This preserves the coordination-free, community-fork ethos of the rest of the system.

The exact authorship scheme (Nostr pubkey, local nickname, etc.) is deployment-dependent and out of scope here. The requirement is that two independent publishers cannot silently overwrite each other's labels.

## 5. On-Disk Representation

### 5.1 `head.json`

Written to the domain's OPFS root:

```
/__head__/{domain}/head.json
```

Contents:

```json
{
  "activeLabel": "alice/v2",
  "labels": {
    "alice/v2": "a4fb477f0e7b82aead065a763f2473d8260af8c63107ac0f67fdeda1e460feef",
    "bob/experimental": "e59c800626a13b2d0c781304c5ce815b904db12c2d5ad72e95aad24f25db9dc1"
  }
}
```

`activeLabel` is the label currently rendered. `labels` is the map of all known branch tips on this domain.

Hypercomb's load path reads `head.json`, resolves `labels[activeLabel]` to a layer signature, and renders from there. That is the entire load-time protocol.

### 5.2 Patch Log

Unchanged from today — `__patches__/{domain}/NNNNNNNN` files written by `PatchStore.record()`. Already content-addressable via patch record contents. Each push appends to this log; the log is the authoritative history.

## 6. Transport Interface

The push target is resolved through IoC:

```typescript
interface PushTarget {
  publish(snapshot: Snapshot): Promise<PublishResult>
}

type Snapshot = {
  domain: string
  label: string
  baseLabel: string | null          // parent for fast-forward check; null = genesis
  newHead: string                   // root layer signature
  patches: PatchRecord[]            // new patches since baseLabel's tip
  layers: Map<string, ArrayBuffer>  // new layer bytes (content-addressed)
  bees: Map<string, ArrayBuffer>    // new bee bytes
  dependencies: Map<string, ArrayBuffer>
}

type PublishResult =
  | { ok: true, newHead: string }
  | { ok: false, reason: 'conflict', conflictingSigs: string[] }
  | { ok: false, reason: 'not-ancestor', currentHead: string }
```

### 6.1 Reference Implementations

- **DirectOpfsPushTarget** — same-origin DCP writes straight to Hypercomb's OPFS scope. Simplest case; this repo's default.
- **PostMessagePushTarget** — cross-origin DCP bridges through a hidden iframe at the Hypercomb origin. The iframe hosts a `DirectOpfsPushTarget`; messages authenticate via a preshared handshake.
- **RemotePushTarget** — hosted deployments upload to Azure/S3/whatever with `head.json` bumps. The receiving browser still runs in push-only mode; the "push" lands on the hosting bucket and any browser with a stale OPFS pulls only on first-time bootstrap.
- **NostrPushTarget** — pushes signed events to Nostr relays. Signature-addressed payloads map 1:1 to Nostr's event model. Left as a community contribution.

Community forks pick their transport by registering a different `@hypercomb.social/PushTarget` implementation. The receiver side never changes.

## 7. Load-Side Change

The minimal concrete change for this doc's load-side portion is in `runtime-mediator.ts`:

**Before:**
```typescript
await installer.install(parsed)
```

**After:**
```typescript
const head = await readHeadJson(parsed.domain)
if (!head) {
  // empty OPFS — genesis bootstrap
  await installer.install(parsed)
  await writeHeadJson(parsed.domain, { activeLabel: 'genesis', labels: { genesis: parsed.signature } })
}
// otherwise: do nothing. Load proceeds against current OPFS state.
```

No manifest fetch, no per-load layer iteration, no patch clobbering.

## 8. DCP-Side Changes

### 8.1 Save Snapshot Action

DCP gets an explicit "Save Snapshot" action (command palette + button). Prompts for a label, performs the four push steps, surfaces conflicts in the existing layer-editor UI.

### 8.2 Versions List Reframe

The `+N` hidden-versions toggle built for [home.component.ts](../diamond-core-processor/src/app/home/home.component.ts) was introduced as a garbage hider for `promoteBranchToPackage` duplicates. Under push-only, it becomes the legitimate history browser:

- **Older HEADs on the active branch** — real checkpoints, walkable via Make HEAD.
- **Tips of other branches** — divergent timelines, switchable via Checkout.

These should render as distinct UI states (checkpoint vs. branch-fork icon) once the model lands.

### 8.3 Bug Reclassification

Under push-only, the dedupe/race bugs in `promoteBranchToPackage` stop mattering — sections only exist for real HEADs, so session-garbage duplicates go away naturally. The bugs become nice-to-have cleanups rather than load-bearing fixes.

## 9. Migration

1. **Phase 1 (load-side):** gate `ensureInstall` behind empty-OPFS check. No protocol change — existing `manifest.json` remains valid for genesis bootstrap. Ship this first; it's independent and strictly removes work.
2. **Phase 2 (head pointer):** introduce `head.json`. On existing installs, synthesize a `genesis` label from the manifest root. No behavior change, just groundwork.
3. **Phase 3 (push transport):** define `PushTarget` interface, ship `DirectOpfsPushTarget`, add "Save Snapshot" action in DCP.
4. **Phase 4 (branches):** label namespacing, multi-branch `head.json`, Checkout primitive, UI reframe for the versions list.

Phases 1 and 2 are backwards-compatible. Phase 3 is additive. Phase 4 is where the user-visible branch concept appears.

## 10. Open Questions

- **Conflict resolution UI.** Current layer-editor is built for applying patches, not merging them. Needs a side-by-side or inline-diff view for conflict cases.
- **Deletions.** Signature-addressed content is append-only; "deleting" a file in a push is really "not referencing it from the new HEAD." Need to confirm garbage collection remains a separate concern (see `project_package_publish_gc` memory).
- **First-time Hypercomb load with no `manifest.json` available.** If the genesis bootstrap needs to fetch but the origin is offline, the user sees nothing. Probably fine — this matches current behavior — but worth naming.
- **Concurrent pushes to the same label.** Last-writer-wins is unsafe; the fast-forward check prevents silent clobber but leaves the second pusher stuck. A push-retry-with-rebase on `not-ancestor` would automate this; defer until we see the pattern in practice.
