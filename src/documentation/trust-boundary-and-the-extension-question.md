# The trust boundary, and the browser-extension question

status: **discussion paper — nothing decided, nothing built**
date: 2026-08-30
companion to `security.md` (policy) and `known-location-pools.md` (storage doctrine).

---

## 0. The question

> Would it be a good idea to move our security layer for trust domains into a
> Chrome extension, thus allowing audit of the running scripts, so bad players
> can't host on their own domain and run malicious code? Or at least a
> redundancy there.

## 1. Verdict

**As a replacement for the in-page gates: no.** An extension cannot prevent
execution on an origin the attacker controls, and "audit the running scripts"
is not soundly decidable in a system built on dynamic `import()` + import maps.

**As a redundancy: yes — but not the redundancy the question describes.** The
value an extension adds is not script auditing. It is two things a page can
never honestly do for itself:

1. hold trust state that **survives the origin boundary**, and
2. render a **prompt and an attestation the page cannot forge or suppress**.

**The higher-leverage work is cheaper and comes first:** we have *two
independent trust gates* with different mechanisms, different storage keys, and
no shared vocabulary. Converging them — on the signature, not the domain —
buys more real safety than an extension, and it is a refactor rather than a new
distribution channel.

---

## 2. What actually exists today

This was the surprise of the review. There is not one trust layer; there are
three enforcement points and one integrity layer, built at different times,
agreeing only on a `localStorage` key.

### Gate A — the installer's activation gate (domain-keyed)

`TrustService` — `hypercomb-shared/core/trust-service.ts`

Doctrine, quoted from the file header: *adoption = downloading bytes, always
safe; activation = letting code execute, this is what carries risk.* The gate
fires at activation.

`check(domains)` resolves against `hc:community:domains` (localStorage, JSON
array of hosts), falls back to a session-local allow-once set, and otherwise
emits `trust:check` on the EffectBus for
`hypercomb-shared/ui/trust-prompt/trust-prompt.component.ts` to answer with
`allow-once` / `allow-always` / `deny`.

Its **only** callers are in the DCP installer shell —
`diamond-core-processor/src/app/home/home.component.ts:2736` (single toggle),
`:2824` (toggle-all over a branch containing code), and `:2938` (hatching an
untrusted egg). It gates off→on transitions for *code kinds* only — bees, deps,
workers, drones. Denial is durable and legible: the node becomes an **untrusted
egg**, "known + visible but can't hatch."

That design is good. Note what it is keyed on: **the source domain**.

### Gate B — the essentials render gate (signature-keyed)

`featureNeedsReview` —
`hypercomb-essentials/src/diamondcoreprocessor.com/sharing/feature-availability.ts:153`

A wholly separate gate, fail-closed, that stops a *foreign, unverified* heavy
visual feature (a website, a game) from mounting, running scripts, or pulling
resources. Called from `site-view.drone.ts:496` and `show-features.drone.ts:1302`.

Its formula composes four independent signals:

```
featureNeedsReview = isForeignContent(segments, domain)
                  && !isLocallyAuthored(sig)             // hc:authored sigs
                  && !isFeatureAvailable(sig, domain)    // hc:feature-verified ∪ trusted domain
                  && !isWithinAllowedRoot(segments)      // hc:allowed-roots, path prefix
```

This gate is **already signature-first**, with the domain as one input among
four. It is the more evolved of the two, and it carries hard-won corrections in
its comments — the self-domain is seeded from the deployment origin, so every
participant on a shared origin carries the *same* self-domain and a peer's
adopted page arrives attributed to "your" domain. Comparing domains alone **ran
foreign code ungated**. The fix was to make tree position authoritative and let
per-signature authorship be the rescue.

That lesson is the whole paper in one paragraph: **domain identity degraded
under exactly the condition the extension proposal worries about — shared and
attacker-influenced hosting — and the fix was to lean on signatures.**

### Gate C — the roster, where a decision becomes runtime effect

`hypercomb-shared/core/script-preloader.ts:150`: *"This is the trust boundary —
if DCP says a bee is off, it must not pulse."* Gate A produces a decision; the
roster projection carries it; the preloader enforces it at pulse time. Worth
naming separately because it is the only place where "not trusted" becomes
"does not execute."

### The integrity layer — already solved, do not re-litigate

Every fetched byte is sha256-verified against the signature that requested it,
across every tier of the fetch cascade (`content-broker.drone.ts:895`) and in
the service-worker path (`sw-domains.ts`). The comments state the consequence
precisely: *a wrong or hostile domain list can only cost a 404, never serve
wrong bytes.*

**This matters enormously for the extension question.** Content integrity is
not the gap. A malicious host cannot substitute bytes for a signature you asked
for. What a malicious host can do is offer you *its own* signatures and
persuade you to activate them — a social problem at the activation boundary,
not a transport problem.

### Aside — a fourth, unrelated list

`diamondcoreprocessor.com/safety/link-safety.service.ts` keeps a hardcoded
`TRUSTED_HOSTS` set and defers to a local LLM at `127.0.0.1:4220` for unknown
URLs. Different problem (outbound link safety), different list, no relation to
community trust. Flagged only so a future "unify the trust vocabulary" pass
does not mistake it for a fifth gate — it should stay separate.

---

## 3. Threat model, decomposed

"A bad player hosts on their own domain and runs malicious code" is four
different scenarios with four different answers. Separating them is what makes
the extension question answerable.

### T1 — Attacker serves a hostile shell on `evil.com`; user visits

**What they can do:** anything they want, inside their own origin. Inline a
payload in the HTML, never touch the bee-loading path, render a perfect fake of
our trust chrome, forge a "✓ community trusted" badge.

**What contains it today:** the browser's origin sandbox. OPFS is per-origin —
`evil.com` cannot read the user's hive on `hypercomb.io`. The attacker gets a
hive of their own to vandalize.

**What an extension changes:** it can *warn*, and it can tell the user the truth
about what they are looking at. It cannot *stop* the page. This is the scenario
the question is aimed at, and it is the one where an extension is weakest as a
control and strongest as a witness.

### T2 — User adopts a malicious bee from `evil.com` and activates it at home

**This is the real threat.** A bee that registers in IoC has full access to the
participant's tree. The damage happens on the user's *own* origin, where the
page is trusted by construction.

**What contains it today:** Gate A (installer) and Gate B (render), both at the
activation step. This is correct placement.

**What an extension changes:** nothing structural. The gate is already on the
right boundary, on an origin the extension has no privileged view of. An
extension would re-implement an in-page check outside the page for no added
authority.

### T3 — Attacker gets into the trusted-community list

`hc:community:domains` is per-origin localStorage that *the page can write*. On
`evil.com`, the attacker's own page seeds its own community list; on our origin,
any XSS-equivalent foothold rewrites it.

**What contains it today:** nothing much. This is a genuine soft spot.

**What an extension changes:** this is the strongest case for one. Trust state
in extension storage is not writable by any page, and is one list across all
origins rather than N attacker-controlled copies.

### T4 — A trusted domain later turns hostile, or is compromised

Domain trust is not revocable per-artifact, and it is coarse: trusting
`alice.dev` trusts everything `alice.dev` ever publishes, retroactively and
prospectively.

**What contains it today:** Gate B's signature set partially — a verified sig
stays verified regardless of what its domain does later, which is the correct
direction. Gate A's domain trust has this failure mode fully.

**What an extension changes:** nothing. This is an argument for signatures over
domains, independent of where the check runs.

---

## 4. What a Chrome extension can and cannot do

Stated at mechanism level, MV3-honest, so this is not re-argued later.

### Genuinely can

- **Hold state no page can read or write.** `chrome.storage` is outside every
  origin. Directly addresses T3.
- **Render UI the page cannot forge or suppress.** Extension popups, the
  toolbar badge, and `chrome.notifications` draw outside the page's pixels. A
  hostile page can fake in-page chrome perfectly; it cannot fake the browser's.
- **Observe network activity the page cannot hide.** `declarativeNetRequest`
  and the debugger protocol see fetches regardless of page intent.
- **Attest which shell you are actually running.** Hash the delivered shell and
  show the signature in the toolbar. This is the single most valuable item on
  the list, because it is the one fact a page can never honestly report about
  itself.

### Cannot

- **Prevent execution on a hostile origin.** MV3 removed blocking
  `webRequest`; `declarativeNetRequest` matches static rules, not content it has
  not seen yet. Blocking an inline `<script>` requires injecting CSP before the
  document parses — racy, breaks legitimate pages, and trivially avoided by an
  attacker who simply does not use the mechanism you are watching.
- **Soundly enumerate "the running scripts."** With dynamic `import()`, import
  maps, `blob:`/`data:` URLs, worker bootstrapping, and `eval`, there is no
  complete list of what executed. You get a best-effort census, not a proof.
- **Make a signature census meaningful against a hostile host.** The audit logic
  is "compare loaded signatures against a known-good manifest." The attacker
  never claimed a signature in the first place. A mismatch tells you something
  you already knew from the URL bar.
- **Protect anyone who has not installed it.** Which is everyone at the moment
  of first contact — precisely when the attack lands.

### The distribution cost, stated plainly

A *required* extension inverts the project's stated posture. `security.md` opens
with *presence-first… no account system, no credential store*. The system's
reach is "works from a URL." A required extension replaces that with a
Chrome-Web-Store-reviewed install gate, hands Google a veto over our security
layer, and abandons Firefox/Safari/mobile users. An *optional* extension
protects only the already-cautious.

Not fatal — but a real cost, to be priced against a benefit that on inspection
is narrower than it first appears.

---

## 5. The structural recommendation

**Trust the signature, not the domain.**

Domain-based trust is precisely the thing that fails when anyone can host. If
activation is gated on `sig(artifact)` against a set the participant has vetted,
then *where it was served from stops being load-bearing*: either the host serves
bytes whose signature you already trust — in which case the host's identity is
irrelevant — or it serves different bytes with a different signature, and the
gate fires. The sha256 cascade already guarantees the first branch cannot be
forged.

We have most of this. Gate B is signature-first and carries the scar tissue
proving why. Gate A is domain-only and is the older design. The convergence:

- Gate A adopts Gate B's composite formula, keyed on the artifact signature with
  the domain demoted to one signal among several.
- The two gates share a vocabulary. Today they agree on exactly one
  `localStorage` key (`hc:community:domains`) and deliberately never import each
  other. That independence is defensible for the *writer/reader* split; it is not
  defensible as *two different definitions of trusted*.
- Domain trust survives as what it actually is: a **convenience heuristic for
  skipping prompts**, and a **fetch-ordering preference** — which is already all
  it is inside the content broker's tier cascade. It should not be the authority
  for whether code may run.

This makes the extension question smaller and easier to answer later, because it
removes the coarsest failure mode (T4) without a new distribution channel.

---

## 6. If we do build an extension — what it should be

Not a security layer. A **witness**. Small enough to audit in an afternoon,
useless to attack, and valuable even to a user who ignores it.

**Capability 1 — origin-independent community list.**
The trusted set moves to `chrome.storage`, readable by our origins via
`externally_connectable`, writable only through the extension's own UI. Directly
fixes T3. Independent of any auditing.

**Capability 2 — unforgeable prompt.**
When Gate A or B needs a decision, the extension renders it, outside the page.
An evil shell can fake our in-page trust prompt today; it cannot fake this.

**Capability 3 — shell attestation badge.**
Hash the delivered shell; show *"you are running shell `a1b2c3…`"* in the
toolbar, green when it matches a signature the user has seen before, plain
otherwise. This is the honest version of "audit the running scripts": not a
proof of what executed, but a truthful statement of what was *delivered* — the
fact a hostile page most wants to lie about.

**Explicitly not in scope:** blocking execution, enumerating dynamic imports,
scanning page contents for malice, or being required for the app to function.

---

## 7. Staged proposal

Cheapest first. Each stage independently valuable and independently abandonable.

| # | Work | Buys | Cost |
|---|---|---|---|
| 1 | Converge Gate A onto Gate B's signature-first formula; write down one definition of "trusted" | Fixes T4; removes the two-vocabularies hazard | Refactor, no new surface |
| 2 | Make `hc:community:domains` writes deliberate and legible — one writer, visible in the pools UI, an audit trail of when each domain was added and by what gesture | Blunts T3 in-page | Small |
| 3 | Extension capabilities 1 (trust list) + 2 (prompt), optional, degrading cleanly to in-page when absent | Properly fixes T3; hardens the prompt against T1 spoofing | New artifact, store review, maintenance |
| 4 | Extension capability 3 (shell attestation badge) | The honest core of the auditing idea | Small once 3 exists |

Stages 1 and 2 are worth doing whether or not the extension is ever built.
Stage 3 is the decision point — where the distribution cost is incurred.

---

## 8. Open questions

- **What is "the artifact" a trust decision is keyed on?** Gate B already
  wrestles with this — per-sig verification broke adopted sites across reloads
  because each child page re-gated individually, which is why `hc:allowed-roots`
  exists. Branch-scoped allow is the working answer; is it right for code as
  well as for sites?
- **Should trust decisions be shareable?** A signed community attestation
  (*"alice vouches for `sig`"*) fits the mesh and the project's community-graph
  doctrine far better than a per-device localStorage list, and would make Gate
  A's `allow-always` meaningful across a participant's devices. This may be a
  better investment than the extension entirely — the same problem (trust state
  that outlives one origin's storage), solved with a primitive we already have
  rather than one Chrome lends us.
- **Does the installer's egg model generalize?** *Known, visible, cannot hatch*
  is a genuinely good failure mode — durable, never "failed," always
  recoverable. Gate B's review prompt is a different shape for the same
  situation. One of them should win.
- **Who is the attacker we are actually defending against?** T1 (hostile host)
  is contained by the browser far better than the framing suggests. T2 (carry it
  home) is the one that hurts, and is already gated. If the honest answer is "T2
  and T3," the extension is a stage-3 nicety, not a security layer.

---

## 9. One correction for the record

An earlier verbal pass on this question stated that in `hypercomb-web`/`dev`
"nothing calls the activation gate." That is true of `TrustService.check`
specifically, and it misleads: the web shell has its own fail-closed activation
gate in `featureNeedsReview`, with a *better* mechanism than the installer's.
The problem is not a missing gate. It is two gates that do not know about each
other.
