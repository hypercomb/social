# The natural-language surface — an audit, and what a grant would have to gate

**Status: AUDIT, 2026-09-04.** Ten agents over five dimensions, each finding
adversarially refuted before it was kept. Several claims in the first pass were
overstated and are recorded here in their corrected form.

> **⚠ RESOLVED 2026-09-04 (`6f99f2da4`) — this audit now describes
> `development`.** It did not when written.
>
> The census-derived vocabulary audited here — `MachineGrammar`, `reach`, the
> twelve verbs — was **entirely uncommitted working-tree work**, and four of the
> eight files that constitute it were untracked, including `machine-grammar.ts`,
> the contract itself. HEAD's model channel was still the hand-written
> `CALLABLE_FORMS` table of five. Nothing was broken by that — committed code
> referenced none of it — but two things followed, and both bit.
>
> **The fix for the incident that prompted this audit was written and
> unlanded.** A model told a participant Hypercomb has no delete because the
> five-verb table omitted `/remove`; the census that includes it had sat in the
> tree for a day. And **improvements to those files evaporated on checkout** —
> twice in one day, to items in this document's own Owed list, silently, caught
> only because a diff showed zero hunks where edits were expected.
>
> Landed at the participant's direction, with authorship attributed to the
> every-act-has-a-word session. Two files were reduced to their share rather
> than swept: `side-effects.ts` carries only this feature's three registrations,
> and `doctrine.spec.ts` was split — its **ratchet landed** (`ba45150b3`,
> *"the model grammar module names no behaviour"*, which is what stops the
> hand-kept table growing back), while the allowlist removal riding alongside it
> did not, being correct only once another session's staged deletion of the
> feedback-viewer lands.

**The one sentence:** four surfaces turn language into execution, exactly one of
them is default-deny, and the field that looks like the capability tier
(`MachineGrammar.reach`) is decorative **by design** — so a sandbox is not a
tightening of an existing gate, it is the first consent artifact in this path.

> **RESOLVED 2026-09-04 — DEFAULT-ELSEWHERE.** The decision moved OFF the doors.
> `hypercomb-core/src/core/machine-admission.ts` answers *may this caller say
> this word* once, and both machine doors ask it: the bridge as `'operator'`,
> the model channel as `'model'`. They differ in exactly one bit — whether a
> `machine` declaration is required — and share everything else, so the
> divergence this document is mostly about can no longer be reintroduced
> quietly. `reach` and `scope` stopped being decorative in the same commit: they
> are now weighed against a participant-held ceiling, default `editing/network`,
> written by `/grant` and by nothing else. A doctrine ratchet fails the suite if
> any door compares a declared `reach` or `scope` against a literal again.
>
> What did NOT change: the keyboard. A person typing into their own command line
> is not a caller to be admitted, and `MachineCaller` has no `'participant'`
> member — the day it gains one is the day somebody starts gating the owner.

Companions — read these rather than treating this document as authority on their
subject: `hypercomb-communication-layer.md` (the channels and their contracts),
`every-act-has-a-word.md` (the vocabulary backlog), `intake-filter.md` (inbound
content; its selection/intake/activation table is the right frame and this is a
*fourth* gate, not one of those three),
`trust-boundary-and-the-extension-question.md`.

## The census: twelve verbs of roughly a hundred and nine

| reach | n | verbs |
|---|---|---|
| `additive` | 4 | create, postit, copy, paste |
| `editing` | 6 | keyword, accent, title, hide, undo, redo |
| `destructive` | 2 | **remove**, **cut** |

*(`cut` was listed as `editing` in the first pass and is `destructive` in the
code: it calls `commitChildrenDeltas` with `removes`, so the parent stops
holding the tile exactly as `/remove` makes it stop. That correction is why the
retired four-name destructive set — `remove, rm, delete, del` — was the wrong
shape rather than merely an incomplete list.)*

All twelve declare `refuse`. `keyword`, `accent` and `remove` are declared
inline in `slash-behaviour.drone.ts` rather than in their queen files.

**Twelve of ~109 participant-facing primary behaviours are machine-callable —
about 11%.** Roughly 97 verbs are wordless to a model, including `/enroll` (the
one verb by which artifacts belong together), `/reference`, `/requires`,
`/move`, `/publish`, `/website`, `/frame`, `/layout`, `/template`, `/brief`.

## The four surfaces do not agree, and it is a fork rather than a gradient

This is the headline finding. **Exactly one surface implements default-deny.**

| | declares `machine`? | hidden filtered? | aliases? | destructive gate | census re-check |
|---|---|---|---|---|---|
| **Model channel** (`hypercomb_act`) | **required** | yes | primary names only | none | **per action** |
| Keyboard prose (`#commitUtterance`) | not required | yes | yes | `DESTRUCTIVE_COMMANDS` (4 names) | no |
| Canonical slash (keyboard) | not required | **no** | yes | **none** | no |
| Bridge `submit` | not required | **no** | yes | prose only — see below | no |

**As of the default-elsewhere pass, the two MACHINE rows read one rule.** The
table above is kept because it is what the code looked like when the finding was
made, and because the shape of the disagreement is the argument. What it looks
like now:

| | declares `machine`? | concealed | reach / scope | resolves |
|---|---|---|---|---|
| **Model channel** (`hypercomb_act`) | **required** | refused | against the grant | primary names only |
| **Bridge `submit`** | not required | refused | against the grant | primary names + participant aliases |
| Keyboard (prose and canonical slash) | — | — | — | the participant is not a caller |

The two machine rows differ where they must and nowhere else. A declaration is
not required of the bridge because ~97 of ~109 behaviours declare none, and
requiring one there would break the authoring tool this hive is built with while
protecting nobody who is not present. Resolution differs because the model
channel must never let a participant alias redirect a canonical word, and the
bridge must accept the line a person would type — which is also what makes `rm`
inherit `remove`'s reach rather than being absent from a list.

`SlashBehaviourDrone.execute` resolves **any name or alias, hidden or not,
machine-declared or not, and runs it** — no `#present` call, no hidden check
([slash-behaviour.drone.ts:143](../hypercomb-essentials/src/commands/slash-behaviour.drone.ts:143)).
Only its sibling `executePublicCanonical` (:158–167) skips hidden and prototype
and matches primary names.

**So a grant layer bolted onto `MachineGrammar` would gate the one door that is
already the tightest and leave three wide ones open.**

### Hidden is a discoverability flag being read as an authorization flag

Eleven behaviours are `slashHidden` — documented as *"must be typed in full on
purpose"*, which is a **human-typing assumption**. Over the bridge a machine
types in full trivially. Six of the eleven are genuinely destructive: `flatten`,
`prune`, `collapse-history`, `consolidate-history`, `consolidate-content`,
`sweep`. (The other five — `debug`, `view-current`, `verify-history`,
`mesh-block`, `mesh-clear` — are dev/diagnostic; the first pass overstated the
set.) `/flatten` is the verb that once hard-deleted a pool it mistook for a bag.

**Verified live 2026-09-04 against a running hive, and two of those names are
gone.** The census carries twelve `slashHidden` verbs — `prune`, `sweep`,
`consolidate-history`, `consolidate-content`, `debug`, `verify-history`,
`view-current`, `atlas`, `studio`, `lounge`, `block-peer`, `clear-mesh` —
and neither `flatten` nor `collapse-history` is among them; both were retired
in the behaviour prune. The gate reads the FLAG, never a list of the verbs
carrying it, which is why this correction changes prose and no code.

### A defect in code committed today — *fixed 2026-09-04 (`453bafd98`)*

`fdcfc6152` added a destructive refusal to the bridge's remote-submit listener,
and **it was shaped for the wrong input.** The guard sat behind
`const prose = !text.trimStart().startsWith('/')`, so only a prose reading was
checked against `DESTRUCTIVE_COMMANDS` — and `/remove drafts` skipped the reader
entirely and fell to the legacy pipeline.

**Canonical slash is precisely what a machine emits** — the model channel's
parser accepts nothing else. The only caller-aware destructive gate in the tree
was defeated by writing the line the catalogue teaches.

Corrected by the verifier: over the bridge a **leaf** removal ran untouched; a
**nested** one hung on a `requestConfirm` modal no agent can press.

**Fixed in `453bafd98`**: one destructive decision now precedes the prose/slash
fork and reads whichever form the verb arrived in. The verb-reading rule moved
into core as `canonicalVerbOf`, with six regression specs covering the
leading-whitespace smuggle and the head-verb-only rule (`/create /remove` names
`create`). Still keyed on the four-name set — see `/cut` below; that is owed.

### And the receipt was dead code for the only production caller — *fixed (`453bafd98`)*

`#submit` passed neither `accept` nor `complete` and returned `{ok:true}`
unconditionally, so the `RemoteSubmitOutcome` the listener computed was
**discarded** — refusals, ambiguities and per-action failures all reached an
agent as success. It also used `EffectBus.emit` rather than `emitTransient`, the
replay hazard the contract explicitly forbids: on a component remount the last
bridge-submitted line would **re-execute with no caller and no receipt**.

**Fixed in `453bafd98`** — both halves, plus an 8s deadline that is a wedge
backstop rather than the normal exit (the listener settles on every path), and
which also keeps the quiet window from wedging, since `submit` is in
`#MUTATING_OPS` and `#quietDone` runs in a `finally`.

**The operational lesson is worth more than the fix.** The essentials half was
written hours earlier and left uncommitted because that file carried another
session's in-flight work — and it was **silently reverted when that session
committed**. Uncommitted work in a contested file does not survive. The correct
move was to commit the two halves separately from the start, not to hold one
back.

The same `emit`-instead-of-`emitTransient` defect still exists at
`bee-tutorial.drone.ts:582`.

## Can a model delete a tile unattended? Yes — *no longer, as of 2026-09-04.*

> Under the standing default grant (`editing/network`) `/remove` and `/cut` are
> neither offered nor admitted to the model channel. The finding below is what
> the code did before that ceiling existed, and the reasoning is still why the
> ceiling stops where it does. Raising it is one line — `/grant destructive` —
> and that is the point: it is now a thing a participant chose.


Blunt answer: **a trusted local model can remove a leaf tile with no dialog and
no human confirmation.** One `hypercomb_act` call carrying `/remove <tile>` runs
to a committed layer; the participant learns of it from the after-the-fact
receipt.

`confirmRemoval` returns true with no dialog whenever nothing is nested —
`if (nested <= 0 && !always) return true`
([remove-confirm.ts:88](../hypercomb-essentials/src/commands/remove-confirm.ts:88))
— and `RemoveQueenBee` passes no `always`. This is **deliberate and honest**:
the source says leaf deletes *"skip the prompt and stay frictionless — so a
caller must NOT promise a confirmation, and the machine catalogue no longer
does."* The catalogue clause is accordingly truthful: *"Asks first only when
other tiles are nested beneath."*

The mitigations are real but narrow. `/remove` is an **unlink, not a delete** —
one `LayerCommitter.update` setting the parent's `children` to the survivors;
bytes, subtree and history survive and `/undo` restores. Caps exist: 1000
characters per grammar line, twelve lines per plan, one `hypercomb_act` call per
round (the first pass called the bracket list "unbounded" — overstated).

**The whole trust decision is that the endpoint's hostname is loopback.** That
is a fact about where a process runs, not about who wrote it or what it wants.
`canAct` is unconditionally true whenever the slash drone is registered
([chat-window.component.ts:3060](../hypercomb-shared/ui/chat-window/chat-window.component.ts:3060)).
There is no participant opt-in anywhere in this path.

### `/cut` is the same shape and is not on the list

`/cut` drops a child from its parent exactly as `/remove` does, declares
`reach: 'editing'`, and is absent from `DESTRUCTIVE_COMMANDS`. It is ungated by
all four destructive checks.

Sharpened by the verifier: the committer methods differ (`update` with a full
survivor list versus `commitChildrenDeltas` with a removes-delta), `/cut` does
carry one gate `/remove` lacks (`#blockedByRewound` refuses while the history
cursor is rewound), and it stages the tiles on the clipboard so `/paste`
restores them. So it is *ungated by the destructive checks*, not gate-free.

**The point stands and is the important one: the destructive gate is a
hand-kept four-name set** (`remove, rm, delete, del`) — the identical mistake
the retired `CALLABLE_FORMS` table made. A grant keyed on names will drift the
same way. It must key on a declared property.

## `reach` is decorative, and that is a stated design position

Twelve behaviours declare it. Three test files read it. **No production code
reads it at all** — the catalogue prints `description`, quoted `consequence` and
`example`, never `reach`; `parseLine` checks `bare` and `refuse` and ignores it.

This is not an oversight. Core says so in its own docstring:

> honest labelling for the participant's receipt, not an authorization tier — a
> declared behaviour is callable at every reach

([machine-grammar.ts:29](../hypercomb-core/src/core/machine-grammar.ts:29))

That cuts both ways for a grant layer. **Good:** nothing depends on `reach`, so
it can be made load-bearing without breaking a caller. **Bad:** every existing
value was chosen by an author who knew it was only a label, so none was written
under authorization pressure — and `/cut` is already mis-declared. Adopting
`reach` as a tier means auditing all twelve declarations first.

## False success: half the vocabulary cannot report what it did

**Six of the twelve machine verbs resolve on delivery, not completion.** copy,
cut and paste end in `EffectBus.emit('controls:action', …)`; hide ends in an
emit; undo and redo call a void `cursor.undo()`. `EffectBus.emit` calls handlers
synchronously and **discards any promise they return**, so `execute()` resolves
the instant dispatch returns.

Only `create` uses an honest acknowledgement (`accept`/`complete`, awaited).

Four consequences, all verified:

- **`/copy X` then `/paste` is a genuine race.** The worker stages the clipboard
  only after a chain of awaits; `#paste` returns silently when the clipboard is
  empty. The receipt still prints "Ran 2 grammars". A model that then runs
  `/remove` on the source destroys the original with nothing at the destination
  — and a grant layer would have authorized all three verbs individually and
  been right each time.
- **`/undo N` steps back exactly one action and reports N.** The queen loops
  `step()` N times synchronously; each launched walk reads `#position` before
  its first await, so they all compute the same target and the first `seek`
  makes the rest early-return. **Undo is the repair verb** — the escape hatch a
  participant would reach for to reverse a stranger's model — and it silently
  does not work at the moment it matters most.
- **`/remove` reports success for removals that did not happen**, two ways:
  `removeTilesAt` discards the return of `committer.update` (which returns `''`
  after logging "update refused — no address resolvable"), and when no child
  name matches the normalized target the survivor list equals every child, so a
  no-op commit runs and returns `true`.
- **`/keyword` swallows per-target write failures** in a `console.warn` catch
  and resolves clean, and skips the write block entirely when DecorationService
  is absent. Partial application is indistinguishable from full.

**Abort does not stop work already launched.** `abortablePlanResult` rejects on
the abort event while the operation continues to the next action boundary, and
every fire-and-forget continuation an earlier action started has no cancellation
path. Stop is the participant's revocation gesture; it revokes the plan, not the
effects in flight.

**And the unit of authorization is not the unit of atomicity.** Validation is
all-or-nothing — one unknown grammar rejects the batch with nothing executed —
but execution is not: a thrown action stops the tail with no rollback. **A grant
approving a plan is approving an arbitrary prefix of it.**

## What the model is told

One catalogue entry, verbatim:

```
/remove <tile> | [<tile>, <tile>, ...] - Remove tiles from the current
directory. Takes tiles off this page; their content, subtree and history
survive and /undo restores them, though a tile regains its auto-assigned art
only by re-picking it. Asks first only when other tiles are nested beneath.
Example: /remove drafts
```

The text is carefully anti-embellished and the census derivation is genuinely
default-deny. Three failures matter anyway.

**The pheromone mismatch is real and reproducible from the text alone.** The
word *pheromone* appears in **zero** of the twelve machine descriptions, forms,
consequences or examples, and there is no `pheromone` alias anywhere in
essentials. The participant-facing catalog uses it **44 times**, including the
panel title: `"tags.viewer.title": "Pheromones"`. The machine seam says
`"Add or remove keywords (tags) on selected tiles"`.

So a model asked to create a pheromone reads "keywords (tags)", correctly
reports it cannot, and — as happened — incorrectly generalizes that into
"Hypercomb has no pheromones". **The catalogue speaks the code's nouns, not the
participant's.** That is a class, not one word, and any grant advertising
capabilities to a stranger's model inherits it.

**`/remove` is the second line a model reads; `/hide` is buried far below it**,
because the three inline manual providers register at priority 100 and every
auto-wrapped queen at 50. Nothing tells a model to prefer the reversible verb,
despite `hide.queen`'s own docstring claiming it is *"offered to machines BEFORE
/remove is reached for"*. **HIDE FIRST, DELETE SECOND is doctrine the
participant holds and the model is never told** — and ordering is a policy lever
nobody is currently pulling.

**`/keyword` writes the global TagRegistry** — minting a hive-wide pheromone
visible in the participant's panel — and the consequence text says only "Tags
the named tile". A per-tile grant would be violated by the global side effect
the text hides. Two smaller contradictions: the description says "on selected
tiles" while the forms require an explicit `<cell> =` target (selection forms
were deliberately withheld from machines), and the consequence documents a `~`
removal form the `forms` string never shows.

**No participant-facing surface renders the catalogue at all.** `.machine` is
read in exactly one place outside its own specs. There is no audit view, no
`/help` marker distinguishing machine-callable verbs, and no doc. **A grant is a
thing a participant must be able to read before giving it.**

## What a grant layer would have to own

**There is no grant record anywhere** — not even in skeleton. The only two
authorization bits are transport-shaped and binary: the model channel trusts
provider id `'local'` when it is machine-local, has an endpoint, and is ready;
the bridge trusts any loopback page carrying the opt-in. Per-provider activation
defaults to ON.

**Nobody is asked when a behaviour arrives.** A bee replicated into a hive
self-registers, and if its queen declares `machine` the verb becomes callable by
every trusted local model. There is no roster gate between "installed" and
"machine-callable". The old `CALLABLE_FORMS` drifted toward less than exists —
which is why it died — but it had a virtue worth keeping: **the shell decided.**
The end state is two gates: the behaviour **offers**, the owner **grants**, and
the effective set is the intersection.

**There is no single seam.** The first pass claimed `SlashBehaviourDrone.execute`
was the chokepoint; the verifier refuted it — the model channel calls
`executePublicCanonical` instead, and two further callers exist outside the four
surfaces. Neither method carries a principal: both take `(name, args)` and
nothing else. Enforcement needs a shared inner seam both delegate to, with the
caller's identity carried in.

**There is no confirmation seam between parse and execution.** The plan is
parsed, then executed line by line; the only runtime re-check is that the
command is still machine-callable, and the receipt is emitted after the work is
done. `guardedExecutor.execute` is the natural insertion point — it already
re-derives the live census per action — but it checks membership, never
authority.

**Identity is weak.** A model name supplied by a local server is not a strong
identity, and the process that bound 127.0.0.1 is not the person who wrote the
model. For a real sandbox the host must own the grant and bind it to an
authenticated key.

**Reads need separate scoping.** `hypercomb_observe` returns structure — paths,
names, depth, child counts. Beyond that, success/failure of an *additive* verb
is an existence oracle: a caller who may only create can enumerate a hive by
probing. A sandbox that scopes writes and not reads is not a sandbox.

## The working prototype is in the wrong place

Worth stating plainly, because it is the good news. The model channel already
carries four guards no other surface has: the plan is fully parsed before any
Queen runs, execution is serialized in one app-wide lane, the page/selection
context key is re-checked immediately before each line, and the census is
re-derived per action so a behaviour that stops being callable mid-plan is
refused.

**Its shape — declare on the behaviour, filter the census, re-check at the seam,
refuse with a reason — is exactly right.** It needs to move down so the other
three doors inherit it, and to grow a principal.

## Not this

- **Do not key a grant on verb names.** The four-name `DESTRUCTIVE_COMMANDS` set
  already proves the drift: `/cut` does the same thing and is not on it.
- **Do not treat `slashHidden` as authorization.** It is a discoverability flag
  resting on a human-typing assumption a machine defeats for free.
- **Do not gate only `MachineGrammar`.** That secures the tightest door and
  leaves three open.
- **Do not build the grant before the receipt is honest.** Half the vocabulary
  cannot report whether it acted; a grant you cannot audit is a promise, not a
  control.

## Owed, in the order that unblocks the most

1. ~~**Fix the bridge's destructive guard** — it checks prose and a machine
   emits slash.~~ **Resolved 2026-09-04** by `453bafd98`: one destructive
   decision now precedes the prose/slash fork, and the verb-reading rule moved
   into core as `canonicalVerbOf` with six regression specs.
2. ~~**Land the `#submit` receipt half** and switch it to `emitTransient`.~~
   **Resolved 2026-09-04** by `453bafd98`. Note for the record: the first
   attempt was left uncommitted because that file carried another session's
   work, and it was **reverted when that session committed** — uncommitted work
   in a contested file does not survive.
3. **Correct `/cut`'s `reach`** to `destructive`, and audit the other eleven
   declarations before `reach` is ever read as a tier.
4. ~~**Fix `/undo N`** — the repair verb, silently broken.~~ **Resolved
   2026-09-04** by `44f720d3f`: the cursor serializes its own walks, so N steps
   land regardless of caller. Still owed on top — `undo.queen.ts` reports the
   number ASKED FOR rather than the number that moved, so it overstates when
   the walk hits the floor; that file is untracked work from another session.
5. **Make the fire-and-forget six honest**, using `create.queen`'s
   accept/complete pattern. Six verbs, one known-good template.
6. **Teach the catalogue the participant's nouns** — say "keyword / tag /
   author pheromone", and state `/keyword`'s global registry write.
7. **Order the catalogue by reach**, so `/hide` precedes `/remove`.
8. **Render the catalogue to the participant** before any grant exists to give.
