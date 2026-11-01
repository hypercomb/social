# Derivations — one record for everything made from something else

status: **doctrine, proposed 2026-10-18.** First dialect built and live
(`minify`, commit 6a207a974, worker 394caada). A layer can be derived on its
own (2026-10-29): the record is a member of `derived:<that layer>`, the
dialect record is a member of `derivation:dialects`, and `tool` is the
signature of the transpiler in `hypercomb-core/src/core/minify-transpiler.ts`.
The visitor package built by esbuild still records `derivedFrom` and
`derivation` on its root and does not write those pools.

companions: `optimize-phase.md` (derived caches, never truth),
`signature-system.md` (signatures compose), `known-location-pools.md` (pools of
meaning), `trust-boundary-and-the-extension-question.md` (who may vouch for code).

---

## The question

jwize, 2026-10-18, after the visitor's minified package went live:

> "is this something that can be applied to everything and basically it is
> verified by the community and related to it and a common dialect(s) —
> multiple is okay as well." · "using pools of meaning, right?"

And the constraints that shaped the first one: "make sure we don't break the
merkle promise and this is somehow traceable to the bytes signature from the
related scripts" · "keep the resolution, when being initially verified, slim".

Yes, to all of it. Hypercomb already makes many things from other things — packs,
indexes, thumbnails, plans, now a minified package — and each one invented its
own shape. A **derivation** is the one shape they share.

## The primitive: a derivation record

A derivation record is a small JSON resource, named by the hash of its bytes
like everything else:

```json
{
  "v": 1,
  "kind": "minify",
  "from": "49e82ea4…",
  "tool": "esbuild@0.27.3",
  "options": { "minifyWhitespace": true, "minifySyntax": true },
  "modules": { "<readable sig>": "<minified sig>", "…": "…" }
}
```

- `kind` — the **dialect**: which transform, and how it is verified.
- `from` — the input signature(s). Everything the output was made of.
- `tool` + `options` — exactly how. Enough for anyone to run it again.
- the outputs — whatever the dialect needs: one signature, or pairs.

Four rules hold for every dialect:

1. **The derived thing names its record; the record names its inputs, never the
   output.** Derived → record → inputs: one hop back, and no cycle. (The
   minified root layer carries `derivedFrom` and `derivation`; the record names
   the readable root only.)
2. **The derived bytes stand on their own signature.** Every derived file is
   named by the hash of the bytes that run, and every install checks it like
   any other file. The record is provenance, not integrity: nothing about the
   Merkle chain depends on reading it.
3. **Slim first resolution.** Only the 64-hex pointer rides what a reader
   resolves first. The record is fetched by whoever verifies — never on the
   path to a page.
4. **Derived, never truth.** A derivation can always be recomputed from its
   inputs; deleting one loses speed, never meaning (`optimize-phase.md`).

## Dialects

A dialect is a transform plus the way it is verified. `kind` names it, and
there can be as many as the community needs — `minify`, `bundle`,
`transfer-pack`, `thumbnail`, `translation`, …

The strongest `tool` is **the transform's own signature**: the transform is
itself a signed module, so a derived artifact is f(inputs) with f addressed by
its bytes, and the chain is Merkle from source to served bytes. Where the
transform is a pinned outside tool (esbuild today), `tool` names it exactly
(`esbuild@0.27.3`) and a verifier refuses a different version.

## Two ways to verify

Every dialect declares which one it uses, so a reader knows what an attestation
means:

| Mode | When | What a verifier does | What it gives |
|---|---|---|---|
| **reproduce** | the transform is deterministic | runs it again on the inputs and compares signatures | **proven** — anyone can check, the answer is yes or no |
| **witness** | it is not (AI translation, encoders that differ by platform) | reviews the output against the inputs | **vouched** — people stand behind it |

Either way the verifier publishes a signed attestation ("I re-derived it and got
the same", or "I reviewed it and it is faithful"). A reader weighs attestations
the way the trust doctrine weighs scents: who vouched, how many, how much the
reader trusts them. No attestation is a switch.

**Reproduce needs the inputs.** A derivation whose `from` cannot be fetched
cannot be re-derived. Found 2026-10-18: the live minified root names readable
root `49e82ea4…`, and that root answered 404 on the host — the claim was
visible, its proof was not. So wherever a reproducible derivation is served,
its inputs must be reachable by signature too (shipped beside it, or in a pool
the community can read). They need not be on anyone's first-load path.

## Pools of meaning

No side files, no named routes. Three system pools (colon meanings, so no tile
name can collide), registered through the pool registry like every meaning
(`registerPoolMeaning` / `Store.poolSignature`):

| Question | Pool | Members |
|---|---|---|
| What has been derived from X? | `sign('derived:<X sig>')` | derivation record signatures, every dialect |
| Who verified this derivation? | `sign('attest:<record sig>')` | one signed attestation per verifier key |
| Which dialects exist? | `sign('derivation:dialects')` | dialect records: `kind`, the transform's signature, the mode |

The other direction needs no pool: a derived artifact names its record
directly. Pools are a union across hosts, so attestations written anywhere add
up for the same record, and anyone may add a dialect by writing a member.
(Hosts already keep the attestation shape for packages: `assess:<root>`, one
member per assessing key, re-verified as read — `attest:` generalises it.)

## One layer at a time

jwize, 2026-10-29: "We should really be able to in the same way we use pools of meaning layer amenification strategically with our own compilation transpiler."

A package is a branch. A layer anywhere in it is a package of its own. Minifying that layer runs the same walk as the whole tree, starting at that layer's signature. Ancestors stay as they were. The new root is the minified layer. Its record names the readable layer, and the record's signature is a member of `sign('derived:<that layer>')`. The dialect record, `{ v, kind, tool, mode }`, is a member of `sign('derivation:dialects')`.

`tool` on that record is the signature of this tree's transpiler. The program is the source between the markers in `minify-transpiler.ts`, and the signature is the hash of that text. It drops comments and spare spaces, keeps every name, and keeps a newline that separated two tokens. A module it cannot read stays the readable bytes. A verifier on a shell that holds the same program re-runs it. A verifier does not fetch a transform a record names.

The host file view does this for the folder that is open. The minified signature can be the folder a later mint chooses, which rewrites the layers above it. The bytes of the minified layer are the pack from that view. Writing them into the origin's store happens when that store is already open. Nothing here moves a published head, and a visitor runs the minified layer when a publisher names that root.

A changed package registration reminifies that new root into `derived:<that root>`. A mint on the host file view, a commit into `host:packages`, and an activation each do it. The readable root stays the registration, the trunk, and the `host:packages` head.

Picking a code behavior from the hosts window composes that registration: the trunk, the behavior chosen at its path, and the paths that are off. That composed root is what is reminified into `derived:<that registration>`. The installed package stays the readable trunk.

Publish to head names the working build as this origin's instance head. The file is one line, the package, and a second line when that package is a minified derivation. The file signatures of that build stay beside it. Minting, minifying, and a hosts pick leave a published head where it is. This browser answers GET `/head` from that publish. Saving the head file is how a host serves those lines.

## The first dialect: `minify` (built)

The visitor of a published site runs a minified derivation of the readable
package (`hypercomb-runtime/src/minified-package.ts`, shipped by
`hypercomb-web/scripts/prepare-visitor-assets.mjs`):

- **why not minify the package itself:** the source lives in the hive. Models
  read and draft modules by their `// src/…` sections and Jev reviews against
  them, so the signed package stays readable — it is the truth; the visitor's
  copy is derived from it.
- module bodies minified (whitespace and syntax only — every name kept, because
  the dependency scans and IoC keys read names); leading `//` lines kept byte
  for byte (alias, lazy marker, source path);
- every layer re-hashed bottom-up, so the derived package is a whole Merkle
  tree of its own; bags, transfer pack and install index are its own;
- a module the transform cannot handle keeps its readable bytes; any failure
  ships the readable package; `VISITOR_MINIFY=0` ships it on purpose;
- `hypercomb-web/scripts/verify-minified-package.mjs` re-derives from the
  readable package with the record's own tool and options and must arrive at the
  same root.

Measured: package 9.1 → 6.2 MiB; first-load index and layers pack unchanged in
shape and size; ~0.2 s sooner at phone speed.

## Derivations that already exist

Each of these is a derivation today without the name. They adopt the record
when next touched — nothing is rewritten in place (data never heals).

| Artifact | Made from | Where it lives now | Mode |
|---|---|---|---|
| transfer pack | a package's files | `transfer:packs`, keyed by package root (`transfer-pack.ts`) | reproduce |
| install index | a package's bytes | `install:index`, keyed by package (`install-index.ts`) | reproduce |
| layers pack | a package's layers | named by the install index | reproduce |
| landing (content) pack | a published head's closure | `content:packs`, keyed by head (worker) | reproduce |
| import-map bags | a package's aliases | computed by every client (`bags.ts`) | reproduce |
| children manifests, visual optimization | layers | `system:manifests` / `system:optimization` (`optimize-phase.md`) | reproduce |
| hex thumbnails | a picture | `thumbnails:hex`, keyed by source (`thumbnails.ts`) | reproduce if the encoder is pinned, else witness |
| derived arrival plan | a branch's view declaration | signed index `plan:<lineage>`, `{arrive, derived: true}` (`arrival-derive.ts`) | reproduce |
| minified package | the readable package | its root's `derivedFrom` / `derivation` | reproduce |
| community translation | a catalog in another language | `i18n:<locale>` (`community-translations.md`) | witness |

## What is not a derivation

Truth is not derived: a participant's committed layers, history markers, signed
index pointers, anything a person made. A plan made by hand (the `arrival` word)
is a declaration, not a derivation — which is why a publish never derives over
one.

## Order of work

1. This doctrine.
2. Make `minify` verifiable from the live site: ship the readable package's
   files beside the minified ones (off the first-load path), and teach the
   verifier `--host <door>` so anyone re-derives from the site itself.
3. The `attest:` pool and a word that re-derives a record and publishes the
   attestation (`derive verify <record sig>`), with the reader side that counts
   attestations.
4. The `derived:` and `derivation:dialects` pools. Built for a layer minified
   with the transpiler above. An artifact that was derived before that, the
   esbuild visitor package included, takes the membership when it is next
   derived. Nothing already written is rewritten.
5. `tool` becomes the transform's own signature, dialect by dialect. Built
   for this transpiler. An `esbuild@<version>` record stays that name, and a
   shell re-runs it with the esbuild it already carries.
