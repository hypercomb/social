# layer primitives

a layer is the atomic unit of hypercomb content. it is a snapshot of a folder at a point in time.

---

## what a layer is

a layer captures the state of a single node in the content tree. it is content-addressed — its identity is the SHA-256 signature of its canonical content. a layer holds references to bees (behavior), dependencies (namespace services), resources (static assets), and child layers. all references are signatures.

layers are not containers. they are pointers. the actual bytes live in `__bees__/`, `__dependencies__/`, `__resources__/`, and nested `__layers__/` directories. a layer file is small — it names what belongs at this location.

---

## lineage

every layer has a `lineage` — the path from the domain root to the folder it represents.

```
lineage: 'cigars/brands'
```

this means: "i am a snapshot of the `brands` folder inside `cigars`."

lineage is the local identity of a layer. it maps directly to the explorer path (`Lineage.explorerSegments`) and the OPFS folder hierarchy under `hypercomb.io/`.

### lineage as hash

the signed lineage produces the history folder name:

```
lineage:    cigars/brands
key:        "cigars/brands"
signature:  SHA-256(key) → 64-char hex
```

this signature is the local lookup key. any client that knows the lineage can independently derive the same address. no registry, no server.

### lineage vs mesh key

lineage is the **local** identity. the mesh key is the **network** identity:

```
mesh key:   space/domain/cigars/brands/secret/cell → SHA-256 → mesh signature
local key:  cigars/brands → SHA-256 → history folder name
```

the mesh key includes `space` and `secret` for swarm scoping. locally these are stripped — lineage alone is sufficient.

---

## layer shape

```
Layer {
  lineage: string          // 'cigars/brands'
  signature: string        // SHA-256 of the layer content
  bees?: string[]          // bee signatures
  dependencies?: string[]  // namespace dep signatures
  resources?: string[]     // resource signatures
  layers?: string[]        // child layer signatures
}
```

this unifies three existing types:

| existing type | fields | location |
|---|---|---|
| `LayerInstallFile` | `signature, name?, children?, bees?` | `layer-install.types.ts` |
| `LayerRecord` | `name, children[], bees[]` | `layer-graph-resolver.service.ts` |
| `LayerFile` | `signature, name?, layers?, bees?, dependencies?` | `layer-service.ts` |

what's new: `lineage` as an explicit first-class property (today it's implicit in the folder path), `resources` and `dependencies` on the unified shape.

---

## mesh flow

layers move between peers over the nostr mesh. the flow:

### 1. send to mesh by fqdn

the sender computes the mesh signature from the full fqdn key:

```
space / domain / lineagePath / secret / cell → SHA-256 → mesh signature
```

the layer file is the payload. it is published as a nostr kind 29010 event with tag `['x', meshSignature]`.

### 2. pickup

peers subscribed to the same mesh signature receive the layer. meeting at the same fqdn is sufficient trust — you don't need to verify the sender beyond nostr's Ed25519 event signature. the fact that both parties derived the same mesh key from the same space + domain + lineage + secret means they belong to the same swarm.

### 3. payload processing

the receiver reads the layer file and now knows:
- which bees to load (behavior)
- which dependencies those bees need
- which resources belong at this location
- which child layers exist below

### 4. local storage

the receiver stores the layer locally by lineage — dropping space and secret:

```
mesh (network):  __layers__/{domain}/{meshSignature}  ← includes space/secret in derivation
local (storage): __layers__/{domain}/{SHA-256(lineage)}  ← lineage only
```

this is the intermediary process: meet on mesh by fqdn, store locally by lineage. the user can later access the content without the space or secret because the lineage hash is all that's needed to find it.

---

## lazy loading

child layers referenced in `layers[]` are not fetched eagerly. they are loaded when navigation encounters them — when the user enters a child folder, the corresponding child layer is resolved.

this matches the existing pattern: `LayerFilesystemApplier` creates child folders with `-install` markers that are resolved on demand. the layer tree is walked depth-first as the user navigates.

bees, dependencies, and resources within a single layer can also be lazy-loaded based on the `beeDeps` manifest — only the deps a specific bee needs are imported before that bee loads.

---

## swarm

a swarm is the set of peers sharing layers at the same mesh signature. it is scoped by:

- **space** (room): collaborative namespace, extracted from subdomain (e.g., `myroom.hypercomb.io`)
- **secret**: optional passphrase for additional scoping
- **lineage**: the folder path

same space + same secret + same lineage + same domain = same swarm. publisher IDs (random UUIDs per client) are tagged on events for swarm size tracking.

when a peer arrives at a mesh location with no items, it sends a sync-request asking the swarm to republish.

---

## opfs mapping

```
opfsroot/
  hypercomb.io/                         # cell tree (flat content)
    cigars/                             # cell folder
      brands/                           # child cell folder
  __bees__/{signature}.js               # compiled bee modules
  __dependencies__/{signature}.js       # namespace service bundles
  __resources__/{signature}             # content-addressed static assets
  __layers__/{domain}/{signature}       # layer manifests (per-domain)
  __history__/{lineage-sig}/            # history records per lineage
```

the layer's `lineage` maps to the folder path under `hypercomb.io/`. the layer's referenced signatures map to files in the `__bees__/`, `__dependencies__/`, and `__resources__/` directories. the layer manifest itself lives in `__layers__/{domain}/`. bees are discovered via the install manifest (cached in `localStorage`), not by scanning cell folders.
