# Remove from my hosts: secure delete

Everyday visibility is the **domain switch** on a layer's Publish panel: on,
the place is served on that domain; off, it is not. That is the normal act,
and it deletes nothing.

Secure delete is the rare act after it. The place is already off on every
domain, and now **your hosts should stop holding what only it used**.

## Rules

1. **Hide first, delete second.** It is offered only for a place that is off
   everywhere and was published from this hive (`hide-first-delete-second.md`).
   A place any domain still shows is refused (`still-open`).
2. **What gets forgotten** is every signature reachable from every version
   this place published, **minus** every signature reachable from any head your
   signed index still names.
3. **An incomplete keep-set deletes nothing.** If an open place cannot be
   walked completely from this hive's own bytes, for example because it was
   published from another device, the act stops (`keep-incomplete`). A system
   root (`install:<name>`, `vocabulary:…`) keeps what it reaches here, and the
   host guards the rest.
4. **Every host guards again.**
   - **Cloud (`pluginthematrix-core`)**: `POST /forget`, signed NIP-98 by the
     publisher. A sig is deleted only when this key is its **sole claimant**.
     Every object stored from 2026-09-22 records its first uploader. A second
     publisher uploading identical bytes marks the object **shared**, and it is
     never deleted. Objects stored before claims existed have no claim and are
     never deleted. A head the publisher's own index still names is kept.
   - **A relay (`hypercomb-relay`)** has one owner, so it forgets any flat atom
     it is asked to, except what its published packages need: the closure of
     every `host:packages` member is kept. Pools and history bags are never
     touched. Removed atoms lose their receipts, so a later publish uploads
     them again instead of believing they are held.
5. **It is the host forgetting, not a recall.** Anyone who already holds the
   bytes keeps them, and this hive keeps its own copy. The UI says so every
   time.

## Where it lives

- Routine: `secureDeleteBranch` in `hypercomb-essentials/src/sharing/publish-branch.ts`
- Closure walk: `HostSyncService.closureSigs` (collects, and reports whether it was complete)
- Intent: `publish:forget {key}` → `PublishStatusDrone`
- Panel: the folded Status section, at the bottom, behind a confirm
- Hosts: `forgetSigs` in `blossom-worker/worker.js`; `tryForget` in `hypercomb-relay/relay.js`
