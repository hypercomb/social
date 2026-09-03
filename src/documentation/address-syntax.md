# The address syntax — where you store it is what you promise

**Status: the convention. This document IS the protocol.** There is nothing else
to implement: anyone who stores by these rules is interoperable immediately,
without negotiating with anyone.

Companion to `hypergraph-molecule-lineage.md` (the model) and
`known-location-pools.md` (the root vocabulary).

---

## The inversion

Normally you store data, then build an API to expose it. Here **the address is
the promise**. Where you put something *is* the declaration of who can reach it
and how — so you cannot publish by accident, and you cannot hide by accident.
Where you wrote it is what you meant.

| where you store it | what you are promising |
|---|---|
| a bare **singular** word | *this is a kind — find it by naming it* |
| `plural:<sig>` | *this is about that thing — find it by holding the reference* |
| a **reserved** colon meaning | *system; no tile can address this* |
| your own **author bucket** | *this is my claim, not consensus* |

## The forms

```
sign(fold(canon(word)))          MOLECULE   a grammar. Anyone may type the word.
sign('<plural>:' + subjectSig)   FACET      a collection about one subject.
sign('<reserved>:<word>')        SYSTEM     e.g. format:hive, usage:dwell
<any of the above>/<pubkey>/     BUCKET     one author's claims within it
```

## The rules

**1. Singular is a grammar; plural is a facet.** A bare word is always
singular — it names what each member *is*, so it reads correctly at every level
(`cigar` is the set of cigars, and one cigar inside `tobacco`). A word before
`:<sig>` is always plural, because it genuinely holds a collection about that
subject. **Position determines the form**, so nobody has to choose — and that
matters, because `note` and `notes` are different addresses forever and no
canonicalization folds plurals.

**2. Compound concepts get compound words, never `A:B`.** `cigar-brand`, not
`cigar:brand`. Two user words joined by a colon is a path with a different
separator, and it costs both things that make colons useful (below).

**3. After a colon: a reserved system word, or a 64-hex signature. Never a user
word.** This is what keeps the two namespaces apart.

**4. Case is folded for the address; display case is preserved.** The molecule
address is `sign(fold(canon(name) || trim(name)))`, using the locale-INDEPENDENT
`toLowerCase` — never `toLocaleLowerCase`, whose Turkish dotless-i would make
one machine's address disagree with another's. Case folding IS the interop: a
vocabulary where `People` and `people` are different molecules is not shared.

Note the parenthesisation, corrected 2026-09-03 when the rule was made
executable (`hypercomb-core/src/core/molecule-address.ts`). The fold wraps the
WHOLE expression, raw-trimmed fallback included. `canon` returns `''` for a name
carrying no letter and no digit, and `sign('')` IS the empty-content ROOT
address, so the fallback is not optional — but it is reachable by names that
still case-fold. `Ⓐ` (U+24B6) is category So, so nothing survives canon's
filter; under the earlier spelling `fold(canon(name)) || trim(name)` the
fallback branch went unfolded and `Ⓐ` and `ⓐ` became two molecules of one word.

**5. Plural means an array; singular means a scalar.** The field name tells you
the arity, so there is exactly one legal spelling and one preimage per meaning.
`children: ['a']` even for one member; `layer: '<sig>'` never an array. Already
true of `EDGE_FIELDS` and `REFERENT_FIELDS`, and now ratcheted.

**6. A pool never contains another pool.** Everything below the first level is a
*bucket* — per-author or per-subject — never a new meaning. The address stays
derivable in one hash and the root stays flat.

**7. Derive on demand; never enumerate.** You always arrive holding a reference.
`sign('notes:' + subjectSig)` is computed when you want it, fetched from every
host in parallel, and a miss is an empty directory — which is indistinguishable
from "nobody has said anything yet", and should be.

## Why the colon rule holds

`canonicalizeLineageSegment` maps every run of non-letter/non-digit to `-`, so
**its output can never contain a colon**. No tile name, in any script, can reach
a colon-scoped address. That is why system pools are safe, and it is why the
reservation must not be spent on user content:

```
canon('websites:menu') === 'websites-menu'      a tile named that lands here
sign('websites:menu')  === 17deba5b…            the system pool is unreachable
```

Two preimage functions, never one — a molecule is `sign(fold(canon(name)))`, a
system pool is `sign(RAW meaning)`. The registry already worked this way; it is
the design, not a disagreement.

Census today: **22 bare-word meanings** (each a colliding address — a tile of
that name shares its directory) and **58 colon-scoped** ones.

## Pool kinds

The kind is a **decoration**, not part of the address — so changing your mind
never re-addresses anything. It answers three questions at once:

| kind | shape | deletion | replication |
|---|---|---|---|
| **set** | sig-named items | remove only your own member | travels |
| **index** | member named by the sig it describes | never delete; recompute | never send — derived |
| **document** | one current record, replaced | replaces siblings BY DESIGN | never send — per-participant |
| **succession** | per-author buckets of signed claims | never touch another author's bucket | must travel |

**The kind is advisory for reading and NEVER authoritative for a delete.** A
record that arrived over the wire gets no vote on destroying bytes; that is the
blocker-1 shape one level up. Destruction answers only to the structural
guard — `directory-safety.ts`: *the entry decides, never the directory*, and a
directory may be hard-deleted only if every entry in it is a marker.

## Discovery

Because addresses are derived and sparse, you can only ask about a facet whose
**word** you know. So discovery is over vocabulary, not data:

- a host **declares** the words it holds — tiny, cheap to poll
- you **turn on** what you are interested in
- the vocabulary is the **routing table**: ask the hosts that declare `notes`,
  not all of them

**Minting is free and cannot fail.** Derive a word nobody has used and you have
started a conversation rather than hit an error. The incentive balances itself:
a common word means you join and inherit everyone's content; a rare word means
**you are the one making the content**. That pressure is what makes people reach
for the common word without any registry enforcing it.

**Absence must stay honest.** If a facet exists that you have not enabled, the
vocabulary already told you — so the surface can say *"3 facets available, not
enabled"* without fetching a byte. Unsubscribed is not the same fact as empty.

## The standing invariant

> **Nothing enters your world because someone else decided it should.**

A host **may declare** what it holds. It **may never place** anything in your
world. Declaration is inert; placement is an act. This is the same rule as
reader-derived placement, as kind-is-advisory, as receiver-decides-replication,
and as the-key-you-chose-is-the-context — and here the safety property and the
discovery property are *identical*, which is the strongest sign the shape is
right.

## What this does not do

- **Synonyms fragment.** `notes` / `annotations` are different addresses and
  canonicalization will not merge them — it folds punctuation and case, not
  meaning. The mitigation is visibility, not enforcement: a host's declared
  vocabulary lets you see the near-miss *before* you write.
- **Nothing enforces topical grouping.** `cigar` and `cigar-brand` are peers,
  one hash from the root, related only by naming and by whatever incidences
  actually link them. Coherence is what the words do, not what the system
  guarantees.
- **It does not migrate anything.** Old addresses keep working; this is what
  new writes mean. See `format:hive` (`sharing/hive-format.ts`) for how a client
  learns it is reading a hive written by a newer format.

## Open

- The mesh channel across the version boundary — dual-publish for a window, or
  partition peers by version.
- `hidden` keying: envelope-sig keying pre-hides your own future identical
  member, and there is no unhide.
- Whether the vertex/envelope restructure happens at all, or the molecule stays
  a derived index alongside the existing lineage. Deferred deliberately until
  the index proves the capability is worth the cost.
