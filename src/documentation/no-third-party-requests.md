# No third-party requests

**Standing rule: nothing Hypercomb serves may cause a visitor's browser to
contact a host we do not control.** Not a font, not a stylesheet, not a script,
not an image, not a preconnect hint. This holds for the app shells, the shim,
the docs site, and every page a site builder publishes.

## Why

A subresource on someone else's origin is not "just a font". Fetching it hands
that host, unavoidably and before any of our own bytes render:

- the visitor's **IP address** (approximate location, ISP, often a stable
  household identifier),
- their **User-Agent** (browser, version, OS, device class),
- the **`Referer`** — *which page of which site they were reading*,
- and a **timestamp**, joinable with everything above.

No cookie is required. IP + User-Agent + Referer is already an identifier good
enough to build a browsing profile from, and it is collected on every page load
by a party the reader never chose. A German court found exactly this
arrangement — Google Fonts on a public page — an unlawful transfer of personal
data under the GDPR (LG München I, 3 O 17493/20, 20 Jan 2022).

`rel="preconnect"` is *worse* than the stylesheet it accelerates: it opens the
TLS connection eagerly at parse time, so the disclosure happens even when the
resource is never used.

A remote `<script>` is a further step again — that is **arbitrary code
execution in our origin, delegated to a third party**. A compromised or merely
changed CDN file runs with full access to the page, its storage, and its DOM.
A floating version range (`docsify@4`, `prismjs@1`) means the bytes are
*expected* to change without us doing anything.

For Hypercomb the rule is not only legal hygiene. The project's premise is that
a participant's hive is theirs — signature-addressed, replicated between people,
with no operator in the middle. A page that phones home to a surveillance
company on load contradicts the product.

## What this means in practice

| Need | Do |
|---|---|
| A web font | Self-host it. `node scripts/fetch-fonts.cjs <dir> <family…>` |
| An icon font | Self-host **subset** to the ligatures actually rendered |
| A JS/CSS library | Vendor it into the repo at a **pinned** version |
| A font in a generated single-resource page | Inline it as a `data:` URI |
| A face we can live without | Use the system stack — it costs zero bytes |

**Never** add a `<link>`, `<script src>`, `@import`, or `preconnect` pointing
off-origin, and never "temporarily" restore one to unblock a build.

## How each surface is served today

| Surface | Fonts | Notes |
|---|---|---|
| `hypercomb-web` | `public/fonts/` — Inter (variable) + Material Symbols (subset) | ~530K total |
| `hypercomb-shim` | `public/fonts/` — same | copied to `dist/` by `build.mjs` |
| `hypercomb-dev` | `public/fonts/` — Inter, Source Serif 4, Material Symbols | |
| `hypercomb-shared` | `fonts/` — IBM Plex Mono, JetBrains Mono | pre-existing, already self-hosted |
| `hypercomb-legacy` | none | Roboto/Material Icons had no real usage |
| `documentation` | `vendor/` — docsify, prism, Inter | pinned in `vendor/VERSIONS.txt` |
| Generated sites | Fraunces inlined as `data:`; Inter → system stack | see `scripts/bridge/_site-fonts.cjs` |
| `hypercomb-client` | inherits whichever shell is staged into it | the CSP below makes the rule enforced, not conventional |

### The desktop client enforces this in its CSP

The native client is the one surface where this rule is **browser-enforced**
rather than convention-enforced: `hypercomb-client/app/tauri.conf.json` ships a
CSP, so an off-origin font or script does not merely violate doctrine — it fails
to load. That only works while the allowlist stays honest, so it was trimmed on
2026-09-01 to exactly what the code reaches:

| Removed | Why it was dead |
|---|---|
| `fonts.googleapis.com` from `style-src` / `style-src-elem` | Both shells self-host in the working tree. The two local artifacts that still name Google — `app/frontend/index.html` and `app/host-shell/index.html` — are gitignored build output staged before the migration. |
| `fonts.gstatic.com` from `font-src` | Same. |
| `fonts.googleapis.com`, `fonts.gstatic.com` from `connect-src` | Fonts never used `connect-src` in the first place. |
| `jwize.com`, `content.jwize.com`, `pluginthematrix.io` from `img-src` | Redundant: `img-src` already carries a bare `https:`, which subsumes them. |

What remains off-origin, and must not be trimmed without changing the code first:

- `frame-src` YouTube — embedded video is a real feature (`link/link-drop.worker.ts`, `editor/resource-attach.drone.ts`).
- `connect-src` `jwize.com`, `content.jwize.com`, `pluginthematrix.io`, `wss://jwize.com` — these are `BETA_FALLBACK_DOMAINS` in `sharing/content-broker.drone.ts` plus the mesh relay.
- `img-src https:` — user content legitimately points at pictures anywhere. Narrowing this breaks hives, not trackers.

**This trim depends on the self-hosting migration being committed.** At the time
it was made, `hypercomb-shim/index.html` and `hypercomb-web/src/index.html` still
linked Google Fonts at HEAD — the switch to `fonts/fonts.css` was uncommitted, and
the woff2 subsets under `public/fonts/` were untracked. CI builds from HEAD, not
from a working tree, so a client build made before that lands ships a shell that
asks for Google Fonts under a CSP that now forbids it: Inter falls back to the
system stack and every Material Symbols icon disappears. Commit the fonts (the
`.woff2` files included — `git add` them explicitly, they are new) before or with
this CSP.

A stale build artifact is not evidence. Both files that appeared to contradict
this rule were months-old staged output; check the SOURCE and the file date
before concluding a surface still reaches off-origin.


### Fonts

`scripts/fetch-fonts.cjs` downloads woff2 subsets at **build time on a
developer's machine** and commits them. It is the one place a
`fonts.googleapis.com` URL may legitimately appear — it never ships, and no
visitor ever contacts Google.

Use **variable** axes (`wght@300..700`) rather than a list of static weights:
one file per subset instead of one per weight. Inter dropped from ~330K to 47K
that way.

### The icon font is subset — this has a failure mode

Material Symbols ships as **375 of ~4300 glyphs** (399K instead of 3.9MB).
Glyphs resolve by **ligature** — the element's text content *is* the glyph name:

```html
<span class="mat-sym">settings</span>
```

An icon that is not in the subset fails in one of two ways, and which one you
get is decided by a single line of SCSS:

- **Almost everywhere it renders as the NAME.** The global `.mat-sym` rule in
  `hypercomb-shared/styles/_material-tokens.scss` is
  `font-family: 'Material Symbols Outlined', system-ui`, so a glyph the font
  lacks falls through to system-ui and the ligature arrives as a readable
  English word sitting in the UI. This reads as a layout bug, not a font
  problem, which is why `nearby` and `subject` survived review.
- **In the icon picker it renders as blank space.**
  `icon-picker.component.scss` re-declares `.mat-sym` with no fallback
  family, so there a missing glyph shows nothing at all.

Neither one errors. `icons.spec.ts` is what catches them.

Two things feed `scripts/icon-names.cjs`, and the first is the one that bites:

1. **`hypercomb-shared/ui/icon-picker/material-icon-names.ts`** — 309 names the
   icon picker offers. Every one is selectable at runtime and may already be
   sitting on a tile, so all of them must ship whether or not any template
   mentions them. The first cut of this subset missed that file and blanked the
   entire picker grid.
2. Names statically provable from templates and TS.

`scripts/icon-names.extra.txt` adds a small margin for icons built in ways the
extractor cannot see (`el.textContent = …`, data tables).

**There is a hard ceiling.** Google ignores `?icon_names=` once the URL passes
~4.3KB and silently serves the whole 3.9MB font — a 10× regression no render
check can catch, because the full font resolves everything. `fetch-fonts.cjs`
refuses to ship that (`URL_LIMIT`, plus a check for the `/* fallback */` marker).
Today: ~375 names / ~3.7KB, ceiling ~430. Past that, subset locally with
harfbuzz/fontTools rather than reaching for a longer URL.

After adding an icon, regenerate the shells:

```bash
node scripts/fetch-fonts.cjs hypercomb-web/public/fonts inter material-symbols
```

Two checks guard this, both non-zero on failure — run them in CI:

```bash
node scripts/check-icon-subset.cjs   # list vs list: is any shell stale?
node scripts/check-icon-render.cjs   # renders every ligature in a real browser
```

The render check is the stronger one: it caught four names the extractor had
wrongly harvested from function arguments and test fixtures. Neither check can
see a missing *source* of icon names, though — only `audit-icon-coverage.cjs`
compares the shipped subset against Google's full name list:

```bash
node scripts/audit-icon-coverage.cjs   # what real icon names does source use that we do not ship?
```

## Verifying

Source must stay clean. Build output (`*/dist/`,
`hypercomb-client/app/frontend/`, `.angular/`) is generated and regenerates
clean — do not patch it by hand.

```bash
grep -rn "fonts\.googleapis\|fonts\.gstatic\|jsdelivr\|unpkg\|cdnjs\|googletagmanager" \
  hypercomb-web/src hypercomb-shim hypercomb-dev/src hypercomb-shared \
  hypercomb-essentials/src documentation scripts \
  --include="*.html" --include="*.ts" --include="*.css" --include="*.scss" --include="*.cjs" \
  | grep -v "/dist/" | grep -v "scripts/fetch-fonts.cjs"
```

The truthful check is the network panel: load the page, filter by domain, and
confirm every request is same-origin.

## Known gaps

- **No page-level CSP.** `hypercomb-web/public/_headers` sets
  `X-Content-Type-Options` and `Referrer-Policy: no-referrer` but governs only
  static assets — the document's policy is attached by the Worker. A
  `font-src 'self'; script-src 'self'` there would make this rule
  browser-enforced instead of convention-enforced, so a future edit could not
  quietly undo it. Worth doing; needs care around inline bootstrap scripts,
  wasm (Pixi), blob workers, and `connect-src` for nostr relays.
- **Pixi's KTX/Basis transcoders** name `cdn.jsdelivr.net` inside pixi's own
  source. Both vendor builds now rewrite those 4 URLs to `/vendor/transcoders/`
  with a counted assertion, alongside the existing WebGL2 probe patch. The
  **checked-in `public/vendor/pixi.runtime.js` still carries the old URLs until
  `npm run build:vendor` is re-run** — harmless in the meantime, since nothing
  loads a `.ktx2`/`.basis` texture, but re-run it before the next deploy. If
  compressed textures are ever adopted, the transcoders must be vendored to
  that local path.
