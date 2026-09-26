# The primitive: creation and host conformance audit

**2026-09-24. Status: not yet conformant end to end.** This audit covers the
minimal host, publication, cross-host discovery, local activation, and the
creation surfaces that would feed them. It records current behavior, rather
than treating an intended protocol as already shipped.

## The rule

One creation has signature-named, hash-verified payload bytes and a typed meta
envelope. A stable hashed location holds successive heads; the latest valid
head at that location is current, while earlier heads stay readable. A member
of a meaning pool makes the *location* discoverable. The publisher explicitly
turns on only the locations it offers publicly; a visitor explicitly turns on
only the offerings they take. Those choices add layers. The public host lists
only chosen offerings; signature-named bytes it already holds remain servable
to someone with their names. A runtime registry reflects the beehaviors
actually activated. A menu, package label, signed index, or in-memory Map is
not a second source of creation truth.

This is **the primitive**. Its organic behavior comes from composing typed
incidences into the hypergraph and adding layers at known locations, not from
a separate registration system for each kind of creation. The current wire
uses append-only eight-digit markers at hashed locations. The later
[molecule doctrine](hypergraph-molecule-lineage.md) specifies per-author
signed head claims and succession atoms, but says the live molecule writer is
not yet installed. Do not call a numbered marker a signed head claim or
introduce a third format during that transition. A content hash proves bytes;
the publisher's signature separately proves authority over an offered route.

## What the code does today

| Surface | Current state | Conformance gap |
| --- | --- | --- |
| Local location history | [marker writer](../hypercomb-core/src/core/location-marker.ts), [location layer](../hypercomb-runtime/src/location-layer.ts), and full [history](../hypercomb-essentials/src/history/history.service.ts) append markers; the latest marker points at immutable bytes. | This is the shipped location convention. The future signed succession migration remains separate. |
| Pure host discovery | The [shared offering reader](../hypercomb-core/src/core/host-offerings.ts), used by the shim and Angular, verifies site members, resolves the serving host's latest location marker, and checks it against the publisher's signed index. An older parent-domain portal may use the subdomain bag only when its own bag is absent. Its generic reader verifies explicitly declared creation members and their typed meta and layer bytes. The shim gallery consumes both site routes and public text themes. | A present but mismatched serving-host bag is rejected. Other creation kinds need verified reference closure before appearing here. |
| Public publication | [publishBranch](../hypercomb-essentials/src/sharing/publish-branch.ts) sends site closure bytes and updates signed `roots` and `doors`; the [worker](../hypercomb-relay/blossom-worker/worker.js) appends each signed route's hashed location marker. The explicit [text theme switch](../hypercomb-essentials/src/sharing/text-theme-offering.ts) stages the selected leaf and declares its location in the signed index; the worker projects only that verified public selection into `host:offerings`. | Other beehavior kinds still need typed closure, a public switch, and worker projection. Index and marker are separate writes; retry repairs interrupted append. |
| Public pool wire | The shim and relay use newline directory listings and hash-named members. [published-pools](../hypercomb-essentials/src/sharing/published-pools.ts) expects a JSON index file at the pool address and a bounded static member list. | Two discovery protocols. Keep the older reader for old hosts outside the new gallery; new creation types need one pool directory wire and location-head resolver. Public listing must be explicitly authorized; private pools stay private. |
| Local selection | The [pending selection pool](../hypercomb-shim/src/bootstrap/pending-selections.ts) keeps verified remote tile choices at stable locations. The source-domain update icon opens local review. [offerings](../hypercomb-shim/src/bootstrap/offerings.ts) then records adoption and appends an on/off layer at the selected local hostname after a bounded [typed site closure](../hypercomb-runtime/src/site-references.ts) verifies child layers, bees, dependencies, and declared resources. The shared [activation writer](../hypercomb-runtime/src/host-activation.ts) rejects route conflicts. The native [host](../hypercomb-client/crates/serve/src/lib.rs) serves that hostname bag, sign(<hostname>), and the activation layer its newest marker names, by signature only (no `/site.json`, 2026-09-25); the [pure native profile](../hypercomb-client/MINIMAL-PROFILE.md) uses its own hive for both the shim and host. | The browser round trip was exercised between two local hosts; the native round trip has not been exercised in a live installed binary. A separate browser's OPFS still does not feed the native host; some optional content can resolve on demand. |
| Other host UI | Angular [static peers](../hypercomb-essentials/src/sharing/static-peers.drone.ts) now discovers through the shared signed offering reader and keeps accepted heads pinned. Its `community:offers` switch still controls a shaded peer preview. | Preview must remain clearly distinct until a local route is chosen and Angular uses the shared route activation writer. |
| Text themes | [text-theme-pool](../hypercomb-runtime/src/text-theme-pool.ts) persists local `themes:text` creations; [panel groups](../hypercomb-core/src/core/panels/panel-groups.ts) projects active heads into settings. The settings window now offers a selected theme on a chosen root domain through a signed public switch. A visitor can accept its exact meta head and turn it off with a later local layer. | Current face choices remain a finite installed capability set; no other theme kind has this full public path yet. |
| Other themes | [global theme service](../hypercomb-shared/core/theme.service.ts) and [background themes](../hypercomb-essentials/src/presentation/background/background-theme.service.ts) use fixed defaults and runtime registration. | Treat defaults as seed creations and registries as projections of active, hash-verified theme locations. Registration alone is not publication. |
| Views and commands | [visual bees](../hypercomb-essentials/src/commands/visual-bee-registry.ts), [shell surfaces](../hypercomb-runtime/src/shell-surface-registry.ts), and command discovery register loaded capabilities. [side effects](../hypercomb-essentials/src/side-effects.ts) still loads fixed module sets. | Discover the available signature-named beehavior before importing code; activation then populates the existing runtime registries. The import barrel cannot be public authority. |
| Further creation menus | [Quick menus](../hypercomb-runtime/src/quick-menu-pool.ts) now seed and discover local `menus:quick` location heads; their gesture registry is a cache. [Templates](../hypercomb-essentials/src/commands/template-catalog.ts), [substrate sources](../hypercomb-essentials/src/substrate/substrate.service.ts), and [game themes](../hypercomb-essentials/src/games/arkanoid/themes/register-themes.ts) still have fixed arrays, in-memory maps, or whole-document registries. | Quick menus still need a public switch, adoption, and off layer. Adapt the remaining creation discovery to meaning-pool locations as those surfaces move into the pure host. Their live maps may remain rendering caches. |
| Package transport | `host:packages` is an ordered package inventory. | It is not the creation gallery or the template for unordered public meaning sets. |

The minimal host has a working gallery, a data-only text-theme publication and
selection path, and a browser-tested root visit, tile selection, return,
pending review, and local site replication path. The native route and visitor
bridge are wired, but a live native visit, return, and serve cycle still needs
proof before a native deployment claim.

**Generic publication boundary.** The signed hive index records branch
`roots` and `doors`. The generic creation path uses an explicit `offerings`
declaration naming the meaning, stable location, selected public host, and
meta head. Current index writers preserve uninterpreted fields from a
verified prior index, but older deployed writers would still erase a new
declaration. The publisher must stage the declared reference closure, and
the host must project only declarations switched on by the publisher. The
current worker proves this for leaf text-theme layers and hides other meanings.
A first branch publication without a signed `doors` entry is held content,
not a live site.

## Convergence order

1. **Make the remote location authoritative.** Publishing an offering must
   write its meta/payload closure, append its hashed location head, then expose
   that location through the publisher-authorized public offering set. Readers
   resolve that bag and verify the head against the publisher's claim. A
   missing or mismatched bag fails closed; the index may authorize the door
   but must not silently choose a substitute head.
2. **Complete one activation path.** A click verifies the chosen head and the
   executable references it needs, adds an on/off layer in the participant's
   hive, and makes the selected local route resolvable. Both the pure shim
   and Angular host UI call that path. A later update remains a candidate
   until another click accepts it.
3. **Publish creations generically.** A site, theme, view, tool, command, or
   later kind uses one creation writer and one explicit public switch. The
   public offering carries verified kind/title/preview metadata so the gallery
   does not infer a creation from package names or DNS labels. Sharing one
   creation exposes its chosen references, not every member of its private
   meaning pool.
4. **Make settings and menus projections.** Seed defaults through creation
   pools, read current heads, and register only the active capabilities in
   existing UI/runtime registries. A new creation should appear without
   editing a hard-coded catalog or rebuilding the minimal host.
5. **Migrate the storage dialect once.** The signed per-author succession
   model in the molecule doctrine is the forward migration. Dual-read the
   shipped marker locations while moving writers and readers together; do
   not mix claims and markers under one undocumented current-head rule.

## Acceptance checks for each creation kind

- Its bytes and typed references verify by signature before interpretation or
  execution; the same identity is readable after another revision is current.
- Its meaning pool names a stable location, and that location alone resolves
  its latest valid head. Public listing includes it only after the publisher
  switches it on.
- Another host can discover, inspect, choose, and serve the selected referenced
  closure. Switching it off adds a layer and removes it from the active view
  without erasing earlier bytes.
- A revision creates an inspectable candidate and never runs merely because
  a publisher moved a head. Settings, menus, and the root gallery all show the
  same accepted head and on/off state.
