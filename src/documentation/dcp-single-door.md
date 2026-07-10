# DCP Single Door — every install/update rides the sandboxed sentinel

**Status: DESIGN — pinned 2026-07-09. Partially existing; gaps enumerated.**
Companions: `drone-installer-contract.md`, `streamline-audit-2026-07.md`.

## Principle

No hive code fetches-and-installs directly. Every byte that enters the
hive's install pools (`sign('bees')`, `sign('dependencies')`, install-time
layers) passes through the DCP sentinel transaction channel: a hidden,
**sandboxed**, cross-origin iframe that resolves domains, fetches,
sha256-verifies, records the install in DCP's own sigbags, and streams a
transaction (enabled manifest + verified bytes) back to the host, which
applies, re-verifies, and returns receipts. The visible installer UI
becomes a browsing/choice surface — never a mandatory stop for updates.

## What already exists (this is mostly wiring, not building)

The channel is live today as "Mode B":

- `hypercomb-web/src/setup/sentinel-bridge.ts` — hidden `/sentinel` iframe,
  MessageChannel handshake, rid-keyed request/response, transferable
  ArrayBuffers, progress streaming.
- DCP side `sentinel.component.ts` (origin allowlist) +
  `sentinel-handler.ts` — domain resolution, fetch, **sha256-verify**
  (`dcp-installer.service.ts:164-169`), register-up into the domains
  lineage, `recomputeLogical()`, enabled-set walk, delta streaming via
  `have[]`.
- Host apply: `ensure-install.ts` `resyncFromSentinel` — writes pools, GCs
  disabled sigs, read-back receipts, advances the sync sig.
- The thin variant also exists: `domains-for` returns candidate domains and
  the host fetches itself — the "iframe resolves, host applies" seam,
  verbatim.
- Headless install for adopt-with-code already runs through it
  (`swarm-adopt.drone.ts:441-443`).

## The three gaps

### 1. Bypass doors still open (Mode A)

These write install pools on the hive origin without DCP:

- Genesis bootstrap: `runtime-mediator.ts:40-58` → `LayerInstaller.install()`
- Bundled fallback + "Upgrade Hypercomb": `ensure-install.ts:247-497`
  (`fetchBundledPackage` / `installFromBundled` / `upgradeFromBundled`)
- `core-adapter.ts` registering `LayerInstaller` for direct use

**Resolution:** when the sentinel is reachable, all three route through it
(genesis = `sentinel.install`, upgrade = `sentinel.sync` after DCP folds
the new package). The bundled path survives **only** as the
offline/first-run bootstrap — and even then it goes through the same
host-side apply function as Mode B, never its own writes.
`LayerInstaller`'s direct-install role retires from the web shell
(meadowverse keeps its own copy; not this doctrine's concern).

### 2. Verification is asymmetric

DCP verifies every byte; the hive-origin `LayerInstaller` verifies nothing
(`layer-installer.ts:286-299` — `res.ok` + SPA guard only; flagged in
`mesh-domain-resolver-audit.md:40-44`).

**Rule: the host verifies sha256 on every byte it applies, regardless of
source** — sentinel stream, bundled fetch, anything. Trust in DCP's
verification is defense-in-depth, never the only gate. One shared apply
function (`applyVerifiedFiles`) owns write + verify + receipt; every mode
calls it. This matches `ContentBroker.#verifyBytes` on the read side: the
signature is the authority, not the channel.

### 3. The sentinel iframe isn't sandboxed

The visible portal iframe carries
`sandbox="allow-scripts allow-forms allow-same-origin"`; the hidden
sentinel iframe — the one doing real transactions — is created bare
(`sentinel-bridge.ts:315-319`).

**Resolution:** `sandbox="allow-scripts allow-same-origin"` on the sentinel
iframe (`allow-same-origin` is relative to the DCP origin — DCP keeps its
own OPFS while remaining cross-origin to the hive), plus keep both-ways
origin checks strict. The sandbox contains DCP; OPFS origin-privacy
contains the hive: the iframe **cannot** touch hive OPFS, `window.ioc`, or
the import map even if fully compromised — the host applies or nothing
does.

## Transaction shape (formalized, not invented)

The enabled manifest the sentinel already returns (`syncSig`,
`enabledBees/Deps/Layers`, `beeDeps`) **is** the transaction description.
Formalize: canonical JSON, signature = its sig, referenced in the host's
receipt. Results returning the other way (per-sig receipts, refusals,
resolved domains) ride the same rid-keyed channel — this is the "it can
return a result if it needs to" half. No new wire format.

## Build checklist

1. `applyVerifiedFiles` in `ensure-install.ts`: single write+sha256+receipt
   path; `resyncPass` and the bundled path both call it. (Fold in the audit
   fixes while there: parallel writes, one `collectPresentSigs` pass,
   drop `cache:'no-store'` on immutable sig fetches.)
2. Sandbox + harden the sentinel iframe.
3. Route genesis + upgrade through the sentinel when reachable; demote the
   bundled path to offline bootstrap via `applyVerifiedFiles`.
4. Retire `LayerInstaller` direct-install from the web shell.
5. Canonicalize + sign the transaction description; receipts reference it.
6. Surface outcomes where the user already looks: sync-indicator counts +
   Beehaviors rows (`features-experience-overhaul.md`), not the DCP tree.
