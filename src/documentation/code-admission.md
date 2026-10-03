# Code admission — from their domain to your hive, through one gate

**Status: DESIGNED 2026-09-30, not built; every decision in §5 DECIDED the
same day** (jwize: "go with the recommendations"). The mapping behind this
document (seven readers and a critic over core, runtime, essentials and the
shim) found the pieces below; the build order is at the end.

jwize: "The workflow would then be go to their domain, open their behaviors,
turn them on, then go back to your host, accept them, and now you have those
behaviors installed. Of course there's going to have to be a host community
security interface to set up how you want to allow code — whether it needs to
be scanned by AI, needs certain hosts to also agree in those signatures, or
what the minimum is for it to be allowed to run, or prompt you to accept it —
explain those security boundaries, with the ability to update them if they
need tuning at that time." And: "if it is missing from the default shim it
will have to be included."

Builds on: [install-by-replication.md](install-by-replication.md) ("Activation
authority"), [module-sandbox.md](module-sandbox.md) ("Whose word counts"),
[everything-is-a-beehavior.md](everything-is-a-beehavior.md).

## 1. The workflow

1. **Go to their domain.** Their code runs on their origin, against their
   storage. Trying costs nothing — origin isolation is the sandbox.
2. **Open their behaviors, turn them on.** On their domain a turn-on records
   a reference and carries it home. Nothing is copied, nothing runs.
3. **Go back to your host.** The references wait in review. Every reference
   is re-read against the publisher's signed record at home; nothing the link
   says is trusted.
4. **Accept.** Your rules decide: run now, hold for your hand, or refuse.
   When something is held, the accept screen says which rule held it and
   lets you tune that rule on the spot.
5. **It is yours.** The bytes are in your pools, verified by signature, and
   the behavior is local like your own code (`module read`, `module draft`).

The same workflow must run in the **default pure shim** — no essentials, no
Angular, the 2 MB static host.

## 2. The boundaries

Each boundary answers one question. They are applied in this order.

| # | Boundary | What it stops | Where it lives |
|---|---|---|---|
| 1 | **Origin isolation** | Their code touching your data while you try it | the browser |
| 2 | **A mark only records** | A click on their site pulling code into yours | shim host panel (`select` refs → `host:pending-selections`) |
| 3 | **Bytes hash to their names** | A bad or hijacked host altering code in transit — it can only cost a 404 | runtime replication walker |
| 4 | **Activation authority** — *who may bring code here* | Anyone's code arriving as trusted: only SELF, a FOLLOWED publisher's signed root, the one GENESIS seed, or your HAND | `hypercomb-runtime/src/activation-authority.ts` |
| 5 | **The brood** — *what runs* | Stranger code running. The type has no `run` for a stranger — only hold or refuse | `hypercomb-core/src/core/brood.ts`, `brood-rules.ts` |
| 6 | **Vouches** | Having to audit everything alone: N keys you follow that accepted the signature stand in for your hand | `brood-rules.ts` `vouchesNeeded` |
| 7 | **Audits** | Accepting code nobody read. A scan or a model reading attaches to the held record | `code-reach.ts` (scan), essentials `brood-audit.ts` (reading) |
| 8 | **Your own ruling wins** | A crowd overriding you: your accept runs even if every rule would hold; your refusal stands against any number of vouches | `brood-rules.ts` |

Standing doctrine this design keeps, verbatim in intent:

- **An audit is never a permission.** A reading can be *required*; it can
  never *admit*. Only the hand (`acceptIntoHive`, two warnings) or a rule
  that already admits (own / followed / vouches) makes code run.
- **Trust names a key, never a domain.** "Certain hosts agree" means the
  *operator keys* of those hosts, never their hostnames.
- **Only keys you follow count** as vouchers. Fresh keys are never counted.
- **Followed code runs by default** (`brood-rules.ts`: "this file must not
  change that") — see DECIDE D1 before `auditRequired` touches it.
- **Rules only restrict.** Every rule added here can turn run → hold or
  hold → refuse. None can turn hold → run.

## 3. What exists, and what the map found missing

### 3.1 Built and sound

- The gate's doors (SELF / GENESIS / ATTESTED / HAND / FLOOR) and its
  fail-closed default (`activation-authority.ts`).
- The brood store, the rules pool (`brood:rules`), `acceptIntoHive` with two
  warnings, `mayRunBee`. **The bee loader honours it in the pure shim**:
  every bee import passes `mayRunBee` (`hypercomb-runtime/src/script-preloader.ts`
  `#tryLoadBee`) before a byte is read.
- The shim's visit flow for creations: the `home` param, the in-memory
  choices, the `select` return link, `#takeHandoff` re-reading the source's
  signed pool, the pending pool, the review, the local turn-on.
- The pure scan (`core/code-reach.ts`) — runs anywhere.

### 3.2 Holes that exist today (fix before calling anything "gated")

These were found by the map and checked against the code by the critic.

1. **Dependencies are not gated.** `installPackage` holds `inventory.bees`
   only (`acquire.ts` holdArrivals call); `DependencyLoader` imports every
   non-lazy bundle with no `mayRunBee` check; `writeBags` composes every
   inventory dependency into the bag and so into the import map. On a warm
   shim `__hypercombBeeDeps` is never restored at boot, so the eager pass is
   *everything*. A held behavior's namespace bundle can still run.
   (Essentials atoms carry the `// lazy` marker and are skipped, so the leak
   is small for our own code — the hole is open for hand-made bytes.)
2. **Creation code bypasses the gate.** `offerings.ts replicateSiteClosure`
   writes a site's bees and dependencies into your pools with no
   `activationAuthority`, no `holdArrivals`. On a cold pure host the
   import map's **flat-scan fallback** maps every `<sig>.js` with an
   `// @alias` line, so a site's dependency module can run in your origin
   after a plain turn-on and a reload.
3. **Website page scripts have their own, weaker door.** `site-view.drone`
   re-creates a page's `<script>` tags in the hive document, gated by
   `featureNeedsReview` / `hc:feature-verified` — which has a **bypass** flag
   ("enabled WITHOUT reading the code") and treats `hc:community:domains` as
   trusted. A fifth gate, outside the brood.
4. **The service worker is an ungated writer.** `hypercomb.worker.js`
   `handleModuleRequest` serves `/opfs/<pool>/<sig>` and, on a miss, fetches
   from known hosts and *writes* into `sign('bees')` / `sign('dependencies')`.
   It never consults the brood; held bytes are importable by URL.
5. **A link can stage selections.** `#takeHandoff` runs on page load whenever
   `/hosts` carries `?add` or `?select` — no click. Any link can stage
   pending selections and **persistently add a host** to `community:hosts`.
   A staged selection is not proof the participant marked anything.
6. **The return link overflows Apache.** 24 refs make a ~9 KB request line;
   Apache's default limit is 8190 bytes, so an Apache/DreamHost home answers
   414 before the shell loads (commit `a3a322fe8` made Apache a supported
   host). Behavior refs are larger still.
7. **Vouches are dead code.** Nothing registers `BROOD_TRUST_IOC_KEY`, so
   `followedKeys()` is always `[]`; nothing calls `recordVouch`. The default
   `vouchesNeeded: 2` has never had an effect.
8. **Accepting hangs in a shim.** `acceptByHand` awaits `requestConfirm`,
   whose only responder is an Angular component in hypercomb-shared.
9. **Registration order is a security property nobody asserts.** IoC is
   first-wins; the gate trusts whatever sits under `ATTESTATION_IOC_KEY` at
   click time. Any bee loaded before `hosts.drone` could register a
   permissive attester.
10. **`holdArrivals` promotes silently.** When a stranger-held sig re-arrives
    as followed/own, the record's kind is raised and it runs with no hand;
    `pickRevision` labels any root already in the SignatureStore `own`.
11. **The pure build does not guard the bootstrap bundle** against
    essentials / shared / Angular imports — only `main.js` is checked. Moving
    code into the bootstrap needs that check first.

### 3.3 Missing for the workflow

- **No attester in a cold pure shim.** It is registered only by essentials
  `hosts.drone.ts`. A warm shim (after genesis installs essentials) has one,
  but it attests only the followed publisher's `install:<channel>` root —
  never a third party's behavior.
- **The pick machinery only knows our namespace.** `package-tree.ts`
  `namespaceOf` / `missingNamespaces` recognise only `@hypercomb/essentials/`;
  a third party's bundles are dropped silently and `pickRevision` still says
  ok. It also needs an installed trunk (a cold shim has none), and a nested
  path whose parent is absent never loads.
- **No shim accept screen, no security view, no framework-free confirm.**
- **Two meanings of "turn on a behavior" already exist** (the Beehaviors
  roster light `hc:behavior-global-on`, and install units / picks). The web
  hosts window's per-path turn-on calls `pick` *without* `byHand`, so there a
  stranger's behavior is refused, while the planned shim flow would hold it.
  One runtime function must serve both shells.

## 4. The design

### 4.1 One follow record, one attester, in runtime (step 1)

- Lift the pure halves into **core**: `installRootOf` / `installChannelKey`,
  an index parse with an injected verifier (core already has one in
  `host-offerings.ts` — one constant for kind 30564, one size cap), and
  `readInstallFollow(storage, publisher)` with the publisher *required*.
  Essentials re-exports; `install-publisher.json` stays where its three
  script readers expect it.
- Add `hypercomb-runtime/src/package-attestation.ts` (the attester, its
  witnessed roots and its index read via `nostr-tools/pure`, which the shim's
  bootstrap bundle already carries). Register it **once, from the pinned
  bootstrap**, before any bee loads. Register the **BroodTrust provider** from
  the same follow record, so vouches can finally count. Delete the essentials
  registration in the same change.
- GENESIS must survive an attester being present: answer the seed +
  `installed === null` case before asking the attester.
- **The attester widens** from "the followed install root" to "a followed
  key signed this root" (an offer's index is already verified against its
  own key; attestation adds: *that key is one you follow*).

### 4.2 Behaviors in the visit flow (step 2)

- A third selection kind, `behavior`, beside site and creation: discovered on
  their domain, carried in the return link, staged in `host:pending-selections`,
  reviewed, committed. Every part of the reference is content-addressed and
  re-verified at home.
- The commit is **one runtime function** both shells call (the web hosts
  window moves onto it too): admit through the gate with `byHand: true`,
  then hold per the rules. FOLLOWED → runs; unvouched → HAND → held.
- `package-tree` generalises from `@hypercomb/essentials/` to any publisher
  namespace, and learns a no-trunk mode (the picked root becomes the tree).
- `#takeHandoff` stages only; it never adds a host until the participant
  confirms the review. The return link carries at most what fits 8 KB, or
  carries one signature of a selection resource instead of the refs.

### 4.3 The rules, the accept screen, the security view (step 3)

Two new rules in `brood:rules`, defaults = today's behaviour:

| Rule | Values | Meaning |
|---|---|---|
| `auditRequired` | `none` · `scan` · `reading` | Code that would run is held until that kind of audit is attached. Never admits. |
| `vouchesFrom` | operator keys | These keys must be among the vouchers before vouches stand in for your hand. |

`admitArrival` returns a **reason** as well as a verdict, so the accept
screen can name the rule that held the code.

**The accept screen** (plain DOM in the shim bootstrap, core functions only),
one card per held behavior:

- why it was held — door, rule, flag ("stranger · 1 of 2 vouches · no scan");
- what it reaches (`reachesOf`, `CODE_REACH_LABELS`);
- the audit summary, and **Audit now** (the scan runs anywhere; a reading
  needs a model — see D4);
- **Accept** (the same two warnings, moved to core) · **Refuse**;
- the holding rule, editable in place — a change is written to the rules
  pool and applies from then on.

**The security view**: every rule, the followed key(s), vouch sources, the
brood roster, the domain-keyed `trust:code` consents shown for what they
are. The accept screen is a shortcut into it, never a second copy.
Participant-only; no machine or bridge path writes rules.

Moved down so both shells share them (never copied): essentials
`brood-accept.ts`, `brood-risk.ts`, and the scan half of `brood-audit.ts`.
One framework-free `confirm:request` responder in the shim.

### 4.4 One gate (step 4)

- `replicateSiteClosure` collects code references instead of fetching them;
  content-only sites and text themes behave exactly as today. Code goes
  through the same gate and `holdArrivals` as a behavior. A code-bearing
  creation stays **off** until its code is accepted.
- Dependencies are held with bees, excluded from bags and import maps while
  held (as `applySelection` already does for picks), and `DependencyLoader`
  asks `mayRunBee`. The flat-scan import-map fallback skips held sigs, or is
  removed for pure hosts.
- The service worker never writes code pools on a miss and never serves a
  held sig.
- Website page scripts come under the same brood: the `bypassed` flag and the
  domain-keyed auto-trust retire in favour of the hand.

## 5. Decisions (DECIDED 2026-09-30)

jwize: "go with the recommendations" — each recommendation below is the
decision, and D5 was answered directly.

- **D1 — Does `auditRequired` apply to followed code?** Applying it holds
  every essentials bee on the next install, including the accept surfaces
  themselves (lockout). *Recommend:* strangers and held-own only; followed
  code keeps its default, as `brood-rules.ts` promises.
- **D2 — "Certain hosts agree" = which keys?** *Recommend:* host operator
  keys, named in `vouchesFrom`; naming a key there adds it to the followed set
  *for vouching only* (one follow record with roles, not a second list).
- **D3 — What record is a vouch?** *Recommend:* the existing signed
  `assess:<root>` assessments (built, module-sandbox.md), verified against
  each voucher's own signed index, fanned into `recordVouch` for every held
  sig of that root. No new record kind.
- **D4 — A reading in a pure shim.** No model provider lives there.
  *Recommend:* the scan runs everywhere; `reading` is satisfied only by a
  signed reading you can verify (your own from a full hive, or a vouched
  host's); otherwise it stays held for your hand.
- **D5 — Which publisher does a cold pure shim follow? DECIDED (jwize,
  2026-09-30): "They follow hypercomb.com."** As a key, that is the publisher
  hypercomb.com speaks for — `eacc0e65…` (`install-publisher.json`), whose
  signed index `content.hypercomb.com/hive/<pubkey>` serves (hypercomb.com
  itself answers that path with the shell). The follow record's host becomes
  hypercomb.com; changeable in the security view. Two consequences found
  while checking: (a) the genesis seed `DEFAULT_HOST_ZONES` is `jwize.com`
  only — hypercomb.com belongs in it; (b) hypercomb.com's `host:packages`
  pool offers `ea5c51a0…` ("genesis") while the signed `install:essentials`
  names `8f6d68b2…`, so today its offer would not attest unless witnessed —
  the pool or the stamp needs to catch up. **Both done the same day:** the
  seed is `hypercomb.com` in runtime `DEFAULT_HOST_ZONES` and essentials
  `SEED_HOST` (jwize: "jwize.com is personal so drop that as a default"), the
  follow record's host is `content.hypercomb.com`, and the apex deploy
  (`scripts/presentation/deploy-azure.cjs`) no longer mints its own package —
  `stage-signed-package.mjs` replicates the signed `install:essentials` root
  into the host and lists it. hypercomb.com now offers `8f6d68b2…`.
- **D6 — Rule changes as history.** *Recommend:* forward records (each change
  a new layer; data never heals), not one overwritten file.
- **D7 — "Turn on all" over held behaviors.** *Recommend:* one two-warning
  ceremony per publisher root, listing every behavior it covers — never a
  bulk hand across publishers.
- **D8 — Existing adopted code-bearing sites.** *Recommend:* held on next
  boot until accepted (grandfathering keeps hole 2 open).

## 6. Build order

0. **Close the holes** (§3.2: 1, 2, 4, 5, 6, 9, 10, 11). No UI; each with a
   spec.
1. **Attester + follow + BroodTrust in runtime** (§4.1).
2. **Behaviors in the visit flow** (§4.2).
3. **Rules + accept screen + security view** (§4.3).
4. **One gate** — creations, dependencies, service worker, page scripts
   (§4.4).

## 7. Proof

From `src/`:

```bash
npx vitest run hypercomb-shim/src hypercomb-core/src/core hypercomb-runtime/src doctrine.spec.ts
npm --prefix hypercomb-shim run typecheck
npx tsc -p hypercomb-runtime/tsconfig.json --noEmit
HYPERCOMB_HOST_OUT_DIR="$TEMP/hc-host-proof" npm --prefix hypercomb-shim run build:pure
HYPERCOMB_HOST_OUT_DIR="$TEMP/hc-host-proof" node hypercomb-shim/host/check-pure.mjs
node hypercomb-shim/host/serve.mjs "$TEMP/hc-host-proof" 4865
node hypercomb-shim/host/check-host.mjs http://localhost:4865
```

Baselines on 2026-09-30: the shim typecheck already fails with 3 errors in
`src/uncontrolled-page.spec.ts`; core `tsc` has 8 spec-only errors.

The end-to-end proof is two hosts: a cold pure shim at one origin turns on a
behavior from another origin — one followed (runs), one a stranger's (held,
accepted by hand, then runs) — and a held behavior's dependency bundle is
shown not to load.

## 8. Docs to update when built

`install-by-replication.md` (Activation authority; the attester no longer
lives in essentials), `module-sandbox.md` (Whose word counts → vouches),
`everything-is-a-beehavior.md`, `minimal-host-claude-handoff.md`,
`hypercomb-shim/README.md` (the bootstrap already carries nostr),
the headers of `attestation.types.ts` and `brood-rules.ts`, and `index.md`.
