# decentralized angular hosting via hypercomb

theoretical exploration: can hypercomb absorb external angular applications and run them decentrally with no backend?

---

## what already exists

the infrastructure is surprisingly close to supporting this:

- **signature-addressed opfs storage** -- any content (js, assets, json) can be stored and verified
- **import map injection** (`resolve-import-map.ts`) -- dynamic module resolution at runtime
- **manifest-driven install** (`ensure-install.ts` + `LayerInstaller`) -- declarative "what to install"
- **nostr mesh** -- p2p distribution of content signatures to peers
- **bee lifecycle** -- workers boot once, drones react continuously

---

## question 1: absorbing an external angular app

### step 1: build pipeline adapter

take any `ng build` output (the `dist/` folder) -- it produces:

- `main-{hash}.js` (compiled app)
- `polyfills-{hash}.js`
- `styles-{hash}.css`
- `chunk-{hash}.js` (lazy routes)
- `assets/` folder

sign each artifact with `SignatureService.sign()` to get content-addressed filenames.
generate an `install.manifest.json` with these as `dependencies` entries.
package the angular app's compiled output the same way essentials are packaged today.

### step 2: host bee (a worker)

a new worker bee (`AngularHostWorker`) whose `act()`:

1. creates a dom container (shadow dom or dedicated `<div>`)
2. injects the absorbed app's styles
3. calls `bootstrapApplication(AbsorbedAppComponent, absorbedAppConfig)` targeting that container
4. the absorbed app runs inside the hypercomb shell as a bee-managed subsystem

angular's `bootstrapApplication` accepts a `providers` array that can include custom `APP_BASE_HREF`, custom `Router`, etc.

### step 3: api replacement layer

the hardest problem. real angular apps call http backends.

**strategy 1: opfs layer interceptor (reads)**

```typescript
@Injectable()
class OpfsHttpInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<any>, next: HttpHandler) {
    const mapping = this.apiMap.resolve(req.url)
    if (!mapping) return next.handle(req)
    const layerData = await this.store.readLayer(mapping.lineage)
    return of(new HttpResponse({ body: layerData, status: 200 }))
  }
}
```

api mapping manifest declares endpoint-to-lineage mappings:

```json
{
  "/api/products": { "lineage": "shop/products", "type": "collection" },
  "/api/products/:id": { "lineage": "shop/products/{id}", "type": "document" },
  "/api/categories": { "lineage": "shop/categories", "type": "collection" }
}
```

handles read-heavy apps (blogs, catalogs, docs) with zero network.

**strategy 2: nostr event interceptor (writes)**

for post/put/delete mutations:

- publish mutation as nostr event (kind 29010)
- write locally to opfs immediately (optimistic)
- return success response
- peers receive mutation via mesh subscription

gives optimistic local writes + eventual p2p propagation.

**strategy 3: service worker proxy (transparent)**

the service worker intercepts `fetch` events and serves from opfs. no angular-side changes needed. works for absorbing apps you can't modify.

best approach: strategy 1+2 for angular-aware apps (observability via interceptor chain). strategy 3 for unmodifiable apps.

### step 4: asset resolution

images, fonts, etc. resolve from opfs `__resources__/` instead of http paths.
options: angular `APP_INITIALIZER` to rewrite asset base urls, or a custom `UrlSerializer`.

### step 5: data shape translation

real apis return domain-shaped json. opfs layers store hypercomb-format data. a schema adapter bridges this:

```json
{
  "lineage": "shop/products",
  "schema": {
    "source": "layer",
    "transform": {
      "id": "$.seed",
      "name": "$.properties.name",
      "price": "$.properties.price",
      "image": "$.resources[0]"
    }
  }
}
```

the interceptor applies jsonpath-style transforms so the absorbed app sees the data shape it expects.

---

## question 2: angular runtime outside web/dev projects

### current coupling points

the angular runtime depends on:

1. `bootstrapApplication()` -- needs a dom and a root component
2. `appConfig` providers -- `sharedProviders`, `provideRouter`, `provideZoneChangeDetection`
3. `ioc.web.ts` -- sets up `window.ioc` (side effect import)
4. build system -- `ng build` / `ng serve` with `angular.json` config

### what's actually hard-coded

very little. the `App` component in both `web` and `dev`:

- calls `startRegisteredBees()` which iterates `window.ioc` entries
- dispatches `synchronize`
- that's it -- the rest is bee-driven

the `appConfig` is:

```typescript
providers: [
  ...sharedProviders,           // ioc bridge -- generic
  provideZoneChangeDetection(), // angular standard
  provideAppInitializer(...),   // registers bee resolver -- generic
  provideRouter(routes),        // only this is app-specific
]
```

### key insight: `bootstrapApplication` is just a function

it doesn't care where it's called from. a bee's `act()` can call it. the only requirements:

- a dom element exists to render into
- angular packages are importable (via import map)
- a root component class is available (loaded from opfs)

the `web` and `dev` projects are just two specific bootstrappers. a bee is a third bootstrapper.

### angular as dependency bundles

**approach: per-package bundles with shared core (recommended)**

create separate bundles, resolve internal cross-references via import map:

```typescript
// build @angular/core as standalone
await build({
  entryPoints: ['@angular/core'],
  bundle: true, format: 'esm',
  external: [],
  outfile: 'vendor/angular-core.runtime.js',
})

// build @angular/common, keeping @angular/core external
await build({
  entryPoints: ['@angular/common'],
  bundle: true, format: 'esm',
  external: ['@angular/core'],
  outfile: 'vendor/angular-common.runtime.js',
})

// build @angular/router, keeping core+common external
await build({
  entryPoints: ['@angular/router'],
  bundle: true, format: 'esm',
  external: ['@angular/core', '@angular/common'],
  outfile: 'vendor/angular-router.runtime.js',
})
```

import map resolves cross-references:

```json
{
  "@angular/core": "/vendor/angular-core.runtime.js",
  "@angular/common": "/vendor/angular-common.runtime.js",
  "@angular/platform-browser": "/vendor/angular-platform-browser.runtime.js",
  "@angular/router": "/vendor/angular-router.runtime.js"
}
```

this is the **same pattern** `resolveImportMap()` already uses for opfs dependencies -- each dep has an alias extracted from `// @namespace/alias` in the first line.

### integration with existing pipeline

for opfs distribution (not just static serving):

1. sign each angular bundle -> get signature
2. store in `__dependencies__/{sig}.js` with first-line alias comment: `// @angular/core`
3. add to `install.manifest.json` dependencies array
4. `resolveImportMap()` discovers them automatically during opfs scan
5. `DependencyLoader` loads them like any other namespace dep

no code changes needed in the loader pipeline.

### the aot catch (non-issue)

angular's aot compiler produces code that:

- references `@angular/core` by bare specifier (import map resolves this)
- uses angular's internal symbols like `defineComponent`, `elementStart` (exports of `@angular/core`)
- embeds component metadata at build time (no runtime compilation needed)

aot-compiled angular output is pure esm. the import map handles it naturally.

---

## the "hypercomb app container" vision

combining both answers:

```
Layer: "absorbed-app"
+-- manifest.json (routes, api mappings, component registry)
+-- __dependencies__/
|   +-- angular-core.{sig}.js
|   +-- angular-router.{sig}.js
|   +-- app-vendor.{sig}.js
+-- __bees__/
|   +-- angular-host.{sig}.js  (worker: bootstraps the app)
+-- __resources__/
|   +-- styles.{sig}.css
|   +-- logo.{sig}.png
+-- components/
    +-- home.{sig}.js
    +-- about.{sig}.js
    +-- dashboard.{sig}.js
```

the `angular-host` worker bee:

1. reads the app manifest from its layer
2. ensures angular runtime deps are loaded (via `#ensureDeps`)
3. builds an import map for the app's internal modules
4. creates a dom container
5. calls `bootstrapApplication(rootComponent, config)`
6. registers an httpinterceptor that resolves from opfs/nostr instead of http

the absorbed app runs inside hypercomb -- no server, location-aware via opfs lineage, distributable via nostr mesh.

---

## multi-app import map namespacing

### the collision problem

if two absorbed apps both use `@angular/core` but different versions, or both export a `ProductService`, the import map can't resolve both.

### solution: scoped import maps

the import map spec supports scopes:

```json
{
  "imports": {
    "@angular/core": "/vendor/angular-core-v21.runtime.js"
  },
  "scopes": {
    "/apps/shop/": {
      "@angular/core": "/vendor/angular-core-v19.runtime.js",
      "shop-services": "blob:opfs-sig-abc..."
    },
    "/apps/blog/": {
      "@angular/core": "/vendor/angular-core-v21.runtime.js",
      "blog-services": "blob:opfs-sig-def..."
    }
  }
}
```

each absorbed app gets a scope prefix based on its layer lineage. `resolveImportMap()` would be extended to emit `scopes` entries per absorbed app.

for the common case (all apps on same angular version), no scoping needed -- they share the same runtime bundles.

---

## feasibility summary

| piece | status | effort |
|-------|--------|--------|
| opfs storage for any content | **exists** | -- |
| signature verification pipeline | **exists** | -- |
| import map injection for dynamic deps | **exists** | -- |
| nostr mesh for p2p distribution | **exists** | -- |
| angular runtime as dep bundle (per-package) | **straightforward** | ~1 day |
| host worker bee calling `bootstrapApplication` | **straightforward** | ~1 day |
| `ng build` to hypercomb manifest converter | **medium** | ~2-3 days |
| opfs httpinterceptor (reads) | **medium** | ~2-3 days |
| nostr httpinterceptor (writes) | **complex** | ~1 week |
| service worker proxy (transparent) | **medium** | ~3-4 days |
| scoped import maps for multi-app | **spec-supported** | ~2-3 days |
| schema adapter (api shape translation) | **complex** | per-app |

the architectural foundation is solid. the gap is the data layer -- bridging http-centric apps to opfs+nostr. the angular hosting itself is the easy part.
