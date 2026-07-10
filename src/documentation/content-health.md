# Content Health — telling the user what's going on, in plain words

**Status: DESIGN — pinned 2026-07-09. Not built.**
Companion: `features-experience-overhaul.md` (panel-side consumer).

## Problem

The fetch pipeline is failure-silent by design. Every resource, layer, and
dependency flows through one choke point — `ContentBrokerDrone.fetchBySig`
(`content-broker.drone.ts:880`) — and on every failure mode (404, network
error, CORS, timeout, sha256 mismatch) it returns `null`, negative-caches
the sig with exponential backoff, and emits nothing. The only signal that
exists is `broker:fetched` on success.

Consequences, verified in code:

- **Nothing distinguishes** "host down" from "content doesn't exist" from
  "you're offline" — all collapse to the same silent `null`
  (`content-broker.drone.ts:802-805,935-938`). There are **zero**
  online/offline listeners in hive source.
- The user sees: peer tiles imageless with no cue (deliberately never
  substrate-filled, `show-cell.drone.ts:5141-5151`), local tiles silently
  wearing the deterministic substrate fallback, or a brief paint-hold then
  best-effort. The one loud path is adopt's "content isn't reachable right
  now" activity line — which cannot say why.
- Inside `#fetchOverHttp` (`:761-808`) the loop **already knows** which
  host produced a 404 vs a network error vs a mismatch vs a timeout — and
  discards it at each `continue`.

## Doctrine constraints (unchanged, load-bearing)

- Render never awaits network; health work stays entirely off the render
  path (fed by the already-detached fetch attempts, plus browser events).
- Images stable once present; no imageless local renders; quiet chrome —
  no flashy effects, no per-tile spinners, ever.
- The health surface reports; it never gates. Cold behavior without it is
  identical.

## Design

### 1. Per-host outcome ledger at the choke point

Mint the outcome where it is known and currently discarded
(`#fetchOverHttp` loop): `(host, class)` with
`class ∈ ok | not-found | unreachable | timeout | mismatch`, into a small
rolling ledger per host (recent counts + lastSuccess + lastFailure).
Mesh-path outcomes (`#acceptResponseBytes` mismatch, broadcast timeout)
feed the same ledger under a pseudo-host `mesh`. Add the missing
`online`/`offline` window listeners + `navigator.onLine` as one more
input. In-memory only — the ledger is not truth, not a pool, wiped on
reload.

### 2. Classifier → `content:health` effect

Derive a per-host condition and one overall condition; emit
`content:health` **on transitions only** (EffectBus last-value replay
makes late surfaces correct). Conditions, in priority order:

| Condition | Trigger | The user's sentence |
|---|---|---|
| `offline` | `navigator.onLine` false, or every host unreachable in the window | "you're offline — showing what's saved on this device" |
| `host-down` | a host with prior successes is now consistently unreachable/timing out while others answer | "{host} isn't answering — some images can't load right now. they'll come back when it does." |
| `waiting` | peer sigs pending (requested, no 404-everywhere verdict yet) | "waiting for {n} files from the swarm" |
| `missing` | every candidate host returned not-found | "nobody we know has this content yet" |
| `tampered` | sha256 mismatch from a host | "a file from {host} didn't match its signature and was ignored" |
| `healthy` | none of the above | (no pill — silence is the healthy state) |

Every sentence passes the simpleton test: no sigs, no error codes, no
jargon; what's true + what will happen next. All copy through i18n
(`health.*` keys).

### 3. Surfaces (all existing conventions — nothing new invented)

- **Indicator pill** (`indicator:set`/`indicator:clear`, rendered by
  `command-line.component.ts:604-613`): one pill per active condition,
  keyed `health:{condition}`, icon `cloud_off`/`link_off`. Dismissable
  except `offline`. This is the primary surface.
- **Sync-indicator**: `waiting` shows its count there too ("waiting on
  {n} files") — loaders show file counts, per convention.
- **Activity log**: transition moments only ("{host} is answering again").
  No toast spam; toasts stay for actions the user just took.
- **Beehaviors panel rows**: consume the same effect for row-level
  outcomes (see `features-experience-overhaul.md` §row-level outcomes).

### 4. Implementation shape

One new drone: `sharing/content-health.drone.ts` — owns ledger, listeners,
classifier, pill/activity emission. `ContentBrokerDrone` gains only the
outcome-minting calls at the existing `continue` sites plus a
`broker:outcome` (or direct service call) hand-off; no behavior change to
fetching, backoff, or miss windows. `Store.#fetchResourceFromHost` needs
no change — its misses already route through the broker.

## Build checklist

1. Outcome minting at `#fetchOverHttp` failure branches + mesh mismatch/
   timeout + online/offline listeners.
2. `content-health.drone.ts`: ledger, classifier, `content:health`
   transitions.
3. Pill + sync-indicator + activity wiring, `health.*` i18n (en + ja).
4. Beehaviors row consumption (lands with the features overhaul).
5. Dev-shell verification: kill the local byte host mid-session → pill
   appears with the host-down sentence, tiles keep doctrine behavior,
   revive host → "answering again" + pill clears. No OPFS touched.
