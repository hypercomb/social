# Hide first, delete second

**Status: doctrine.** Any surface that lets a participant get rid of something
follows this, and nothing gets its own spelling of it.

## The rule

1. **A list offers HIDE, never delete.** Hiding takes the row out of the list,
   stops it being offered, and changes nothing else. It is reversible and it is
   the only removing act a list is allowed to show.
2. **What was hidden collects in a DELETE AREA.** A fold you open on purpose,
   holding only what you already put away.
3. **Deleting exists only in that area.** You cannot delete something you did
   not first hide — not by convention, but because the write refuses it.
4. **Not everything hidden is deletable.** The surface that owns a thing says
   whether it may ever be destroyed. Absent means no. Hidden-but-undeletable
   rows show in the delete area with no delete button — "you can put it away"
   and "you can destroy it" are two different permissions.

## Why

Deleting is the only act that cannot be answered by pressing something again.
A list is full of things the participant did not choose and mostly does not
want, so the act a list offers has to be the one that costs nothing to get
wrong. Putting delete there means every accident is permanent; putting hide
there means every accident is one press from undone.

The second reason is that hiding is *useful on its own*. A host ledger lists
every build a domain ever published and every one of them is a valid root
forever. The builds you never want to apply are noise sitting next to the one
you do — and one of them is a **downgrade** waiting to be pressed. Hiding is
how a long list becomes your list.

## What "delete" is allowed to mean

**A local forget.** The thing stops being listed here, permanently, and does not
come back when the source is read again. It does not reach across the network.
A build deleted from a host's ledger is still on that host, still valid, still
fetchable by signature by anybody who names it — that is what content
addressing means and no local act can change it.

Say that in the UI. "Deleted" while meaning "hidden forever, here" is the
honest reading, and a surface must not promise more than it can do.

## The mechanism

One pool, one owner, one render.

- `hidden:items` — a pool of meaning holding one artifact per concealed thing,
  named by its own content (`concealment/concealment.ts`). The pool IS the set;
  nothing holds a list.
- `ConcealmentDrone` (`concealment/concealment.drone.ts`) owns the reads and the
  three acts. Surfaces emit `hidden:conceal` / `hidden:reveal` / `hidden:delete`
  and read `hidden:render`.
- The record carries `state: 'hidden' | 'deleted'`, so the two are different
  bytes and a state change is a remove-then-write, never an edit. Deleted
  outranks hidden if both records somehow exist.
- **Both gates live in the pool module**, not in a panel: `deleteConcealed`
  refuses anything that is not already hidden and was not marked deletable. A
  new surface cannot route around them by emitting a different effect.

A concealment carries `scope` (the surface's word for the kind of thing —
`host-build`, `publish-version`) and `from` (where it came from — a zone, a
branch path), which is how a surface renders only its own.

## What a list looks like afterwards

The pattern the host ledger already had, and the delete area repeats:

```
development
   Aug 30, 14:02
   Aug 29, 09:41
feltlikerenaming
   Aug 24, 18:10
   Aug 22, 11:55
oldname
   ...
```

**The name is a heading, not an item.** The dates are the items — they are what
you apply, hide and delete. A rename simply starts a new heading; nothing is
migrated and nothing is explained. The heading carries the one control that
acts on every date under it, because a name you stopped using is a *run* you
want gone, not fifteen presses.

## Related vocabulary: APPLY, never add

A build you pick from a ledger does not join what you have — it **replaces**
what you are running, and it can be older than what you are running. "Add"
hides that; **apply** says it. The word matters most exactly where the mistake
is easy: a ledger row several screens down is a downgrade with a friendly name.

## Where it is in force

- Host directory (`/hosts`) — a host's build ledger.
- Publish panel — a branch's published versions.

Anything that grows a "get rid of this" affordance next joins this list rather
than inventing a second way. Ratchets: `concealment/concealment.spec.ts`,
`sharing/community-hosts-panel.spec.ts`.
