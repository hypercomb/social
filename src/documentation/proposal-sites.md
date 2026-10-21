# Proposal sites — one hive per funding proposal

A grant or crowdfunding proposal is published as its own hive, at
`<name>-proposal.hypercomb.com`. The first is the NLnet Restack proposal at
`nlnet-proposal.hypercomb.com`.

## The shape

- **One root tile per proposal**, named for the subdomain: `nlnet-proposal`.
  `hypercomb.com` is wildcard-routed, and an unbound `<label>.hypercomb.com`
  resolves to the lineage `<label>` under the zone's publisher
  (`resolveSite` in `hypercomb-relay/blossom-worker/worker.js`). So a new
  proposal needs no operator binding. Publishing the tile opens the door.
- **One page per tile.** Each section is a child tile that carries one
  `visual:website:page`, a complete HTML document with its styles inline. A
  page depends on no other artifact, which is the
  [website artifact paradigm](website-artifact-paradigm.md) rule 1, and the
  hive's lineage is the route ([embedded-sites.md](embedded-sites.md)).
- **Links are site-relative** (`/`, `/plan`), so the same bytes work under any
  root tile and on any domain.

## Files

`scripts/bridge/proposal-site/`

| File | Holds |
|---|---|
| `engine.cjs` | the design and the block renderer: one page in, one HTML document out |
| `facts.cjs` | repository figures, measured from git at build time, and the project's fixed facts |
| `proposals/<name>.cjs` | one proposal: its lineage, funder, brand and pages |
| `build-preview.cjs` | renders the pages to `/.tmp/proposal-site-<name>/` for review |
| `serve-preview.cjs` | serves that preview on loopback (launch config `proposal-preview`) |
| `stamp.cjs` | writes the tiles and their pages into the live hive over the bridge |

Figures such as commit and test counts are never typed in. They are counted
when the site is built, so a page cannot quote a number the repository no
longer supports.

## Making one

```bash
npm run proposal:preview -- nlnet        # render and review
npm run bridge                           # broker, with the authoring hive open
npm run proposal:stamp -- nlnet --dry    # check what will be written
npm run proposal:stamp -- nlnet          # write the tiles and pages
```

Stamping writes to the hive only. It keeps any children already there, and
re-running it rewrites only the pages whose bytes changed. Making the site
public is a separate act: publish the root tile from the Publish panel, or
`npm run publish:content -- nlnet-proposal --r2`.

## Changing it from the hive

Once stamped, the pages are ordinary tile pages. A model in the hive's chat
can change one with a `hypercomb-write` block headed `page /nlnet-proposal/plan`,
or add working notes with `file /nlnet-proposal budget.md`
([hive-read-fence.md](hive-read-fence.md), "Writing a tile's files"). Each
write waits in Execution for approval. A page changed this way drifts from
`proposals/<name>.cjs`, so re-stamping replaces it. Treat one or the other as
the source.

## A new proposal

Copy `proposals/nlnet.cjs` to `proposals/<name>.cjs`, then change `lineage`
(the subdomain label), `domain`, `funder`, `brand.accent` if the funder calls
for it, and the pages whose framing differs. The milestones, comparisons and
facts usually carry over. Funders differ in what they will not fund (NLnet
Restack excludes AI work, for example), so check each page against the
funder's own rules.

Some funders, NLnet among them, want the answers in their form written by the
applicant. A proposal site is the project's public documentation. It does not
replace those answers.
