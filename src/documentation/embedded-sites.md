# Embedded Sites

A Hypercomb tile can carry an entire website. Navigate into it — the hex
grid hides, the site renders full-viewport, child cells become subpages.
Each cell carries **its own page**; the lineage IS the route. Authoring
happens through a Claude Code skill that reads the tile hierarchy you
hand it.

> **note:** the old single-bundle `websiteSig` model described below in
> "why per-cell instead of single-bundle" was retired. `website.queen.ts`
> now *errors* on `/website <sig>` / `/website clear`, and the renderer
> reads each cell's page directly. See ground-truth sections below.

## Runtime contract (tiny)

There is **no** site-wide bundle and **no** `websiteSig` decoration to
stamp. Instead, each cell carries its own page in one of two slots,
queried in order by the renderer (`site-view.drone.ts`):

1. The cell's `decorations` slot — a `visual:website:page` decoration
   (a signature-addressed JSON resource) whose `payload.htmlSig` points
   at the page's HTML resource. This is the visual-bee migration target.
2. The legacy `context` slot — raw HTML resource sigs. Existing pages
   live here; the renderer falls back to it when no decoration is found.

The HTML resource sig resolves to a resource in `__resources__/<sig>`.
Each cell is responsible for its own surface — there is no cascade, no
manifest, no path-table. Child cells become subpages because lineage
navigation moves between cells, and each cell's page replaces the
previous one. A link to `./team` navigates the lineage one level down,
and that cell's page mounts.

Everything you author here is content-addressed and versioned locally in
OPFS by default — the HTML resource, the decoration JSON, and the layer
that references it. Nothing crosses the network unless you publish.

The `websiteSig` property name still exists in `tile-content-renderer.ts`
(`CELL_WEBSITE_PROPERTY`) and is read only on the export side of
`snapshot()`, so vestigial values in older user data surface in the
export JSON for archaeology. `parseBundle` / `WebsiteManifest` in that
file are dead — no live path calls them.

## Rendering (what the bee does)

The surface is gated on `ViewMode`. In hexagons mode the bee tears down
regardless of what's in the cell's slots; `/website` (anything that flips
ViewMode to `'website'`) brings the page back.

```
Lineage change (or ViewMode → 'website')
  ↓
ViewMode === 'website' ? continue : teardown
  ↓
sign(lineage segments) → location sig; currentLayerAt(locationSig) → head layer
  ↓
scan layer.decorations for a visual:website:page decoration → payload.htmlSig
  ↓ (none?)
fall back to scanning layer.context for an HTML-shaped resource sig
  ↓
fetch page HTML from __resources__/<sig>
  ↓
rewrite resource:<sig> and bare-64-hex src/href refs → /@resource/<sig>
  ↓
mount inline (styles/links/scripts lifted into the live document; body
into a fixed host div), emit view:active { active: true }
```

There is no ancestor walk and no `manifest.pages[...]` lookup. The page
resolves from the current cell's head layer; the decoration scan reads
the website bee's declared `decorationKind` (`visual:website:page`) via
`VisualBeeRegistry`. The renderer mounts the HTML inline in the live
document (not a Shadow DOM): `<style>` and `<link rel="stylesheet">`
nodes are lifted into `<head>` (tagged so unmount lifts exactly those),
`<script>` nodes are recreated as live elements so they execute, and the
`<body>` content is dropped into a fixed-position host div.

The resource service worker (`hypercomb.worker.js`) serves
`/@resource/<sig>` from OPFS `__resources__/<sig>`, with an HTTP host
fallback (`GET /<sig>` against registered operator domains) on an OPFS
miss. That's the only network shape the runtime needs.

## Authoring — design-time AI loop

You build the tile tree. Claude Code builds the site.

### In the Hypercomb app

`/website` is two things in one command: a **render-surface toggle** (a
single global `ViewMode` flag — not a per-cell or per-branch marker) and
a set of **build/export** sub-commands.

```
/website                 — toggle hexagons ⇄ website view (global)
/website on|web|site|view — force the website surface ON (global)
/website off|hex|hexagons — force the website surface OFF (global)
/website here|mark       — flag THIS cell for the next gen pass
                           (drops a visual:website:pending decoration;
                            re-run to unflag)
/website list            — the gen queue: cells flagged with /website here
/website export          — dump the current subtree as JSON (to clipboard)
/website save|load       — portable .zip export/import of a branch
/website upgrade|new|build — emit website:build for the codegen pipeline
```

`/website here` does **not** flip the render surface — it drops a
`visual:website:pending` build-intent decoration on the current cell for
the next gen pass to turn into a page. It is signature-addressed and
undoable, and re-running it clears the flag.

The bundle-stamping forms (`/website <64-hex>`, `/website [sig][sig]…`,
`/website clear`) were **removed**. `website.queen.ts` now returns an
error for any of them — the messages in `parseArgs` surface the removal
if older muscle memory invokes them.

The `export` JSON is a tiny tree — paths + labels (plus any vestigial
`websiteSig` value for archaeology). No HTML, no CSS. All the AI needs is
the tree shape.

### In Claude Code

Run the skill:

```
/website-build
```

The skill (`.claude/skills/website-build/`, gitignored — local to each
checkout) takes the hierarchy JSON you paste, asks about intent / style /
scope, and:

1. Finds the cells flagged for generation (`visual:website:page` for
   regen, `visual:website:pending` for first-time build) and asks which
   to (re)generate.
2. Gathers each cell's notes and attachments as context.
3. Generates one standalone HTML page **per cell**.
4. Writes each page back: `put-resource` stores the HTML and yields its
   signature, then `decoration-add` (with `replaceKind`) attaches a
   `visual:website:page` decoration carrying `payload.htmlSig` to the
   cell's `decorations` slot.

Pages are written one cell at a time over the Claude Bridge — there is no
bundle to assemble and no `/website <sig>` stamp to paste back. The
renderer picks up each cell's page on the next Lineage tick.

### Iteration

Page generation is non-destructive — it leans on the same immutability
and content-addressing every Hypercomb artifact does (see
[dna.md](dna.md)):

- Signed content never mutates. Old sigs stay valid forever.
- Unchanged pages keep their signatures across runs — same HTML →
  same `htmlSig` → no new write. Only edited pages produce new sigs.
- Remove a tile → its cell (and its page decoration) leaves the layer,
  but the HTML resource in `__resources__/<sig>` remains (GC is a
  future concern).
- Add a tile → flag it (`/website here`) and the skill generates a page
  for it on the next pass.

## Asset reference forms

Resource refs are rewritten to `/@resource/<sig>` at render time by
`rewritePageRefs` (the render-side counterpart of the closure walk's
`extractPageRefSigs`, so the renderer and the host-push/adopt closure
resolve exactly the same set). There is **no** manifest-keyed
`asset:<name>` form — per-cell pages reference resources directly by sig:

| form in HTML / CSS                  | resolves how                            |
|-------------------------------------|------------------------------------------|
| `resource:9f2a…`                    | literal 64-hex sig (also in CSS `url(resource:<sig>)` and `resource:<sig>/chrome.css` links) |
| `<img src="9f2a…">`                 | bare 64-hex on `src` / `href` / `data-src` |
| `<a href="about">`                  | child subpage — lineage navigates down   |
| `<a href="..">`                     | parent subpage (blocked at the site-entry floor) |
| `<a href="/home">`                  | absolute lineage path                    |
| `<a href="https://…">`, `#`, `mailto:`, `tel:`, `data:` | pass through |

## Why per-cell instead of single-bundle

This feature went through two retired shapes before the current one:

1. **Cascading per-tile decorations** (`pageSig`, `templateSig`,
   `stylesheetSigs`, `scriptSigs` walking the ancestor chain). Simple
   runtime, but authoring meant stamping four decorations across many
   tiles.
2. **Single bundle** — one `websiteSig` decoration pointing at a
   concatenated-sigs resource whose first chunk was a manifest with a
   `pages[path]` table. One stamp, but a child path rendered a *blank*
   page whenever the bundle hadn't enumerated that path — links followed
   into nothing — and every edit reshuffled one monolithic artifact.

The current model gives each cell its **own** page and lets the lineage
be the route. No manifest, no path table, no cascade walk: a link to
`./team` navigates the lineage down and that cell's page mounts. This
keeps the embedded-site feature riding the same content-addressed
primitives as everything else (see [dna.md](dna.md)):

- **Immutability + dedup.** Each page is a signed HTML resource. Same
  bytes → same `htmlSig` → stored once, referenced anywhere. An edit
  produces a new sig; the old one stays valid forever.
- **Fork by sharing a sig.** A community member can adopt a page (or a
  whole branch) by resolving its signatures against their own OPFS — the
  decoration JSON and the HTML it points at travel as ordinary
  content-addressed resources through the same fetch pipeline as any
  other resource.
- **Composition over the tree.** Pages attach to cells via the
  `decorations` slot; the merkle layer tree already names the hierarchy,
  so the site's structure IS the cell structure — nothing to keep in
  sync.

## Files

- [hypercomb-core/src/tile-content-renderer.ts](../hypercomb-core/src/tile-content-renderer.ts)
  — `CELL_WEBSITE_PROPERTY` (read only on the export side), `RESOURCE_URL_PREFIX`,
  `SITE_VIEW_IOC_KEY`. `WebsiteManifest` / `parseBundle` here are vestigial —
  no live path calls them after the bundle removal.
- [hypercomb-essentials/.../presentation/tiles/site-view.drone.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/site-view.drone.ts)
  — the renderer: ViewMode gate, per-cell `decorations` → `visual:website:page`
  → `payload.htmlSig` lookup (legacy `context`-slot fallback), inline mount,
  lineage-as-routing navigation.
- [hypercomb-essentials/.../commands/website.queen.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/commands/website.queen.ts)
  — `/website` global view toggle, `here`/`mark`, `list`, `export`,
  `save`/`load`, `upgrade`/`new`/`build`. Bundle stamp/clear now error.
- [hypercomb-essentials/.../sharing/decoration-closure.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/sharing/decoration-closure.ts)
  — `rewritePageRefs` / `extractPageRefSigs`: the single source of truth for
  the resource-ref forms the renderer rewrites and the closure walk carries.
- `.claude/skills/website-build/`
  — the Claude Code skill that authors per-cell pages (gitignored — local to
  each checkout).
- [hypercomb-web/public/hypercomb.worker.js](../hypercomb-web/public/hypercomb.worker.js)
  — `/@resource/<sig>` service-worker route, OPFS `__resources__/<sig>` +
  HTTP host fallback.

## Related

- [dna.md](dna.md) — the content-addressed, merkle-versioned artifacts
  (layers, resources, decorations) embedded sites are built from.
- [trail-capsule.md](trail-capsule.md) — the route/navigation capsule
  (formerly "DNA"), distinct from the artifacts above. Embedded-site
  navigation drives the lineage, which a trail capsule can replay.

## Next steps

- **Bulk resource import** helper so the skill's output pages get into
  OPFS without hand-calling `Store.putResource` for each one.
- **Context-signature panel** — read-only UI listing reachable sigs
  (a cell's current page, prior versions) for easy copy-paste.
- **Page diff tool** so the skill can cheaply enumerate what changed
  between iterations.
- **Iframe trust tier** for untrusted pages (sandboxed; postMessage
  bridge to Lineage navigation).
