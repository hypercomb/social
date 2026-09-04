# The algorithm is the application

**HIGHER ORDER. This outranks every other document here.** Where a rule below
conflicts with a rule in `address-syntax.md`, `hypergraph-molecule-lineage.md`,
`optimize-phase.md` or any other doctrine, this one wins and the other is
wrong. Everything else in `documentation/` is subordinate detail.

---

## The claim

**There is no application.** There is a substrate and one operation.

- The **substrate** is a hypergraph in the truest sense: an atom is a
  sig-named artifact, a molecule is a name plus the atoms gathered under it,
  and *a molecule is an atom one level up*. Edges are vertices. Nothing needs
  a second kind.
- The **operation** is to **narrow**: say a word, receive groupings, narrow
  again, arrive. Each step is one derived address.

A sequence of narrowings is itself a molecule, so a query is a member of the
graph, saveable, nameable, shareable, and decoratable onto anything. **The
thing that walks the structure is part of the structure.**

## What is outside

Exactly three things, and they are the axioms:

1. **sha256** — the addressing function
2. **the canonicalization rule** — what makes two spellings one word
3. **the participant's key** — identity, a verifying key rather than content

Schema, types, queries, indexes, relations, classifications, references,
orderings, history — **all inside**, addressed the same way as everything else.

**THE TEST, and it is the only one you need:** *what has to sit outside for
this to work?* Anything outside is a fourth thing, and a fourth thing is the
work. Apply it per subsystem, forever.

## Why deviation is the default, and how to catch it

**Every deviation is a local optimisation that spends global coherence.**

Putting children inside the parent is faster to read. A path is easier to
reason about than a derivation. An index maintained on write beats deriving
one. A schema declared up front catches errors sooner. Each buys something
immediately and bills later, elsewhere, to someone else — which is exactly
why it keeps happening. The gain is visible at the moment you take it; the
cost arrives detached from the purchase.

> **If a change makes one thing easier and adds a concept, it is a deviation.**

## Why it must be pure — the engineering reason, not the aesthetic one

**A special case is what prevents parallel composition.** A gate composes
because it does not need to know which circuit it is in. The moment a
processor must know *is this a container, a pool, or a bag; does this parent
own its children*, every processor carries the schema — and you cannot have
thousands of them, because each is now heavy and each must agree.

One shape means a processor needs to know almost nothing to participate.
**Uniform is what makes lightweight possible, and lightweight is what makes
thousands possible.**

**Program to pixel is literal.** Ordinary software runs store → ORM → API →
state → component → pixel, with a translation at every seam and a chance to
disagree at each. Here it is molecule → drone → mesh, the same shapes the
whole way down — and the last stage genuinely is thousands of lightweight
processors, because the tiles are shader meshes.

So the pattern is not the storage layer's philosophy that the rest tolerates.
It is the same reason at both ends.

## What a feature is

**Vocabulary and a sequence. Not code.**

Adding a capability means adding a word, or saving a narrowing. If a
capability requires code, that is a signal to ask *which deviation forced it* —
sometimes the honest answer is "none, this is genuinely new machinery," but
the question is asked first, every time.

This is the existing rule stated at full strength: *if a change would require
editing code to change how something is classified, grouped, or rendered,
that classification belongs on a tile.*

## The interface this implies

The UI is a **sequence walker**. That is the whole brief.

1. **Groupings before data.** Never return the rows. Return the groups, which
   are bounded by vocabulary — a dozen words — then narrow. This is not a
   nicety: "all people" is unbounded across a federation and cannot be paid
   for, while "the groups within people" costs one derived address at every
   depth.
2. **Arrive immediately, without distraction.** The measure of the interface
   is how few steps stand between a person and the thing they came for.
   Chrome that is not narrowing is chrome to remove.
3. **Every intermediate is a real object.** Stopping mid-narrowing yields a
   molecule, so pausing and keeping it costs nothing and needs no "save
   search" feature.
4. **Walking and saving are the same act at different tempos.** A gesture menu
   walking rings live and a stored reference are one structure — so a person
   produces a reference by *keeping a path they walk often*, never by being
   shown a rule editor.
5. **Mastery is a path becoming muscle memory.** A route walked repeatedly
   should get faster to walk, and the interface's success condition is that
   you stop seeing it.
6. **Absence must stay honest.** Empty means nobody has said anything;
   unknown means we could not find out. A surface that renders unknown as
   empty is lying, and the whole model rests on the difference.

## Public lookup and the swarm are one mechanism

They are not two subsystems. **A channel is an address with a secret in its
preimage; a public index is the same address with none.**

```
sign(molecule)                       PUBLIC   anyone saying the word arrives
sign(molecule ␀ room ␀ secret)       PRIVATE  a rendezvous over the same subject
```

One formula, one term's difference. Which means:

- **Privacy is a term in the preimage, not a permission check.** There is no
  ACL, nothing for a server to enforce, and nothing to misconfigure. You can
  derive the address or you cannot. A host holding the bytes learns nothing by
  holding them.
- **Sharing is not a copy, it is an address.** Handing someone the secret hands
  them the derivation.
- **The same subject can be looked at publicly and privately at once**, with no
  duplication — the material is the same atoms, reached two ways.

### The magnifying glass

This is what makes a private view of public material a first-class thing rather
than a feature:

1. Take a **public molecule** — anyone's `cigar`, gathered across hosts.
2. **Narrow it** with a sequence — which is itself a molecule.
3. Address the result with **your own location and secret**.

Now you have a private lens on public material. Not a copy, not a fork, not a
subscription: a saved way of looking, addressed so only the people you gave the
secret to can look through it. Federation supplies the material, the sequence
supplies the view, the secret supplies the reach.

And because a sequence is a molecule, the lens can be shared, decorated onto a
tile, or narrowed further by someone else into their own lens. **Turtles all
the way down, deliberately.**

## The invariant underneath all of it

> **Nothing enters your world because someone else decided it should.**

A host **may declare** what it holds. It may **never place** anything. The
reader derives, the reader asks, the reader decides. This has been the correct
answer to placement, to deletion authority, to replication, to context, and to
discovery — and in this model the safety property and the discovery property
are the *same* property, which is the strongest evidence the shape is right.

## Why this is written down

Because every intuition in ordinary software points away from it, and the pull
is constant and reasonable-sounding at every individual step. Without this
stated as the higher order, each local decision looks defensible and the whole
drifts.

**When in doubt: what would have to sit outside the graph? Do the other thing.**
