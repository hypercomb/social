# Spoken programs — a hypothesis

**2026-10-25. Status: hypothesis. Nothing here is built except what the
"What exists" section names, and none of that has been shown to carry the
claim.** Written from a conversation with jwize; his words are quoted where
they carry the idea.

## The claim

Agents — the hive's own models, and desktop harnesses such as Claude Code,
Codex and Hermes — should not pass each other code. They should pass a
**request in the hive's spoken grammar**: an ordered composition of declared
words (a *plan*), small, signed, and deterministic in meaning. Code is
*derived* from that request where it is needed, by a translator, and cached
under the request's signature. Whoever receives a request can recompute, for
themselves, how far it reaches and whether it may run here.

> "we create an internal library and a language to piece it together" · "the
> language doesn't need to be human readable just the results have to pass the
> test" · "something like a deterministic code that can be translated or even
> JIT'd" · "it would have to be verifiably safe as well."

Four parts, each separately testable:

1. **The request is the program.** A plan of declared words with typed
   arguments. No escape hatch: it can say only what the words allow.
2. **Code is a derived cache.** Keyed by *(program signature, translator
   version)*; never load-bearing; wipe-safe; rebuilt on demand. This is the
   optimize-phase rule (`optimize-phase.md`) applied to programs, not a new
   rule.
3. **Safety is recomputed, not claimed.** The program's reach, scope, and
   whether it leaves the machine are derived from the words' own
   declarations by the receiver, then checked against the receiver's grants.
4. **Pieces improve by selection.** A piece is a signed creation with a
   declaration. Which pieces thrive is decided by outcome records on their
   signatures, not by who published them.

## Why it might be true

- Signatures already name content; the same program is the same program on
  every host, and a better one is a new signature with the old still readable.
- Every word already declares what it takes, how far it reaches, and an
  example (`machine` blocks). That is most of an interface description.
- A plan already runs as one unit and is put back when a line fails.
- The grant model already makes a *widened* declaration lapse until the
  participant allows it again — the right behaviour for pieces that change.

## What exists today (and what it shows)

| Piece | Where | State |
| --- | --- | --- |
| Admission of a spoken call: off switch, offered, granted, reach, scope | `hypercomb-core/src/core/machine-admission.ts` | built; reasons are said |
| A plan's farthest reach, lines that leave the machine, lines beyond pages | `hypercomb-shared/ui/chat-window/hypercomb-grammar.ts` | built; computed from declarations |
| A failed plan is put back | `hypercomb-plan-transaction.ts` | built |
| Writes wait for a hand; policy per kind; per-actor grants | `execution-queue.ts`, `permit-groups.ts` | built; the Run button now also shows in the thread |
| Doctrine judged one section at a time on every proposed change | `assistant/anatomy/doctrine.ts` | built |
| A word that moves tiles by name, several groups as one act, on any page | `commands/into.queen.ts` | built; withheld tiles refused |
| A harness addressing a tile's own conversation by route and name | `chat-ask` in `claude-bridge.worker.ts`, `scripts/bridge/tell.cjs` | built; not trusted; opens the chat on request |
| A reply with a fence of bare commands is sent back once | `core/work-fence.ts` | built |

**Evidence from this session, stated plainly.** A plain sentence into a tile's
conversation made a hive model choose `into` by itself and propose the right
move. It also: put a fence where a runnable block was needed (twice); left
out the page; and failed a move on jwize's hive for a reason not yet read.
Each miss was fixed in the hive, not in a prompt. The tidy has **not yet
landed** end to end.

## Where the distribution comes in

If a program is small, signed, and re-checkable, it replicates like any other
content. A host runs it, refuses it, or holds it according to *its own*
grants. A request to another host and its answer can be records with
signatures; what comes back is someone else's words and stays held for a hand,
as foreign changes already do.

*Agent extraction* (jwize's phrase; this is an interpretation to confirm):
the agent stops doing the work and becomes the party that **states the need**.
Hosts, swarms and applications that run declared pieces do the work and
answer in the same language.

## Hosts as idle processors, by opt-in (jwize, 2026-10-25)

> "we can act as other servers as idle parallel processors ready to go with
> opt in. The hosts can even charge a membership or currency."

A host that opts in offers its idle capacity to run *pure* work for others.
`hypercomb-communication-layer.md` (§ collapsed compute, ~L800–1090) has
already reasoned about the hard half of this, and this hypothesis leans on it
rather than repeating it:

- **Which work may leave home.** Only pure derivations: the optimize-phase
  litmus ("could a cold client rebuild this from layers alone?"). A yes can be
  computed by a stranger and checked; a no depends on a clock, the live hive
  or the network, and stays home. A `pure` declaration on a word would be the
  eligibility mark.
- **A memo table is sound; an oracle is not.** Recomputing is the only proof
  the work was done. So the check is *attribution*, not consensus: a signed
  `(input, function, output)` triple, comparable across *k* hosts, with
  disagreement detectable and attributable. Reputation, not mining.
- **The trust boundary is still a stub** per that doc (`isTrusted` had no
  call sites when it was written). Nothing delegates computation yet, so
  nothing is exposed. Verify before building on this.

What this hypothesis adds: a signed spoken plan whose lines are all `pure`
and whose effect summary says so is *exactly* the unit that is safe to farm
out. A plan that touches state stays on the participant's own hive.

**Membership or currency.** A host that offers capacity could charge for it.
The hive's money thinking lives in `bee-story/the-economy.md`, `el-mercado.md`
and `install-by-replication.md` (the currency-as-meta-layer idea); I have not
re-read them for this and do not claim how a charge would be signed, settled
or refused. It is an open design, and it raises the point the doc already
makes: once work is paid for, publishing a plausible wrong answer is cheaper
than computing, so verification by recompute must come before payment, not
after.

**Possible first experiment (not started):** two hosts, one plan marked pure,
each computes it, the triples are compared, and a deliberately wrong answer
from one is detected and attributed to its signer. No payment in it.

## Possibilities, from least to most uncertain

1. **Lookup read.** A model asks the hive what words exist, what each takes,
   and whether it is granted to that model. Built on the existing
   declarations. Low risk; everything else rests on it.
2. **A plan as a stored, signed program.** Store the tidy line; replay it;
   the result is identical. Tests determinism of meaning.
3. **A computed effect summary signed with the program** (reach, scope,
   leaves). The receiver recomputes it. Tests claim 3.
4. **Deterministic translation** of a plan to code, with a reproducibility
   check across two hosts (same program + translator version → same output
   signature). Tests claim 2.
5. **Request and answer records between hosts.** Addressed, signed, held when
   foreign. Not designed.
6. **Outcome receipts per piece signature** (ran, refused, failed, undone),
   written by the hive that ran it. Tests claim 4. Need to check what the
   existing receipts and misses ledgers record and whether they key by
   signature.
7. **A scratch area for drafts**, per conversation, by signature, never read as
   truth until promoted by a separate sentence.
8. **One feed** of questions and waiting approvals across conversations, with
   peek-without-leaving.

Publishing stays a separate sentence only the participant can approve,
whatever else is granted: an agent that imports, authors and publishes in one
conversation would sign for them.

## What would show it wrong

- Real requests need loops, computed names or branching often enough that the
  closed word set cannot express them. (Count how often a model's proposal
  needs something no word says.)
- Models cannot reliably write the grammar. Measure first-try success per
  model; this session's misses suggest it is not yet high for the cheap tier.
- Translation is not reproducible across hosts, or the translator becomes the
  thing everyone must trust and nobody can review.
- The computed effect summary is too coarse to distinguish a harmless plan
  from a harmful one (names worked out at run time are the hard case).
- Selection by outcome rewards the piece asking for the widest permissions.

## The gates a piece must pass

Code need not be readable. A piece joins the library only when it clears, in
this order, failing at the first unmet need and saying which:

1. shape — it parses and carries a declaration;
2. admission — offered, granted, within reach and scope;
3. the doctrine ratchets (`src/doctrine.spec.ts`);
4. the primitive (`primitive-conformance-audit.md`): signature-named bytes plus
   a typed meta envelope, discoverable through a pool, public only by an
   explicit switch;
5. behaviour — its tests pass and it does what it declares;
6. judgement — Jev against the doctrine sections, then a human.

The needs are better held as data in the hive than as one more file of code.
The primitive audit (2026-09-24) records that templates and other creation
kinds still use fixed arrays and in-memory maps; the library would sit on
those gaps until they close.

## Open for jwize

- Is *agent extraction* what is meant above?
- The name of the word, if one is needed, for speaking into a tile's
  conversation (the door today is `chat-ask` by route and name; the `say` word
  was retired because harnesses do not use the command line).
- Should the first proof be a plan stored and replayed (2), or the lookup read
  (1)?
- Where the distributed part first lives: the local host, or hosts that
  already replicate.
