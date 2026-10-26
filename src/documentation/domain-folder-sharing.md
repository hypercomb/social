# Folder sharing for publishes on a domain — one heap, many names

**Status: DOCTRINE, stated by jwize 2026-10-26.** What is verified and what is not built is marked per section; nothing
here is a claim about a host that was not checked.
Companions: [`known-location-pools.md`](known-location-pools.md) (the root's three species and the pool registry),
[`hosting-from-a-machine.md`](hosting-from-a-machine.md) (the host contract), [`publish-differential.md`](publish-differential.md)
(what is served next to what is here), [`domain-claim.md`](domain-claim.md) (front doors and doors), [`sealed-audiences.md`](sealed-audiences.md)
(private versions), [`showcase.md`](showcase.md) (what a root shows).

## The rule

> "All domains only resolve and publish to the root, and even the start-up files can be there, because we want to have all the
> same. That means all a subdomain needs to update is its head pointer, and it should be good, and copy all histories to the
> domain pools and root folder resources." — jwize, 2026-10-26

A zone has **one folder**: its root. Every name under the zone (`zone`, `name.zone`, `other.zone`) is a way of *reaching* that
folder. None of them owns files. A publish puts bytes in the root, then moves a pointer. Nothing is made, copied or cleaned
per subdomain.

## The folder

The root holds exactly three kinds of thing, and nothing else (no typed `__x__` folders, no per-name folders, no subfolders
other than pools):

| In the root | What it is | Named by |
|---|---|---|
| **Atoms** — layers, resources, pictures, sealed ciphertext | the bytes of everything published | `sha256(bytes)`, so a copy is verified by its own name |
| **Lineage sigbags** — `000x` markers, the highest is the head | a branch's history, one marker per commit | `sha256(lineageKey)` |
| **Pools of meaning** | any grouping: the signed indexes, host listings, packages, a room, a swarm | `sha256(meaning)`, derived with the pool registry, never hard-coded |

**Start-up files live there too**: the shell (`index.html`), `pin` (the signature of the shell's bootstrap), the service
worker, locales, the mark. They are the same files for every name, so any name can be opened from cold, and any host that
holds the root can serve them (this is the host contract: a directory of static files and nothing else).

## One mutable file, and a shared host program

Of everything in the root, **one file is mutable: `/pin`**, a single 64-hex signature naming the bootstrap bundle
(`hypercomb-shim/host/README.md`, rule 2: "the single mutable pointer in the whole chain; everything it names is
content-addressed"). Everything else is named by its own hash and can be cached forever or replaced by any host that holds the
same bytes. The shared host program already exists and is the same for every zone:

- `hypercomb-shim/host/` — the contract (seven rules), `serve.mjs`, `deploy-cloudflare.mjs`, `deploy-azure.mjs`, and
  `check-host.mjs`, which tests a live URL against the contract.
- `hypercomb-serve` / Hive ▸ Serve This Hive — the same contract, serving a live hive out of the store.

So a new domain is: stage the shell, publish `/pin`, and run `check-host.mjs`. What is left to make a name under a zone
indistinguishable from the root is below, under "Not built".

## A name is a pointer, not a place

A subdomain is **resolution, never storage** (jwize 2026-10-14). What makes `name.zone` answer is data, not a folder:

1. The publisher's **signed index** (a member of the `hive:indexes` pool, named by their key) holds `roots`: branch → head
   signature.
2. **Doors** (`doors`) say on which domains that branch answers. With `explicitDoors` on a zone, a name answers only where
   its door is on.
3. A wildcard route sends every name under the zone to the same worker, which reads the index and serves the head's closure
   *out of the root*.

So the whole of "publishing to a domain" is two steps, in this order, and the index only ever names what is served:

1. **Bytes first:** upload the branch's closure into the root heap, each file under its own signature. Identical content is
   one file however many names or people point at it.
2. **Then the pointer:** advance the head in the signed index (`setHiveRoot` / the publish write). That is the whole update
   for a name. A new version is a new head, and old heads keep resolving, so older versions keep working.

Taking a name down is the same act reversed: remove the pointer (or turn the door off). No file is deleted. The bytes stay in
the heap, unnamed; a name that is later given to someone else starts from its own pointer.

## Histories

A branch's history is its lineage sigbag: ordered markers, each a pointer to a layer already in the heap. Sharing it is
copying markers into the root's pools beside the atoms they name, so any host holding the root can show the branch's past and
a visitor can step back. It is **optional per branch** (`publish history on|off`), because a history carries every earlier
state of what was published.

## What a subdomain needs

Its **head pointer**, and its doors. Not a folder, not a copy of the shell, not its own history files. If that is all a
name needs, then a name can be added, moved, retired or recycled by changing the signed index alone.

## Safety, stated plainly

- **Integrity is the hash.** Every file is checked against its own name by whoever reads it. A host cannot alter a byte without
  being caught, so which host served it does not matter.
- **Control is a signed word, not enforcement.** A publisher can withdraw a name (honest hosts and readers follow it). Nothing
  can make another host forget bytes it already holds. Private content is encrypted on the device first
  ([`sealed-audiences.md`](sealed-audiences.md)) and is not public to begin with.
- **A showcase tile is a belief, not a copy.** Adding another domain's tile names it; it does not move its bytes into your
  root. Carrying bytes is what *following* is for.
- **A recycled name must start empty.** Anything the reader keeps per name (trust, stored state) is keyed by name **and** the
  publisher's key, never by name alone. Today code trust is keyed by domain alone, which is a known gap.

## The pin and a compromised host (jwize 2026-10-26: "overrideable before load, so securable even when compromised")

The pin is the one mutable pointer, so it is where a compromised host would strike. What the loader does today
(`hypercomb-shim/src/bootstrap-loader.ts`): it asks the **origin's** `/pin` first (so a repin takes effect), fetches the bundle
that signature names, and **verifies the bytes hash to that pin** before running them; if the fetched pin does not resolve it
falls back to the last pin that verified and ran (`hc:bootstrap-pin`). That stops a host from serving *wrong bytes under a pin*.
It does not stop a host from serving *its own pin and its own bundle*: they agree with each other, so the hash check passes.

So "securable" means one more rule, and it is a client-side one, decided before anything loads: **the pin a client acts on comes
from something it already trusts, never from the origin alone.** Candidates, strongest first: a signed install pointer
(`install:<name>` in the publisher's signed index, checked against a publisher key the client already holds), then the
last pin that verified on this device, then a pin the visitor carried in (a link). The origin's `/pin` is then only an
announcement that a newer pin exists, taken when the signed pointer says so. With that, a compromised host can cost a client
a 404 and nothing more, and recovery is moving the signed pointer ("update pointer and you are good").

Two limits that no page code can remove: **the first load from an origin the client has no memory of** trusts whatever that
origin serves as the loader (index.html, main.js), so a first visit is safe only when it arrives with a pin or a publisher
key (a link, an installed app, a service worker already holding the loader); and **the signing key** is still the root of
trust (see the key-list notes on recovery).

**Built:** hash-verify of the bundle against its pin; last-known-good fallback. **Not built:** choosing the pin from a signed
pointer or a carried key instead of the origin's `/pin`; the loader still prefers the origin's.

## Verified 2026-10-26 (live, hypercomb.com)

| Check | Result |
|---|---|
| A published atom asked of `hypercomb.com`, `camelflage.hypercomb.com`, `agenda.hypercomb.com` | **identical bytes, identical hash** |
| `GET /pin` on the zone root | the 65-byte pin |
| `GET /pin` on `camelflage.` and `agenda.` | **the hive's HTML page (≈74 KB), not the pin** |
| `jwize.com` root | no heap and no pin: atoms 404, `/` is the storage-host placeholder |

## Not built (in order of effect)

1. **Start-up files on every name.** The worker answers every path on a subdomain with the hive's page. It should answer the
   start-up paths (`/pin`, the service worker, locales, the mark) from the shared root first, and only then fall back to the
   page, so every name is the same cold-start door.
2. **`jwize.com` as a host.** Its root needs the signed shell staged and served (`hypercomb-relay/enable-host-shell.ps1`, run
   once as administrator against the `hypercomb-relay` service), then `check-host.mjs` against it.
3. **Key trust by name and key** (`trust:code` records `{domain}` only), so a recycled name inherits nothing.
4. **History copy as part of a publish** is a per-branch option whose default and exact contents in the pools have not been
   re-checked here; confirm before relying on it.
5. **Who may take a freed name** (a cooldown, or tying it to the first publisher's key).
