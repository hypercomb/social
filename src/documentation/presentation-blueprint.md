# The presentation blueprint: one welcome, one shape for every creation

**Status: proposed 2026-11-10; the tree changes it recommends are made in
`scripts/bridge/living-presentation` the same day, unvoiced and uncommitted.
Nothing here is planted or published.** This page sits above
[living-presentation.md](living-presentation.md). That document says how the
flagship presentation is built. This one says what every creation has to
carry so that all of them, together, read as one welcome into one shared
system, and how the welcome keeps getting better.

Everything marked **planned** is not built. The open decisions are gathered
in the last section.

## Who steers

jwize, 2026-11-10: the session that holds this blueprint is the **advisor and
the orchestrator** for the presentation. Every session that works on a
presentation piece should know this:

- It reads this page before it starts, and builds its piece to the contract
  below.
- It brings questions of wording, placement, and what to promote to the
  orchestrating session, not to its own judgement.
- It reports what it built and what it could not verify. The orchestrator
  checks the piece against the contract before it is called done.
- Decisions stay with jwize. The orchestrator advises and coordinates; it
  does not publish, and it does not decide the items in "Decisions".

## The standard

jwize, 2026-11-10: "the interactive presentations have to be clear and
concise and subject to change if they don't meet the highest standards."

- **Clear.** One concept per page, in words a beginner follows on first
  hearing. A sentence that needs a second reading is rewritten.
- **Concise.** A page says only what its picture cannot. Twelve sentences is
  the limit, not the target; a sentence that can go, goes.
- **Provisional.** No page is finished. A page that falls short is changed,
  broken apart, or sent back to waiting, however recently it was made and
  whoever made it. Having been voiced or published does not protect it.

The orchestrating session holds every page to this, including its own.

## The invitation

This is the welcome, in the words a first visitor should hear. It is a draft
for the opening, and the tone rules below apply to it.

> This is an experiment, and you are invited. What happens when people are
> connected at the points that matter most to them, the things they know and
> the things they care about, and can build on each other's work directly?
>
> Here, what you make is yours. It lives on your machine and your own domain.
> Anyone can copy it, change it, and publish their version, and yours stays
> exactly as it was. Nobody stands in the middle collecting what you do.
>
> The more people take part, the more there is for everyone to build with.
> Come and add your piece.

## What we say, and what proves it

Five claims carry the whole message. Each one names the thing in the hive
that proves it, so no claim is ever only a sentence.

1. **It is yours.** Your hive runs in your browser and is stored on your
   machine. Your domain is served from your own hosts. Nothing leaves unless
   you publish it. *Proof: the workbench, a claimed domain, hosting from your
   own computer. Built.*
2. **Nothing is taken from you.** No page asks another company's server for
   anything. There is no account to read the presentation and no feed that
   studies you. *Proof: the no-third-party rule and its check. Built.*
3. **We build on each other.** Every tile can be copied and changed. A copy
   has its own signature and the original is untouched. You follow people,
   take their update or leave it, take one piece or the whole. *Proof:
   replication, update notices, taking a piece. Built.*
4. **People and AI work in the same words.** A person clicking and an agent
   speaking do the same act under the same rules, and every change a model
   writes waits for a person. The intelligence of the whole is what people
   put in and choose to share. *Proof: sentences as the command line, drafts
   held for approval. Built. Agents working across other people's domains:
   planned.*
5. **The platform facilitates and does not push.** It ranks nothing and
   recommends nothing. You see what you ask for, from the people you follow.
   What you publish can be free, or sealed for the people you choose.
   *Proof: asking one word across followed hosts, built; sealing a page to
   named people with the `private` word, built and not yet run on a live
   host.*

## Why this does not pay the shared-machine price

This is the one technical argument the presentation must make exactly,
because people will compare it to a blockchain.

A blockchain is one machine that everybody runs. Every node repeats every
program, and all of them must agree on one order of events before anything
counts. That agreement is the cost, and it grows with use.

Hypercomb has no shared machine and no shared order.

- **A program runs where it is used.** Code runs in the participant's own
  browser, under that participant's permissions, against that participant's
  storage. Two people running the same creation run two programs side by
  side. Neither waits for the other.
- **The only thing everyone must agree on is arithmetic.** A file is named by
  the SHA-256 hash of its bytes. Checking it is one hash on your own machine.
  No vote, no miner, no fee.
- **Sharing is copying, not executing.** A host serves bytes. It does not run
  your program for you, so more users do not mean more shared work.
- **Each person keeps their own version.** There is no global state to keep
  in step. Two versions of a thing exist side by side, and each person
  chooses which they hold.

**The honest limits, said once.** Because nothing is agreed globally, there
is no global ledger: Hypercomb cannot by itself say who paid whom. A host
holds only what was sent to it, so versions last because they are replicated.
And the further idea, that a result computed once is looked up by everyone
after (collapsed compute), is a design and is not built.

## The shared system, in the words people already know

"A shared operating system" is a fair picture as long as each part points at
something real. This is the map, and every creation should be explainable on
it.

- **Files** are atoms: bytes stored once under their own signature.
- **Folders** are layers: a word and the words under it.
- **Programs** are bees: signed modules a tile turns on.
- **Permissions** are yours: code from another domain is an offer, held
  until you accept it. *The single rules screen for this is designed, not
  built.*
- **The command line** is plain sentences, the same for people and agents.
- **Installing** is replication from a host you follow, by signature.
- **Updates** are notices you take or skip. Nothing changes under you.
- **The shop window** is the root of each domain, showing what it publishes.
- **The network** is the set of hosts you chose to follow. There is no
  centre.

## The contract every creation follows

A creation is ready to be presented when it meets all of this. The first
seven are already the hive's rules; the last four are what this blueprint
adds.

1. **One tile, one concept.** Too big for one page means child tiles, never a
   longer page.
2. **It is the primitive.** A word, its signature, a layer, and a meta layer
   that says what it means.
3. **It stands alone.** Its page carries its own look and works with nothing
   else filled.
4. **It names words, never things.** It depends on trait words and theme
   words, not on another creation.
5. **It asks no other company for anything.**
6. **It can be copied and changed**, and it shows that: its signature, who
   made it, copy into my hive, change it.
7. **It keeps the three-places promise** from
   [using-a-creation.md](using-a-creation.md): usable without a host, your
   data comes with you, and you can take it to your own domain.
8. **It says its welcome in one sentence.** The first line a stranger reads
   says what they can do with it, in plain words. *New.*
9. **It wears the values it shows.** One or more of simple, organized,
   collaborative, intelligent, accessible, localized, as marks. That is how
   it is gathered into the presentation without being moved. *New as a
   requirement.*
10. **It says what is built and what is planned**, on the page. *New as a
    requirement for creations; already the rule for presentation tiles.*
11. **It says how it is offered**: free, or sealed for an audience.
    *New: see the marketplace.*

Because creations are gathered by the marks they wear, embedding a creation
into the presentation is one act: it wears a value. Nothing is copied into
the presentation, and no tile is made for it.

## The marketplace of ideas

What can be said today, and what cannot.

- **Free is built.** Publishing puts a creation at your domain's root, and
  anyone who follows you can take it.
- **Finding is by word.** A word has one address on every host, so asking a
  word asks every host you follow. Nobody's list is ranked above another's.
- **Premium is sealing.** A sealed page is closed until a key opens it,
  then it is taken like anything else. The `private` word seals a published
  page to the people you name. It is built and has not been run against a
  live host; audiences as lists, and a private version with no public root,
  are not built.
- **Payment has no rail.** Nothing in the hive moves money, and the
  architecture cannot settle a payment by itself. A seller can be paid any
  way they like and hand over the key. Anything more is a decision, below.

The existing vision page, [the economy](bee-story/the-economy.md), says in
plain words that the economy "is not a marketplace" and that no platform
takes a cut. The second half fits. The first half contradicts this message
and one of the two has to change.

## Tone

The standing rule from the living presentation holds: plain enough for a
beginner, one exact sentence for the technical reader, and it teaches; it
does not sell.

The critique of today's software belongs in the presentation, because it is
the reason for the design. It is strongest said as mechanism, not as a
charge:

- Say where the data is kept and who holds the key. "Your notes are stored on
  a company's servers, and the company decides who reads them."
- Then say the same two facts for Hypercomb.
- Let the listener draw the conclusion.

Words like "virus", "carnage", and "superhuman intelligence" are jwize's own
voice. They fit a signed piece in his name, such as the opening question,
better than the neutral narration of every tile. This is a decision, below.

## Where each message lands in the tree

The living presentation's tree already has a place for most of this. No word
is used twice.

- **The invitation** goes on `question`, the opening scene on the road.
- **It is yours** is `workbench` and `domain`, both promoted.
- **Nothing is taken from you** has no tile of its own. It fits under
  `accessible`, where `reader` is waiting.
- **We build on each other** is `collaborative`, with `sharing` and
  `discovery` waiting.
- **People and AI in the same words** is `intelligent`, with `sentence` and
  `agent` promoted.
- **The shared-machine argument and the operating-system map** are `machine`
  and `system`, two new tiles under `computer` on the road (added and
  promoted 2026-11-10).
- **The marketplace** is `market`, a new tile on the road after `creations`
  (added 2026-11-10).
- **The contract** belongs on `creations`, promoted.

## The improvement loop

The presentation is never finished, so it needs a loop, not a release.

1. **Pick the weakest claim.** Of the five, the one whose proof is thinnest
   or whose page a newcomer stumbles on.
2. **One layer, one revision, one publish.** The canonical loop from the
   living presentation. One tile changes at a time.
3. **Check it.** The existing checks (`blocks/check.cjs`), plus the contract
   above read against the page.
4. **Read it cold.** A fresh session, or a person, reads only the page and
   says back what they can now do. If the answer is not the tile's welcome
   sentence, the page is not done.
5. **Listen for what comes back.** The only signal that does not require
   watching people is what they publish: copies, variations, and
   translations on the hosts we follow. *Gathering that into one view is
   planned.*

## Decisions for jwize

1. **Marketplace or not.** The economy page says the economy is not a
   marketplace. Either that page changes, or the presentation says "exchange
   of ideas" and keeps money out of it. Recommended: keep "no platform cut",
   drop "not a marketplace", and say plainly that payment is outside the
   hive today.
2. **Where the strong words go.** Neutral mechanism on every tile, with the
   strong statement once, in your name, on `question`. Or the strong voice
   throughout. Recommended: the first.
3. **"Operating system for humanity."** Use it as the name of the `computer`
   tile's idea, with the map above as its proof, or keep it out of the
   narration. Recommended: use it once, on `computer`, with the limits
   beside it.
4. **Promote `computer`, `sharing`, and `discovery`.** They carry three of
   the five claims and are all waiting.
5. **A marketplace tile on the road.** Its name, and whether it is planted
   while most of it is planned.
6. **The README.** It tells a newcomer the repository is frozen and is not a
   collaboration hub. That is true of the repository and reads as the
   opposite of the welcome. One sentence pointing to where taking part
   happens would fix it.
7. **Contract items 8 to 11.** Whether they become checks that fail a build,
   or stay guidance.

## References

- [living-presentation.md](living-presentation.md): the flagship plan, the
  tree, the tour, what is built and what is not.
- [using-a-creation.md](using-a-creation.md): the three-places promise.
- [website-artifact-paradigm.md](website-artifact-paradigm.md): one
  artifact, broken apart when needed.
- [no-third-party-requests.md](no-third-party-requests.md)
- [code-admission.md](code-admission.md): the rules screen, designed.
- [sealed-audiences.md](sealed-audiences.md): sealing and the `private`
  word.
- [collapsed-compute.md](collapsed-compute.md) and
  [instant-computing.md](instant-computing.md): computed once, shared by
  signature; design and thesis.
- [bee-story/the-economy.md](bee-story/the-economy.md): the economic vision.
