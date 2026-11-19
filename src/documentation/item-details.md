# Item details — hold an item, read more, say more

**Status: BUILT 2026-11-18, not deployed.** jwize: "on the community you should be able to hold down on the item and open up the row's details or a new screen altogether whichever makes most sense. That way you can get more information and share more information if you are the author." And: "using pools so that it is a proper extension point like everything."

## What a person does

On a front door (the community page a domain's root shows), **hold a tile** — or right-click it, or press Space on it. A sheet comes up from the bottom on a phone, in the middle on a desktop:

- the tile's picture, its name, whether it is a hive or a creation, and who publishes it;
- what its author says about it, then what this domain's owners say, then your own note; anybody else's notes are counted and one press away;
- **Share** — the phone's own share sheet where there is one, else the link on the clipboard;
- the act the sheet already had (stage it, put it in, take it out);
- the domains that hold it as a different version, as before.

Where a key of yours answers on the page (the hive beside it, or a phone that took its owner's invite), the sheet has a box: **Say more about it** when you are the item's author, **Add your note** when you are not. Save signs it. An empty box takes your word back.

It is a sheet and not a new screen: the page behind it is the community, and a hold is a look, not a trip. Nothing here navigates.

## The shape: a pool per item

What is said about an item is never a field on the item. It is a **pool of meaning**:

| Piece | What it is | Where |
|---|---|---|
| The item | a publisher's key and the lineage they publish under — a showcase item | `showcase-record.ts` `ShowcaseItem` |
| Its meaning | `details:<sign(key + "\n" + lineage)>` — the index key and the pool meaning | `item-details.ts` `detailsKey` |
| A word | `{ kind: 'item:details', pubkey, lineage, parts: [{ name, text }] }`, one resource on the host | `detailsBytes` |
| Its claim | the speaker's OWN signed index names the record under the meaning — one word per key per item; saying it again replaces it | phone: `device-owner.ts` `detailsAttempt`; hive: essentials `sharing/item-details.ts` `applyDetails` |
| Finding it | a host lists who spoke at the pool's derived address, `<origin>/<sign(meaning)>/`, one key per line; every pool that exists is named in `sign('details:pools')` | worker `noteDetailSpeakers`, `isDetailsPool` |
| Reading it | the author is asked by key, listing or not; everybody else by the listing. Each word is read from its speaker's own index and must hash to its name and be about this item | shim `item-details.ts` `readDetails` |

This is the path a page's contributions take (`page:<base>`, page-contributions.md). The key is the item's identity and not a head, so what is said stays with the item across revisions.

## The extension point

A word is **named parts**. The names are open. The sheet writes one part, `about`, and draws it with no heading; every other part is drawn as its name over its words. So:

- a behaviour, a script or an agent adds a part of its own (`how to play`, `credits`, `changes`) to its key's word, and the sheet shows it with no change to the page;
- saving from the sheet changes only `about` and carries every other part the key already named;
- anybody with a key speaks about any item. The author's word is not special in the pool — it is drawn first because its key is the item's.

Limits, held by every reader: twelve parts, a name of forty characters, two thousand characters of words, sixteen speakers read per host. Words only, drawn as text; nothing a word carries is run or fetched.

## What it deliberately does not do

- It does not judge. A stranger's note is a person's word under their key: counted, and shown only when the reader opens it.
- It does not push. Nothing is read until a tile is held, and nothing is written without Save.
- It does not delete. Taking a word back removes its name from your index; the bytes are unreachable, never removed.

## Rollout

The author's word works on any host that serves signed indexes, with no host change: it is asked for by key. Other people's notes need the host to list the pool, which is the worker change (`noteDetailSpeakers`). The page is the shim; the hive's end of the bridge ships in essentials. A hive that has not updated does not answer `details`, and the sheet says the hive did not answer.

`listPoolNames` (core `host-offerings.ts`) is the quiet listing ask a host page uses: `?held`, so a host with no pool answers 204 and no red console line. A host page cannot import essentials' `pool-listing.ts`.
