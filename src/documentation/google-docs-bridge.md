# Google Docs in the hive

Links a participant's Google Docs into their hive as tiles, keeps the body as
signed hive content, and pushes edits back to Google.

> **Status: bridge DEPLOYED and verified end to end; hive wiring not built.**
>
> - **Verified against the live deployment** (tsiktech@gmail.com, "Hypercomb
>   Connector", 2026-08-14): `list` returned 26 documents; `get` exported real
>   markdown; `create` converted markdown into a real Doc; `update` refused a
>   stale write and landed a correctly-versioned one.
> - **Built + green** — `link/google-docs.ts` (parsing, bridge client),
>   `link/google-docs-sync.ts` (reconciliation), `document/` (slot, edit rules,
>   view drone). 34 passing specs, clean typecheck.
> - **Not built** — no sync worker, no tiles, no pool records, no connect panel.
>   Nothing yet imports a Doc into the hive; the view has no document to open.
> - **Mirror owed** — `google-docs-bridge` and `document-view`
>   (`npm run mirror:queue -- list`).

## Why Apps Script and not the Drive API

The Drive API needs a Cloud project, an OAuth client, and — for `drive.readonly`
— Google's sensitive-scope review before anyone but the developer can use it.
Apps Script skips all of that: the participant deploys the script **in their own
account**, and the deployment itself is the authorization. That also answers
"which Google account" without an account picker — the deploying account is the
participant.

Scraping `drive.google.com` was tried first and rejected: rows are virtualized
(so paging is unreliable), carry no `href` (so no file IDs), and the DOM gives
no export or write path at all.

## Deploy

1. <https://script.google.com> → **New project**.
2. Paste `scripts/google-docs/Code.gs` over `Code.gs`.
3. Project Settings → tick **Show `appsscript.json`**, paste
   `scripts/google-docs/appsscript.json` over it. This declares the **Drive
   advanced service** (`Drive`, v3), which the write path needs — if the editor
   still flags `Drive` as undefined, add it manually under Services → Drive API
   → v3.
4. Set `TOKEN` to a long random string.
5. **Deploy → New deployment → Web app**, Execute as **Me**, Access
   **Anyone**, then authorize (the "unverified app" warning is expected for
   your own script — **Advanced → Go to project**).
6. Keep the `/exec` URL. URL + token together are a credential: anyone with
   both can read and rewrite every Doc in that account. Store it in
   `SecretStore`, never in a layer or a tile body.

Access must be **Anyone** — "Anyone with a Google account" forces an
interactive Google sign-in that a `fetch` from the hive cannot satisfy. The
token is what actually guards the endpoint.

## Calling it

`GET  <exec>?token=…&action=list` → `{ok, docs:[{id,name,url,modified,parents}], nextPageToken}`
`GET  <exec>?token=…&action=get&id=<id>` → `{ok, name, content, version, modified}`
`POST <exec>` → `{token, action:'update', id, markdown, baseVersion}`

POST bodies must go out as `Content-Type: text/plain;charset=utf-8` with the
JSON as the string body. `application/json` triggers a CORS preflight that
Apps Script does not answer, and the request fails before it runs. Read it back
with `JSON.parse(e.postData.contents)` — which is what `doPost` does.

## Editing model

The hive holds the **canonical markdown body**; the Google Doc is a projection
of it. A save PATCHes the whole Doc rather than diffing it.

This is deliberate. Live co-editing inside the hive would mean reimplementing
Docs' operational transform, and an export→edit→import round trip through
anything richer than markdown quietly destroys what it cannot represent —
comments, suggestions, footnotes, exact styles. Whole-body markdown is the
widest format that survives **both** directions, because Docs imports it back
into real structure (headings, bold, lists, links) instead of flat text.

**Conversion is triggered by the target mimeType, not the payload.** A plain
media upload (`uploadType=media` with `Content-Type: text/markdown`) does NOT
convert: it replaces the Doc with the literal markdown source — a visible
`# Heading` — and still reports success. The write must declare
`mimeType: application/vnd.google-apps.document` on the metadata, which is why
`update()` and `create()` go through the Drive advanced service rather than a
hand-rolled `UrlFetchApp` PATCH. Export is unaffected: `text/markdown` is a
documented export format for Docs.

Consequences worth stating plainly:

- **Comments and suggestions do not survive a push.** They live on the Doc, not
  in the exported body.
- **Google keeps its own revision per PATCH**, so the pre-push state is always
  recoverable from File → Version history even though we replace wholesale.
- **`baseVersion` refuses stale writes.** The hive sends the `version` it read;
  if Google's has moved, `update` returns `{ok:false, error:'stale'}` instead of
  overwriting an edit made in Google. Detection, not prevention — resolve by
  re-pulling.

Docs too rich to represent (heavy tables, images, layout) should be marked
link-only and opened in Google, not mirrored. The mark decides, not the code.

## Hive shape

Each Doc becomes one tile. The body is written as a sig-named resource at the
content root, so **every save is a new signature and therefore a new history
entry** — the hive's version history comes free, and undo already works.

Sync records (doc id ↔ last pulled version ↔ body signature) live in a pool of
meaning: **`sign('google:docs')`**. The colon is mandatory. `lineageKey` folds
every non-alphanumeric to `-`, so a colon can never be produced by a tile slug —
a bare `sign('google')` would collide with the lineage sigbag of any tile whose
slug is `google`. See `known-location-pools.md`.

These records are **state, not derived cache**: a cold client cannot rebuild
"which Doc this tile mirrors" from layers alone. They must never be minted from
the optimize phase.

## Reconciliation

`reconcileGoogleDocs` compares Drive against the hive's records and returns one
action per document: `add`, `pull`, `push`, `unchanged`, `conflict`, `vanished`.

Two of those carry the weight:

- **`conflict`** — the hive has edits that were never pushed *and* Google's
  version advanced past what we pulled. Pushing destroys their edit; pulling
  destroys ours. Code does not get to pick, so it becomes something the
  participant is shown.
- **`vanished`** — a tracked doc Drive stopped returning. Never deleted
  implicitly: it may have been trashed, unshared, or simply missed by a partial
  page, and destroying a tile over an ambiguous absence is not recoverable.

An unknown version reads as *moved*, not as safe. The bias is always toward
asking rather than overwriting.

### The round trip is not byte-identical

Verified against the live deployment: pushing `...**paragraph**.\n` exports back
as `...**paragraph**.  \n`. The converter re-emits markdown from the Doc's
structure rather than storing the source it was given, so trailing spaces and
line breaks are regenerated.

Consequence: **`pulledSig` must record the bytes Google EXPORTS, never the bytes
we sent.** A push therefore ends with a re-read. Skipping that makes
`currentSig !== pulledSig` permanently true, so every document reports unpushed
edits the instant after a successful push and the reconcile loops on `push`
forever.

### POST redirects

A POST to `/exec` answers `302` to `script.googleusercontent.com` with a
`user_content_key` — `doPost` has ALREADY RUN at that point and the redirect
points at its result. In Node, following that redirect manually (`redirect:
'manual'`, then GET the `Location`) is required; letting fetch auto-follow
returned 404. Browsers follow it correctly on their own, which is why the
in-page client uses a plain `fetch`.

## Reorganizing by pheromone

Drive folders come across as a *hint*, not as structure. The imported folder
name lands as a mark on the tile; from there the hive regroups by pheromone,
and the same Doc can sit in several groupings at once — which is the thing a
Drive folder cannot do.

Marks come from the declared vocabulary; none are minted on the fly. A group of
them is a **bouquet**, and a bouquet is what a view resolves against — so
regrouping the Docs is editing marks, never editing code.
