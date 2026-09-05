# Every act has a word

**Started 2026-09-03, from a complaint that was entirely correct.**

A participant asked a local model (Qwen 3) to delete a tile. The model replied
that Hypercomb has no delete behaviour. It was right about what it had been
given and wrong about the system: `/remove` has shipped for months, and any
participant can type it.

Two separate failures produced that answer, and this document is the checklist
for both.

## The two failures

**One — the model's vocabulary was a hand-kept table.**
`hypercomb-grammar.ts` held `CALLABLE_FORMS`: five behaviour names and their
argument shapes, written by hand, in the shell, beside the parser. Being a
second copy of a list, it drifted the way second copies always drift — toward
less than exists. FIXED: authority moved onto each behaviour
(`QueenBee.machine`, contract in
[`machine-grammar.ts`](../hypercomb-core/src/core/machine-grammar.ts)), the
shell derives from the live census, and a doctrine ratchet fails the suite if
the shell names a behaviour again. Full account:
[`hypercomb-communication-layer.md`](hypercomb-communication-layer.md).

**Two — some acts have no word at all.** Hiding a tile, undoing, copying,
pasting: reachable by icon, by keystroke, by button, and by nothing you could
say. That is not a cosmetic gap.

> **A capability with no word does not exist to a participant who is speaking,
> and does not exist at all to a model with no pointer and no bridge.**

The communication layer IS the grammar. Everything that happens in Hypercomb
therefore needs a word, and every word that a machine should be able to say
needs a `machine` declaration. Those are two different jobs and this doc tracks
both.

## Where it stands

| | Count |
|---|---|
| Behaviours in the live census | ~133 |
| Declaring a machine grammar | 12 |
| UI verbs with no behaviour word at all | 21 (see below) |

Default-deny is intact and meant to stay that way: 12 of 133 is not a
shortfall, it is the policy. The shortfall is the third row.

## Minted so far

Six verbs existed only as pointer targets and now have words. Each one calls
the same implementation the icon or keystroke calls — a door, never a second
mechanism.

| Word | Was reachable only by | Notes |
|---|---|---|
| `/hide <tile>`, `/hide ~<tile>` | a tile-overlay icon | HIDE FIRST, DELETE SECOND — the gentle half of the pair had no word while the harsh half did. Also mints `unhide` as an action name; `break-apart` reached it because the overlay reuses that icon slot |
| `/undo`, `/redo` | keystroke, control bar, phone deck | walks `HistoryCursorService`; the one wholly reversible verb in the language |
| `/copy`, `/cut` | keystroke, control bar | NAME their tiles on the machine seam — the button acts on the selection, which a speaker cannot see |
| `/paste` | keystroke, control bar | bare means something entire: place what is held, where you are |

And `/remove` — which already had a word — became sayable by a machine, at
`reach: 'destructive'`, stated in the catalogue, confirmed at its own door.

## Still wordless

Every action name the app dispatches on `tile:action` / `controls:action` with
no behaviour behind it. Regenerate with `node scripts/wordless-verbs.cjs`;
the list is mechanical, not curated.

**Worth a word (the real remainder):**

- `edit` — open a tile's content editor. Speaking is how you would want to
  write into a tile, and this is the one verb whose absence a speaker feels
  most.
- `open` / `enter` / `exit` — walking in and out. `/into` covers going in;
  there is no word for coming back out.
- `make-public` / `make-branch-public` — sharing scope. Outward-facing: give it
  a word, and think hard before giving it a `machine` declaration.
- `promote-to-parent` — move a tile up a level.
- `features` — the features panel.
- `view-documents` — very likely already `/files`; confirm before minting.

**Probably not verbs** (view chrome, or already covered elsewhere): `close`,
`fullscreen`, `list`, `library`, `new`, `save`, `camera`, `sync`, `apply`,
`adopt-selected`, `pheromones`, `clear-clipboard`.

The point of listing them anyway is that "probably not" is a judgement someone
should make out loud, once, rather than by omission.

## "We don't need the delete — the update does everything"

**Asked and settled 2026-09-03.** The answer is: right about the primitive,
right about the wrapping, wrong about the seam — and the first half is not a
proposal, it already shipped.

### Right about the primitive

There is no delete under `/remove`. It is one call:

```ts
await committer.update(segments, { children: survivorSigs }, new Set<string>())
```
— [remove.queen.ts:162](../hypercomb-essentials/src/commands/remove.queen.ts). The
tile's bytes, its whole subtree and its history bag all stay exactly where they
were; undoing the commit brings it back. The committer's own docstring says the
same thing in the same words:

> Add and remove are special cases of "the new children list is X".
> — [layer-committer.drone.ts:620](../hypercomb-essentials/src/history/layer-committer.drone.ts)

And `update` is stronger than the codebase gives it credit for. Four places
describe it as a total replace where an absent key wipes a slot; the
implementation hydrates a `LayerMachine` from the previous head and applies
`{op:'set'}` only for keys PRESENT in the delta, so one call can add, remove,
reorder AND decorate in a single layer file and a single marker. **Caveat found
by the completeness pass:** that merge is conditional on the previous head
resolving. On a cold parent chain `latestMarkerSigFor` deliberately answers with
the empty layer's sig without planting a marker, `fromLayer` copies no slots,
and the merge degrades to a replace — which is the orphaning shape a doctrine
ratchet already records. The docs and the code are describing the warm and cold
paths of one function, not contradicting each other. Any spec written here must
use a COLD bag or it proves nothing.

### Right about the wrapping

Beehaviors are the wrappers over that one primitive, and that is already the
architecture: `/create`, `/remove`, `/title`, `/keyword`, `/into`, `/cut` and
`/paste` all end in a layer commit. Nothing needs restructuring for this to be
true. What the verbs add on top is the part a desired-state payload could not
carry — a `refuse` message in the author's own words, a per-line receipt, an
honest `reach`, and a target the participant can name.

### Wrong about the seam, in three places

**Bytes.** An update only ever appends, so no desired layer state can free one.
Reclaiming bytes is `/prune` (`removeContentSigs`, `removeLineageBag`) and it is
deliberately not a verb at all — a mode you walk onto, triple-gated, declaring
no machine grammar. *Correction from the completeness pass:* the store already
implements the participant's actual model — append-only writes plus a
reachability collector rooted at **every marker in every bag**, so it structurally
cannot collect history
([packed-collect.ts](../hypercomb-runtime/src/packed-collect.ts)). It is wired as
`pack_collect` and exposed as `collect()` — **and nothing in the repo calls it.**
So the honest sentence is not "an update can never free a byte"; it is "the GC
that would free it is built, wired, and never invoked." Its own header explains
why it is unscheduled: freshly installed content is unreachable until a commit
puts it in the tree, and a collection racing an install swept 27 records and
churned. Scheduling it is open work, not a missing primitive.

**Text.** `update` is strings-only: it can carry a decoration's sig but can
never mint the resource that sig names. "Set the title to Road map" is
`putResource` then a slot write, and update owns only the second half. That is
not an oversight — content-addressing the record is what makes identically
titled cells dedup network-wide and what lets the bytes travel on push.

**Acts with no layer address.** `/hide` writes a session map and the mesh; bare
`/accent` writes localStorage; `/undo` moves a read cursor — and while the
cursor is rewound `#commit` refuses to run at all, so the two are mutually
exclusive; publish PUTs a signed index to a remote host. Renaming is not even in
the list: `update` strips the `name` key and `LayerMachine.apply` throws on it.
Identity is not a slot.

And the seam itself cannot carry a desired state regardless: a grammar line is
one printable line matching `/^\/([a-z][a-z0-9-]*)(?:\s+(.+))?$/` — one verb plus
one flat, unescaped argument. Any keyed-clause encoding must reserve a printable
delimiter over participant-authored free text, and rest-of-line-is-the-value is
the rule BOTH mouths of the language share. A collapsed `/update` would also
cost the six authored `refuse` voices, per-line receipts, an honest per-act
`reach`, and both destructive gates in the command line — which key on the
literal word `remove`.

**Decision: keep the verbs, do not build `/update` on the machine seam.**

### What the question fixed

Asking it found four real defects, three of them in the machine seam shipped
hours earlier:

- The catalogue printed a fixed sentence for every destructive verb — *"removes;
  asks the participant to confirm"* — and both halves were false. Nothing is
  removed from disk, and `confirmRemoval` returns true with **no dialog** when
  nothing is nested, which is the common case. A model read that line and
  relayed a confirmation that never happened. Fixed by moving the sentence onto
  the behaviour (`MachineGrammar.consequence`); the shell now quotes and never
  composes.
- `countSubtree` walked `children` only, while the canonical order is
  `CHILD_SLOTS = ['cells','layers','children']`. A tile whose subtree hung off
  `cells` or `layers` counted zero nested, so the one dialog `/remove` does
  raise was skipped precisely when a whole branch was about to leave the page.
  Fixed, with a regression spec proven to fail on the old code.
- A declined or impossible `/remove` resolved clean, so the receipt read
  "Ran 1 grammar" over work that never happened. It now throws.
- `/keyword` and `/accent` declared machine grammars while firing at the current
  SELECTION — which a speaker cannot see. `/accent` was worse: one line could
  write localStorage, the tag registry, or per-tile properties depending on
  invisible state. Both gained a `<cell> = <value>` form (the shape `/title`
  already uses) and the machine seam now admits only that.

### Still open from this pass

- **Nothing calls `collect()`.** Scheduling it — outside the install window — is
  the real answer to "when do the bytes go".
- **A second remove path in the shell.** The bracket op `[a,b] remove` routes to
  `#removeLabels`, which calls `removeEntry(leaf, {recursive:true})` — a genuine
  byte delete, no queen, no confirm. `CutPasteBehavior` has its own copy, and
  its paste half is a commented-out no-op, so a cut can delete the source and
  materialise nothing.
- **Undo does not restore a tile's art.** `SubstrateDrone` clears the cell on
  `cell:removed` — a forward write, not a history entry. `/remove`'s consequence
  line says so; the underlying asymmetry is unfixed.
- **`update`'s addressing is unguarded.** A malformed address binds to the
  participant's current location, which is a silent wrong-place commit rather
  than a `refuse`.
- **The history viewer's per-row trash calls `removeEntries`**, which hard-deletes
  markers, while its own docstring calls it a restorable soft-delete. Only
  `archiveEntries` parks anything.

## Rules for adding a word

1. **A door, not a mechanism.** The new behaviour ends in the same effect the
   button emits. One implementation of hiding; the queen is only a way to ask.
2. **Name the target on the machine seam.** A verb whose UI form acts on "the
   selection" must take explicit names when a machine says it. A model that
   guesses a target is worse than a model that is refused.
3. **Declare `machine` only if a speaker should have it**, and state `reach`
   honestly. Destructive is offered, not concealed — the guard is the
   behaviour's own confirmation, where the participant can see what goes.
4. **`refuse` what the parser would silently normalize.** A clean no-op earns a
   receipt for work that never happened, and a receipt must never lie.
5. **The catalogue keys go in all 14 locales** (`slash.<command>`), or the word
   silently falls back to English everywhere but here.

## Related

- [`hypercomb-communication-layer.md`](hypercomb-communication-layer.md) — the
  five surfaces, the wide door and the narrow one, and the declaration contract.
- [`everything-is-a-beehavior.md`](everything-is-a-beehavior.md) — the shrink
  campaign. Different axis: that one moves CODE out of the shell, this one
  moves ACTS into the language. They meet wherever a shell surface is the only
  way to do something.
- [`command-line-reference.md`](command-line-reference.md) — the participant's
  view of the same census.
