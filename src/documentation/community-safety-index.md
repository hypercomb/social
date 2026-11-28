# The community safety index

**Status, 2026-11-28.** A design. One piece is built: authorship no longer comes from naming a signature
(M1, below). Everything under "The design" is not built yet.

## The point

jwize, 2026-11-27:

> *"you're creating a global index [for] Safety verified scripts images and content that gives you an
> incredible new possibility for experience on the web."*

People sign claims about a signature: "I read these bytes, and they are safe to run sealed." Hosts gather
those claims into pools named by the signature. Taken together, across every host, the pools are **one
global index of safety-verified scripts, images and content**. Anyone can ask it, by signature, "who has
vouched for this, and for what?"

Per-page access is only one way to read the index. The product is the index itself: on such a web, any
verified piece can be used anywhere, safely, at the level your own filter allows.

## The rule

jwize, answering whether someone else's page should ever run as yours (audit M1):

> *"if it is signature trusted in your community then it should let you know somehow. But the idea is all
> assets can be approved by trust community supplied signatures and the consumer sets the safety
> requirements and then therefor gets access to the content. Also the receive of the email would get a
> fallback template of there own but if they allow those trusts they can have any level of dynamic content
> you can imagine. You filter parameters set the requirements and therefor upgrade your experience, though
> you can put your own in place and override if you please."*

So:

1. **Authorship is not access.** A page is yours only when this hive wrote its bytes (M1). Community trust
   is a separate, third route to running something, beside "yours" and "reviewed by you".
2. **The community supplies evidence; the consumer decides.** Members sign claims about a signature. Your
   **requirements** say whose claims count, how many you need, and for which level of access. An asset that
   meets them gets that level. Stricter requirements keep you safer, looser ones upgrade your experience.
3. **It always says so.** When something runs because of community trust, the page says who vouched for it
   and which of your requirements it met. It is never silent.
4. **Mail falls back to your own template.** A received message is shown in your own fallback template
   unless the sender's template meets your requirements. If it does, you get the sender's template, up to
   any level of dynamic content.
5. **You can always override.** You can put your own template or asset in place of anyone's.

This is the 10-07 doctrine made explicit: scents inform, and the truster weighs them by whose they are
(`read-only-deployment.md`, "Discovered security: scents in community pools"). The weighing is now a
document you hold, not a habit of the code.

## What exists today

There are three kinds of signed claim about a signature, and none of them reaches a gate.

| Claim | Record | Where it lives | Who reads it |
|---|---|---|---|
| **Assessment** of a module trial | `module-assessment`, verdict accept / refuse / unclear (`assistant/module-review.ts`) | The assessor's own signed index as `assess:<root>`. The worker adds their key to `sign('assess:<root>')` and that pool to `assess:pools` (`blossom-worker/worker.js` `noteAssessors`) | The trial door's review panel. `countedAssessors` counts only your own key and the one publisher you follow; everyone else is a number |
| **Derivation attestation** | the attester re-derived the bytes (`sharing/derivation-attestation.ts`) | `attest:<record>` in the attester's index; the worker's `noteAttesters` | `derive verify` and the package views |
| **Pheromone deposit** | an interest signal, nostr kind 30218 (`pheromones/pheromone-deposits.ts`) | Local only, never published | The intake filter. A pheromone says what interests someone, never what is safe, so it is not a safety claim |

And around them:

- **The page gate reads no claims.** `featureNeedsReview` and `runsSealed` (`sharing/feature-availability.ts`)
  ask only: did this hive write it, did you review it, is the domain trusted, is it under a root you allowed.
- **The brood's vouches are not wired up.** `recordVouch` and the `brood:rules` vouch policy exist in
  `hypercomb-core/src/core/brood.ts` and `brood-rules.ts`, but nothing provides `BROOD_TRUST_IOC_KEY` and
  nothing calls `recordVouch`. Brood records are local and unsigned.
- **Readers ask one host.** The assessment reader asks the trial's own door, not every host you know.
- **There is no requirement model and no "vouched by" line.** The `publish.entrance.scents*` strings in the
  i18n catalogs have no caller.
- **Mail** has a three-gate template model (`mail-templates.md`, "three gates"): `unknown` shows the
  sender's copy in a frame with no scripts, `held` renders through a template you hold, and `admitted`
  (step 4) is not built.

## The design

### 1. One claim type

A **safety claim** is a signed statement about the bytes at one signature. It is its own record kind, like
`module-assessment`. It is not a pheromone kind: it says what the claimer found, not what interests them.

```json
{
  "kind": "safety-claim",
  "subject": "<sig of the bytes>",
  "as": "page",
  "verdict": "safe",
  "level": "sealed",
  "powers": [],
  "checked": "<sig of a resource: what was read, run or derived, and how>",
  "at": 1764300000000
}
```

- `as`: what the bytes are, so a reader knows which gate the claim speaks to: `page`, `script`, `image`
  (an SVG can carry script), `content`, `template` or `bundle`.
- `verdict`: `safe`, `unsafe` or `unclear`. An `unsafe` claim is a **flag**.
- `level`: the most the claimer vouches for (see section 3). `powers` names the powers, by their words,
  when `level` is `sealed-with-powers`.
- `checked`: a signature, never inline text. The resource says what was done: read by hand, run sealed
  and watched, re-derived from source, read by an agent.

The record lives in **the claimer's own signed index** as `safety:<subject>`, exactly as an assessment
lives at `assess:<root>`. The signature on their index is the signature on the claim. A claimer holds one
claim per subject, and a new one replaces the old: the last one wins.

Today's assessments and attestations are read as claims too. An `accept` assessment of a module trial
reads as a safe claim about that package at the level the trial ran. An attestation reads as a claim that
the bytes are what their source builds. Nothing is converted or rewritten.

### 2. The index

The worker notes each claim the way it notes assessments: on an index write, every `safety:<subject>` key
adds the claimer's key to the pool `sign('safety:<subject>')`, and adds that pool to `safety:pools`.
`GET /<sign('safety:<subject>')>/` lists who has claimed something about the subject. Membership only: what
they said is read from their own signed index and their record by signature, and re-verified by the reader.
Nothing a host says about a claim is taken on trust.

**The global index is the union of those pools across every host.** The reader asks every host the hive
knows (its community hosts and the hosts it publishes to), not one. A host that has never seen a claimer
simply does not list them. The local hive keeps a derived cache of what it read, keyed by the subject
signature, and never treats it as truth.

### 3. Your requirements

Your **requirements** are a document in your hive, a resource kept in the `safety:requirements` pool. For
each level of access, they say whose claims count, how many you need, and what holds an asset back.

| Level | What it allows | Default requirement |
|---|---|---|
| `shown` | Shown as data: text and pictures, nothing runs | None: this is how a foreign page shows today |
| `sealed` | Runs in the sealed frame: scripts, an opaque origin, no network, no hive (`page-run-gate.ts`) | One safe claim at `sealed` or above from your own key or someone you follow |
| `sealed-with-powers` | Sealed, plus the powers you name (`using-a-creation.md`, "Powers are off by default") | Your own key only |
| (never) | Runs as you: your key, your storage, `window.ioc` | Community trust never grants this |

```json
{
  "kind": "safety-requirements",
  "levels": {
    "sealed": { "voices": "<sig of a list of keys>", "need": 1, "heldBy": "any-flag" },
    "sealed-with-powers": { "voices": "<sig of a list of keys>", "need": 2, "heldBy": "any-flag" }
  },
  "templates": { "fallback": "<sig of your own mail template>" },
  "override": { "<subject sig>": "<sig of what you put in its place>" }
}
```

- `voices` points at a list of keys, by signature, so a list can be shared: you can adopt a friend's
  voices or a whole community's, and that upgrades your experience in one step.
- `heldBy: "any-flag"`: one `unsafe` claim from any listed voice holds the asset back, however many vouch
  for it. This is the strict default.
- The defaults are strict: your own key and the people you follow. Nothing runs on a stranger's word until
  you add them.

### 4. One reading: `safetyOf(sig)`

One function answers every gate:

```
safetyOf(sig, as) → { level, met: <which requirement>, vouched: [keys], flagged: [keys], short: <what is missing> }
```

It reads the claims about `sig` across your hosts, keeps the ones your requirements count, and returns
the highest level they meet. It is the only place the requirements are interpreted, so no gate keeps its own
copy of the rule.

### 5. The gates ask it

- **Pages.** `featureNeedsReview` gains a third way through: a page whose `safetyOf` meets `sealed` may run,
  beside your review and a trusted domain. It still runs sealed (`pageRunsSealed` is unchanged), with the
  powers you granted when it meets `sealed-with-powers`.
- **Mail.** `templateTrust` (`mail/template-pool.ts`) gains `admitted`: a sender's template whose `safetyOf`
  meets your template requirement renders with its dynamic content. Otherwise the message is shown in your
  own fallback template.
- **Later:** bees through the brood (the dead vouch policy, `code-admission.md` D3), pictures and SVG, a
  room's bundle, a part seated in a page.

### 6. It says so

Wherever community trust lets something run, a line says why, next to it:

> Runs sealed: vouched for by alice and bob, which meets your rule of two voices from people you follow.

And where it does not:

> Held: 1 of the 2 voices you require. Flagged by carol.

Each name opens that person's claim: what they checked, and when. The line is the "let you know somehow"
in jwize's answer.

### 7. Mail: your own template first

When a sender's template does not meet your requirements, **your own fallback template** renders the
sender's typed fields: their words and pictures, laid out your way, with nothing of theirs that runs. The
sender's copy stays one press away, shown as it is today. When their template does meet your requirements,
you get it, with all of its dynamic content. You can always set your own template for a sender, or for
everyone.

### 8. Override

Any asset can be replaced by one you choose: `override` maps a subject signature to what you put in its
place, your own template, page or picture. An override is yours, so it runs at the level your own work does.

## Decision for jwize: community trust stops at sealed

**Recommendation: community trust can reach "sealed, with the powers you grant", and never "runs as you".**

Running as you means running in the hive's own document, with your signing key, your storage and every
service in reach. One mistaken or bought claim would then be a total breach, and hive code can still read
the signing key (`hc:nostr:secret-key`, `trust-boundary-and-the-extension-question.md` §10). A sealed frame
with named powers can be as dynamic as any web page, and the worst a bad one can do is what its powers
allow. Running as you stays for what this hive wrote, and what you bring home by hand.

This doc treats that as decided, and it can be changed.

## Built: authorship is not access (M1, 2026-11-28)

Before this, naming a signature made it "authored", and an authored page runs as the hive
(`inline-code-in-input-audit.md` M1):

- `website page <sig>` marked any held resource, a peer's page among them (`commands/website.queen.ts`).
- `/lounge here <sig>` marked any bundle (`revolucionstyle.com/lounge/lounge.queen.ts`).
- The bridge marked whatever a request named: `decoration-add`, `bag-set`, `bag-add`, `update`
  (`assistant/claude-bridge.worker.ts`).
- `changes accept` types received sentences through the participant's own door, so any of these could be
  reached from outside.

Now only writing the bytes marks them (`sharing/authored-sigs.ts`):

- `website page <sig>` dresses the tile and marks nothing. The line says when the page is not this hive's
  own and so runs sealed.
- `/lounge here <sig>` makes the cell a room and marks nothing. A bundle this hive did not write does not
  run, and the line says so.
- The bridge marks only the bytes it put itself (`put-resource`) when a page writer names them. A page or
  bundle the request only names stays what it was.
- A snippet the participant pastes into the hive tab's console stores its pages through
  `WebsiteQueenBee.writeOwnPage(html)`, which writes the bytes and marks them. The living presentation's
  planting snippet uses it (`scripts/bridge/living-presentation/plant.cjs --blocks`), so its pages still run
  as the hive.
- Pages already marked stay marked. Nothing is unmarked by this change.

## Order of work

1. **M1 and this doc.** Built.
2. **The claim type**: the record, the `safety:<subject>` index key, the worker's note into
   `sign('safety:<subject>')` and `safety:pools`, the reader across hosts, and a word to sign a claim. After
   this step the index exists and can be read.
3. **Your requirements**: the document, `safetyOf`, the page gate, and the "vouched by" line.
4. **Mail**: your own fallback template, and `admitted` in the template gate.
5. **Later**: bees through the brood, pictures and SVG, and AI agents signing claims with their own keys.
   An agent's claim counts only when you list its key, like anyone's.

## Open questions

- Should a claim name the exact powers it vouches for, or only a level? (This doc says both: `level`, and
  `powers` when the level carries powers.)
- Should requirements be published, so others can adopt yours by signature? Adopting a filter would be
  the fastest way to upgrade, and the clearest way to see whose judgement you rely on.
- How old may a claim be before it stops counting? A claim is about fixed bytes, so it does not go stale
  the way a review of a living site does, but the claimer's judgement may.
