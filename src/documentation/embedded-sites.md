# Embedded Sites

A Hypercomb tile can carry an entire website. Navigate into it — the hex
grid hides, the site renders full-viewport, child cells become subpages.
One decoration, one bundle, one signature. Authoring happens through a
Claude Code skill that reads the tile hierarchy you hand it.

## Runtime contract (tiny)

A cell has **one** decoration:

```
websiteSig: <64-hex>
```

That signature points to a **bundle resource** in OPFS. The bundle's
bytes are a concatenation of 64-char signatures, no delimiters:

```
<manifestSig><assetSig1><assetSig2>…<assetSigN>
```

The first 64 chars always resolve to a JSON manifest:

```json
{
  "version": 1,
  "title":   "My Site",
  "pages":   { "": "<sig>", "home": "<sig>", "about/team": "<sig>" },
  "assets":  { "style.css": "<sig>", "hero.png": "<sig>" },
  "entry":   "<sig>"
}
```

Nothing more. The `websiteSig` decoration cascades to descendants: a
tile inherits the nearest ancestor's bundle. That's how child cells
become subpages — the renderer computes `pagePath = lineagePath − siteRootPath`
and looks up `manifest.pages[pagePath.join('/')]`.

## Rendering (what the bee does)

```
Lineage change
  ↓
walk root → current, find nearest ancestor with websiteSig
  ↓
fetch bundle → parseBundle() → list of sigs
  ↓
fetch sigs[0] → manifest JSON
  ↓
manifest.pages[relativePath] ?? manifest.entry → page sig
  ↓
fetch page HTML
  ↓
rewrite resource:<sig>, asset:<name>, bare-64-hex refs → /@resource/<sig>
  ↓
shadow DOM render, emit view:active { active: true }
```

The resource service worker already serves `/@resource/<sig>` from
OPFS `__resources__/<sig>` with content-type inferred from URL tail
or blob mime. That's the only network shape the runtime needs.

## Authoring — design-time AI loop

You build the tile tree. Claude Code builds the site.

### In the Hypercomb app

```
/website                 — snapshot the subtree hierarchy to clipboard
/website <64-hex>        — stamp a bundleSig onto this cell
/website clear           — remove the decoration
```

The export is a tiny JSON — paths + labels + any existing `websiteSig`.
No HTML, no CSS. All the AI needs is the tree shape and whatever the
previous bundle decoded to (if one exists).

### In Claude Code

Run the skill:

```
/website
```

The skill ([src/.claude/commands/website.md](.claude/commands/website.md))
takes the hierarchy JSON you paste, asks about intent/style/scope, and:

1. If `currentWebsiteSig` is present, unpacks the previous bundle (you
   hand it the bundle string or the files on disk) so it can iterate
   rather than regenerate.
2. Writes page and asset files to a directory you pick.
3. Computes SHA-256 signatures for each file.
4. Emits a manifest JSON, signs it, builds the bundle string, signs
   that → final `websiteSig`.
5. Prints `websiteSig: <64-hex>`.

Paste that back into the app: `/website <64-hex>`. Stamp lands, bee
picks up on the next Lineage tick, site renders.

### Iteration

Each `/website` invocation is non-destructive:

- Signed content never mutates. Old sigs stay valid.
- Unchanged pages keep their signatures across runs — only edits
  produce new sigs.
- Remove a tile → its page sig disappears from the new manifest but
  the blob in `__resources__/` remains (GC is a future concern).
- Add a tile → the skill generates a new default page for it.

## Asset reference forms

All of these are rewritten to `/@resource/<sig>` at render time:

| form in HTML / CSS          | resolves how                             |
|-----------------------------|-------------------------------------------|
| `asset:style.css`           | `manifest.assets["style.css"]`            |
| `resource:9f2a…`            | literal 64-hex sig                        |
| `<img src="9f2a…">`         | bare 64-hex on src/href/data-src          |
| `<a href="about">`          | child subpage — routed through Lineage    |
| `<a href="..">`             | parent subpage                            |
| `<a href="/home">`          | absolute within the site                  |
| `<a href="https://…">`      | pass through                              |

## Why single-bundle instead of cascading decorations

The first iteration of this feature used per-tile `pageSig`,
`templateSig`, `stylesheetSigs`, `scriptSigs` that cascaded down the
ancestor chain. Runtime was simple but authoring required stamping
four decorations across many tiles.

Collapsing to one decoration:

- Runtime shrinks — no cascade walk, no template nesting, no chain
  composition. One read, one parse, one HTML render.
- Authoring moves entirely to design time, where an AI can produce
  cohesive HTML/CSS in one pass rather than the user hand-composing
  fragments across tiles.
- Bundles are a single shippable artifact — a community member can
  fork a site by sharing one sig.

## Files

- [hypercomb-core/src/tile-content-renderer.ts](../hypercomb-core/src/tile-content-renderer.ts)
  — `CELL_WEBSITE_PROPERTY`, `WebsiteManifest`, `parseBundle`, renderer primitives.
- [hypercomb-essentials/.../presentation/tiles/site-view.drone.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/presentation/tiles/site-view.drone.ts)
  — ancestor walk, bundle load, manifest resolve, Shadow DOM render.
- [hypercomb-essentials/.../commands/website.queen.ts](../hypercomb-essentials/src/diamondcoreprocessor.com/commands/website.queen.ts)
  — `/website` export / stamp / clear.
- [.claude/commands/website.md](../.claude/commands/website.md)
  — the Claude Code skill that authors bundles.
- [hypercomb-web/public/hypercomb.worker.js](../hypercomb-web/public/hypercomb.worker.js)
  — `/@resource/<sig>` service-worker route.

## Next steps

- **Bulk resource import** helper so the skill's output files get into
  OPFS without the user hand-calling `Store.putResource` for each one.
- **Context-signature panel** — read-only UI listing reachable sigs
  (ancestor bundles, prior versions) for easy copy-paste.
- **Bundle diff tool** so the skill can cheaply enumerate what changed
  between iterations.
- **Iframe trust tier** for untrusted bundles (sandboxed; postMessage
  bridge to Lineage navigation).
