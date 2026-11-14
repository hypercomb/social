# The root screen — set the package root by its signature, before any package code loads

*jwize, 2026-11-13:* "we should have a place where we can do an override and set a
new signature root so that we can host any os." · "before dynamic loads so that we
have an injection point to save a corrupted or compromised build." · "Maybe something
we type into the console but probably should show some interface and input values
from there." · "and have the most recent as well. Maybe this file can only be created
by a remote signer."

And, settling that last thought the same day: "You only have to publish a package. The
override is just so that if something gets compromised it should load the default or a
set replacement." · "the replicator get the package they adopted so it would already
have the signature."

So there is no signing step and no override record. The screen loads **the default**,
or **a replacement the device already holds**: a package adopted here is held here with
its signature.

Everything else that changes what runs is drawn by the package: the hosts desk
([packages-window.md](packages-window.md)), the update notice, the words. A package
that is broken or hostile cannot be trusted to draw its own way out. The root screen
is the shell's.

## Where it stands

`hypercomb-web/src/setup/root-override.ts`, called from `bootstrap()` in `main.ts`
as `rootOverrideGate()`: after the packed-store gate, and **before `ensureInstall`,
the import map, `DependencyLoader.load`, the boot bees and Angular**. On a page where
the screen is up, no package code has run. It is plain DOM with its own styles.

This is app code, and has to be: it is the one part of the system that must work
when the package does not. Web shell only for now; the shim and the native shell do
not have it.

## How it is reached

- **The console:** `hypercomb.root()`, or `hypercomb.root('<sig>')` to fill the
  field. It only leaves a note for the next boot (`sessionStorage`,
  `hc:root-override`) and restarts, so the screen stands before dynamic loads.
  `main.ts` defines it before `bootstrap()`, so it answers even when the hive never
  comes up; the App keeps the word on the same object.
- **The address:** `?root`, or `?root=<sig>`. The parameter is taken off the address
  as it is read.

A note or a link can **open** the screen and **fill** the field. Neither can take a
root: that is a press on the screen's own form.

## What it shows

- the root running now;
- a field for a 64-character root signature, and **Take this root**;
- **Most recent**, each with *Use* (which fills the field):
  - **The default** — first. The root the publisher this shell ships with names in
    their signed index, read and schnorr-checked by the shell (`readInstallChannel`),
    with the date it was signed. It is read against the shell's own publisher record
    (`shellDefaultFollow`, `install-publisher.json`), never the follow record in
    browser storage: that record is exactly what a compromised build could have
    rewritten, and "load the default" has to mean the one it could not touch;
  - **Ran here before** — the roots this shell ran before the current one, newest
    first, up to five. The activation record carries them (`previous`, written by
    `activate()` in `hypercomb-runtime/src/acquire.ts` inside the write it already
    makes). A root that is also a saved package wears its name;
  - **Signed by the publisher you follow** — only when you follow a publisher other
    than the default: their signed root, named by the start of their key so a record
    that was changed under you is visible;
  - **Saved in this hive** — the newest members of this hive's own `host:packages`
    pool, by name (a package saved on the hosts desk lands here);
  - what each carried host lists as its head;
- **Continue without changing**, which lets the boot go on. Escape does the same.

## What may be taken

No unsigned door is opened. `planOverride` (pure) answers in this order:

| Door | When | How |
|---|---|---|
| **held** | the root was adopted here before — it ran here or was admitted here (the shell's signature store) — and reads as a package root | composed from bytes already held (`applySelection`); no host is asked. This is the rollback, and the "set replacement": the device already has it |
| **signed** | it is exactly the root a verified signed index names: the default's, or that of a publisher you follow | `acquire` through the gate's **OVERRIDE** door (`activation-authority.ts`), from that publisher's hosts, every file checked against its name |
| **origin** | this very domain serves the root's file | `acquire` from this origin; the gate's SELF door decides |

Anything else is refused, with the sentence saying why: not a signature, already
what runs, an index that was substituted (nothing is taken on its word; a held root
is still a rollback, and the default is still the default when it is another
publisher's index that was substituted), or a root nothing vouches for.

- **The root runs alone.** Picks laid over the trunk are released (`alone`), because
  a pick may be exactly what a rescue is leaving. Their bytes stay held.
- **Paths turned off stay off.** That only ever removes code.
- **Complete or absent.** A refusal or a failure leaves what runs exactly as it was.
- **Nothing is deleted,** and the screen keeps no record of its own: taking a root
  is the ordinary activation, so there is no second truth to drift or forge.
- **A trusted signature is not always a root.** The store trusts every signature it
  admitted, layers and draft records among them. Only a layer with packages under
  it and the bundles they import (`readsAsPackageRoot`) is taken as a root.
- Not on a published website (session memory, a publisher's renderer) and not on a
  sandbox door (which writes nothing).

After a take the shell caches the import map the new root makes and restarts onto it.

## Getting a replacement onto a device

Publish the package ([packages-window.md](packages-window.md), "A package of your
own"), and adopt it on the device the ordinary way, through the hosts desk. From then
on the device holds it and the screen can load it, by signature or from *Ran here
before*. A root a device has never adopted is taken there only if it is the default,
a followed publisher signed it, or that domain serves it.

## Ratchets

- `hypercomb-web/src/setup/root-override.spec.ts` — the plan (each door, each
  refusal, held before everything, nothing on a substituted index), what reads as a
  package root, the address and the console only opening the screen, the take calling
  the override door only for a signed root, the default read from the shell's own
  publisher and still taken when another index was substituted, no signing code in
  the file, and where the gate stands in `main.ts`.
- `hypercomb-runtime/src/activation-authority.spec.ts` — the OVERRIDE door admits
  only on the shell's word.
- `hypercomb-runtime/src/previous-roots.spec.ts` — the roots that ran before: the one
  being left goes first, the one being taken is never its own past, five kept, and no
  storage write of its own.
