# Moose on the Loose — importing the Miro board

The public Miro board **"Public Moose on the Loose"**
(`https://miro.com/app/board/uXjVIgUjvog=/`) is the source for the
`/moose-on-the-loose` hive. The first pass mirrored it from *screenshots*
(~48 tiles). This pass mirrors it from the **board's own data**.

## How the board was read

The board URL key `uXjVIgUjvog=` is a thin **portal** board holding one
widget that points at the real board, `uXjVJHO6Ns4=`. Miro serves both
without authentication:

```
GET https://miro.com/api/v1/boards/uXjVJHO6Ns4%3D/content
```

Board content is drawn on a canvas, so screenshots and DOM scraping both
fail — the `/content` endpoint is the only faithful read. It returns one
JSON document (4.8 MB) whose `content.widgets[]` each carry a
double-escaped `json` string.

Resource bytes (images, PDFs) come from a second call per resource, which
returns a short-lived signed CDN URL:

```
GET /api/v1/boards/<boardId>/resources/<resourceId>/files/created?redirect=false
  -> { "url": "https://r.miro.com/...?Expires=...&Signature=..." }
```

## What is on it

| | |
|---|---|
| widgets | 3 826 |
| text blocks | 1 472 → **1 227 atomic claims** |
| connectors | 809 (798 with both ends resolvable) |
| external links | 619 (embeds + link previews) |
| images | 680 refs → 471 unique files |
| documents | 55 PDFs |
| assets downloaded | 526 files, 158 MB |
| board tags | `USA`, `China` |

**Linked boards.** The board references 58 other board keys. 12 resolve
(all thin portals back to the main board); **46 return
`403 boardAccessDenied`** anonymously *and* from an authenticated browser
session. They are private and need Jaime to publish or share them before
they can be imported.

## The board's real structure

Two structures are overlaid, and they need different treatment.

**1. Drawn panels.** Most of the board is spatially arranged under 27
large-font headings — holdings lists, timelines, the lie tracker. These
group by proximity.

> **Trap:** naive "nearest heading above" clustering is wrong. `Submit a
> Tip` and `Support the Channel` are small UI headings sitting *in the
> middle* of the board; they vacuumed up 153 atoms of unrelated content
> (Soros, Bilderberg, Chatham House, Brookfield–Kushner–Sequoia). Meta
> headings must be excluded as cluster anchors.

**2. A drawn network.** One connected component of **417 widgets** is a
relationship map: entities joined by connectors. Across the whole board
that graph holds **526 entities** and **466 entity-to-entity
associations**.

> **Trap:** the short texts sitting between two entities are *not*
> predicates. `Diana Fox Carney —[Canada 2020]— Mark Carney` chains three
> entities; Canada 2020 is a think tank, not a relation type. Only a
> handful of genuine predicates exist (`On the Board`, `Chair`, `Private
> Meetings`, `Build Data Centers`, `Provide Green Energy`, `For Rent`).
> Treat edges as **drawn associations**, and do not synthesise a
> predicate vocabulary the board does not have.

Most-connected entities: Brookfield Asset Management (85), Mark Carney
(45), Liberal Party (21), Carbon Credits (18), Brookfield Business
Partners (14), Brookfield Properties (14), Net Zero (12).

## Atomising claims

Text blocks concatenate several claims. A claim breaks at a line that is
not a URL and not a continuation key (`Claim:`, `Reality:`, `Details:`,
`Role:`, `Source:` …) **when the previous line was a URL**. That yields
1 227 atoms of the form *title · body lines · source URLs*.

Link cards, images and PDFs sit *beside* the claim they support rather
than inside it, so they are attached by proximity: 579 of 619 links, 618
image placements, 39 of 55 documents land on an atom.

## The company register

Holdings are listed verbatim as `Stock: X`, `Conflict: X`, `RRSP: X`.
Mining those lines yields **663 distinct companies** — 574 stock, 89
named conflicts, 8 RRSP — after folding suffix variants (`Inc`, `Corp`,
`PLC`, `NV`, `Ltd`) into one key.

`companies/` stays **the integration layer**: a firm named by two boards
is ONE tile. Never mint a second tile for a name already in the register.

## Branch layout

Distinct subjects get their own branch rather than being folded under the
person they implicate.

```
moose-on-the-loose
  mark-carney/            lie-tracker · assets · conflicts (direct,
                          indirect, cabinet, stock) · pensions-to-profits ·
                          major-projects · ukraine-rebuild
  brookfield/             government contracts since 2000 · subsidiaries ·
                          deals — the board's most-connected entity
  carbon-credit-system/
  net-zero/               net zero · liberal timeline · climate policies
  china/
  artificial-intelligence/  AI · AI infrastructure & data centres
  dairy-supply-management/
  liberal-party/
  network/                the 526 drawn entities and their associations
  companies/              THE INTEGRATION LAYER — the register
  sources/                link cards and PDFs kept as evidence
  miro-board/             board captures + import provenance
```

## Tile doctrine for this hive

- **Every tile is one atomic unit.** One claim, one entity, one company.
- **Pheromones are the only relation.** A claim tile does not name its
  companies in a field; shared marks make them candidates for
  integration.
- **Notes carry the detail.** A one-line *instruction* (the claim in a
  sentence) plus a long-form *note* (the block transcribed, sources
  listed).
- **Hierarchical lists carry rules and structured detail.** These are
  the notes tree: note blobs
  `{"children":[...],"mark":"…","note":"…","shape":null}` written
  leaf-first with `put-resource`, then attached with `bag-set` on the
  `notes` slot. Marks come from the seeded palette — `label` (heading),
  `check_circle` / `bolt` (list), `notes` (prose). `note-add` cannot set
  a mark or nest, so it is only for flat notes.
- **Standing of the material:** everything is a transcription of what the
  board asserts, never independently verified, and the notes must say so.
  Where a source contradicts itself, **write the contradiction down**
  rather than silently picking a side.

## Reproducing the import

Scripts live in the session scratchpad and should be moved into
`scripts/miro/` if this becomes routine:

| script | does |
|---|---|
| `sweep.cjs` | walks board keys, resolving portals, records 403s |
| `extract.cjs` | widgets → nodes / edges / links / docs / images |
| `cluster.cjs` | assigns items to section headings |
| `atomize.cjs` | text blocks → atomic claims |
| `attach.cjs` | links/images/docs → nearest claim; mines the register |
| `graph.cjs` | connected components of the connector graph |
| `relations.cjs` | entities and their associations |
| `download.cjs` | every image + PDF via signed URLs |
