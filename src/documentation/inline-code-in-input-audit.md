# Where input can still carry code: an audit

**Status, 2026-11-26.** A read of the code only. Nothing here is fixed yet, and nothing was changed to write
it. Each finding says whether it was **checked by hand** (the lines were read and the path confirmed) or
**reported** (found by a read-only sweep and not re-read line by line).

## The rule being checked

jwize, 2026-11-26: *"any form of code that has any sort of danger has to be templated like this. there should
never be any inline code anywhere in the input for obvious safety reasons. Resources can be signature verified
but code snippets cannot."*

The model is the mail template (`mail-templates.md`):

- The dangerous part (html, script, layout) is **one vetted resource, named by its signature**. An audit of
  those bytes holds for every use of them.
- The input brings **only typed field values**, and the resource escapes each one by its type.
- A resource that carries anything outside its allowed set is **refused whole**, never stripped.
- **Code runs only by signature**, through the activation gate, and someone else's code runs **sealed**
  (`trust-boundary-and-the-extension-question.md` §10).

**Input** here is anything this hive did not write: received mail, a model's reply or write, a call from
outside, a paste, a peer's page or contribution, a host's offer or package, a URL, a `postMessage`, an upload
to a host.

A signature proves the bytes are the ones named. It does not prove that this hive wrote them, or that anyone
vetted them. Most findings below are one of two mistakes:

- treating a signature that is merely **held** as **authored**; or
- treating bytes **named** by a signature as **verified**, without hashing them.

## The short answer

- **Most of the system already follows the rule:**
  - Received mail and the chat's markdown are escaped or shown in a frame that runs no script.
  - Someone else's page runs sealed or is shown as inert text.
  - Community page edits may change only words.
  - Packages pass the activation gate before anything is fetched.
  - Nothing found anywhere calls `eval` or `new Function` on input.
- **Two places let a model's code run inside the hive** (H1, H2). In both, a page a model wrote can run in
  the hive's own document, with its key, its storage and `window.ioc` in reach.
- **Three places let held bytes become "authored" or "verified" without proof** (M1–M3).
- **The rest are lower**, mostly links whose scheme is never checked, and code bytes fetched without being
  hashed where the host is already trusted.

## High

### H1. A model's write to one part of a page runs inside the hive (checked by hand)

A model writes a whole page through `files/tile-files.drone.ts` (a `hypercomb-write` block). That page is a
**trial**:

- `#stage` calls `rememberTrial` (`tile-files.drone.ts:204`);
- the site view shows it on `try-<name>.` and never in the hive (`site-view.drone.ts:873-879`).

A model can also write **one part** of a page in parts, or its shell (`#writeFile`,
`tile-files.drone.ts:215-232`). That rebuilds the page through `planPartRebuild` → `commit`
(`files/page-parts-commit.ts:214-220`) → `commitPageSigFrom` (`files/page-commit.ts:76`):

- The rebuilt page is marked **authored**, because the page it replaced was.
- **No trial is remembered.**

So the rebuilt page, holding the model's markup and script, mounts in the hive's own document.

**What it should be:** a rebuilt page made from a write that arrived through the model's door is a trial,
exactly as a whole-page write is. `commit` should stage the trial as `#stage` does, or `tile-files` should
remember the trial after `rebuild.apply()`.

### H2. The trial is asked in one place only (partly checked by hand)

`trialOf` is asked by the site view alone. A trial page is also marked authored (`tile-files.drone.ts:194`),
so any other surface that asks only "may it run, and must it run sealed?" runs it in the hive:

- **The room view (checked by hand).** `revolucionstyle.com/welcome/room-view.drone.ts:143-156` resolves the
  same page, asks `mayRunPage` and `pageRunsSealed`, and never asks `trialOf`. It then runs the page's
  scripts at 254-255 (reported).
- **A trial page seated as a part (reported).** It can be seated into one of this hive's own pages, which
  runs in the hive:
  - `presentation/tiles/division-render.ts:146-151`;
  - `website/trait-seat.ts:84-101`;
  - the `ownPart` gate in `site-view.drone.ts:1270-1274` never asks about trials.
- **A fresh tab (reported).** `files/try-page.ts:126-140,173` loads the trial ledger only on the first
  `trialOf` call. The first page mounted in a fresh tab can read an empty ledger.

**What it should be:** "is it a trial?" belongs inside the one question every page surface asks
(`page-run-gate.ts`). A trial would then answer `pageRunsSealed` as true wherever it is asked, and the ledger
is read before that answer is given.

## Medium

### M1. Naming a signature makes it "authored" (checked by hand)

`website page <sig>` (`commands/website.queen.ts:511-534`) calls `markAuthored(sig)` for **any resource the
hive holds**. That includes a page that arrived from a peer by adoption or by the content broker. The page
then runs in the hive's own document, and the service worker stops sealing it (`authoredHere`,
`hypercomb.worker.js:326-339`, reported).

Two other paths do the same (reported):

- `/lounge here <sig>` marks any bundle authored (`revolucionstyle.com/lounge/lounge.queen.ts:102`).
- The bridge marks whatever signatures a request names (`assistant/claude-bridge.worker.ts:1571,1630,2198`,
  and `decoration-add` at 1439-1444).

`changes accept` makes this reachable from outside (reported). It types sentences received over the change
channel through the participant's own door (`assistant/changes.queen.ts:112-115`, `change-channel.drone.ts`),
and nothing there refuses `website page`.

This is the rule from 2026-11-16 ("authorship only from this hive's own writes") broken by a command: a
signature becomes "ours" because someone typed it.

**What it should be:** `markAuthored` only for bytes this hive just wrote. For a signature that is only held,
a page made from it inherits its source (`commitPageSigFrom`), so someone else's page dressed onto a tile
still runs sealed.

### M2. Code fetched by signature, run without hashing it (checked by hand)

On the read-only visitor, a dependency the store does not hold is fetched from the host by its signature.
Its bytes are wrapped as a JavaScript blob and imported **without being hashed**:

- `hypercomb-web/src/setup/resolve-import-map.ts:171-176` and `:419-421`;
- reported for the shim as well: `hypercomb-shim/src/import-map.ts:299-312`.

The comment at `:358` says "sha256 gates the bytes", but these lines do not. The participant's path re-hashes
(`hypercomb-runtime/src/store.ts:2699-2711`), and so does the module-root path, through import-map integrity.

Two more paths have the same gap (reported):

- The install index itself is fetched and never hashed (`hypercomb-web/src/setup/ensure-install.ts:1124-1128`).
- Its alias keys are not checked to be signatures (`hypercomb-runtime/src/install-index.ts:72-81`).

The host serving the page could serve any script anyway, so the gain to an attacker is small. But this is
code named by signature and not verified by it, so a stale cache, a proxy or a bad `/content` path runs.

**What it should be:** hash the fetched bytes against the signature before making the blob, as the bootstrap
loader already does (`hypercomb-shim/src/bootstrap-loader.ts:95-101,138-140`).

### M3. Any stored blob is served as a script on origins that hold a key (checked by hand)

On the worker, a request for `/<sig>` that says it is a script, worker or shared worker
(`Sec-Fetch-Dest`) gets the stored bytes re-typed as `text/javascript`
(`hypercomb-relay/blossom-worker/worker.js:7809-7812`, `asScript` at `5308-5318`). The bytes are whatever was
uploaded: the sha256 names them, and nothing checks them for code.

- **Pages are safe.** `CSP: sandbox` and `nosniff` keep a blob from opening as a page (`5156-5157`).
- **Scripts are not.** Those headers do nothing when the blob is loaded as a script or a worker.
- **The origins hold a key.** The front doors (`serveFrontDoor`, reported at `1950-1990`) set no CSP, and the
  shim keeps the device key in localStorage.

This needs a first foothold: something on that origin has to load the blob as a script. But after that, any
participant's upload becomes code next to the key, or a service worker that stays installed.

**What it should be:** only signatures that are a published package's modules (bees and dependencies of a
signed index) are served as scripts. Everything else stays bytes. Front doors also get a CSP whose
`script-src` names only those modules.

### M4. Contributions that change only words: right shape, one missing check (checked by hand)

Community page versions follow the rule already. The base page is the vetted resource, and a contribution may
change only its words (`presentation/tiles/page-text-only.ts`):

- same nodes, same tags, same attributes;
- script and style text untouched;
- anything else refused whole.

Two things are left:

- **The mount does not check again.** `#versionShown` (`site-view.drone.ts:1617-1622`) trusts the reader's
  own choice and does not re-check `textOnly`. Only the menu keeps a version that changes more from being
  chosen (`site-versions.ts:168,228`). The mount should refuse a version that is not words-only, fail closed.
- **The base page's own script can read the words (reported).** A script that feeds them into `innerHTML`
  turns a contributor's words into markup. This is the same duty as a template's future script: treat the
  fill as data.

### M5. Link schemes are not checked before a link opens (reported)

Each of these can carry `javascript:`. The only protection is `noopener`. Whether a browser runs it through
`noopener` was not tested.

- **Slides.** `presentation/tiles/slides-view.drone.ts:1337` calls `window.open(slide.link)` with the tile's
  raw `link` property (checked by hand: it is only trimmed, at ~1010).
- **Opened links.** `link/link-open.worker.ts:93` opens a link after `link/normalize.ts:29`, which lets
  `javascript://%0a…` through.
- **Publications.** `presentation/tiles/document-view-links.ts:62-66` sets `a.href` to a card URL taken from
  a community host's ledger (`sharing/publications-ledger.ts:124`) and clicks it.

**What it should be:** one `url` check, the template's (http, https or mailto that parses, with no
`user:pass@`), wherever a link from data is opened.

## Lower

### Model replies

- **A model's `hypercomb-do` lines run on arrival (reported).** `assistant/chat-work.ts:136-140` never sets the
  `foreign` hold, and the default policy runs every kind, destructive included
  (`assistant/permit-groups.ts:108-121`). These are typed sentences checked against the vocabulary, not code,
  but a reply steered by injected text acts with no hand on it.

### Calls from outside and the bridge

- **The run preview takes Enter from other fields (reported).** `assistant/run-preview.view.ts:283-298` takes
  Enter, F5 and F10 from any focused field except the command line, once armed. An Enter typed in the chat or
  mail composer can run a waiting outside call. It still goes through the machine door and its grants.
- **The bridge, once opened to all, is wide (reported).** Opening it is the owner's opt-in.
  - `effect-emit` can answer the external-call ask itself.
  - `overlay:register-action` markup reaches `innerHTML` (`tile-view.drone.ts:1556`, `app-deck.ts:265`,
    `tile-brief-panel.ts:375`, `square-tile-menu-panel.ts:81`).
- **A meeting leader's lines run without Enter (reported)**, for the verbs the participant allowed
  (`meeting/hive-meeting.drone.ts:700-701`). That is `go` only by default.
- **Keyboard lineups (reported).** Their `cmd` steps fire `keymap:invoke` with no grant check
  (`keyboard-desk/lineup/lineup.ts:78-80`). Where shared lineups come from was not traced.

### Import maps and the boot path

- **Aliases are first come, first served (reported).** A dependency names its own alias from its first line
  (`hypercomb-runtime/src/bags.ts:51-55`), and only `@hypercomb/core` and `pixi.js` are protected
  (`resolve-import-map.ts:126-127,294`). A dependency can take another package's alias. The alias should be
  checked against the package that ships it.
- **The saved import map is replayed before any gate runs (reported).** `hypercomb-web/src/index.html:88-101`
  replays `localStorage['hc:importmap']` unchecked. It needs code already running, but it turns one run into
  persistence.
- **The phone pin is a hash, not a signature (checked by hand).** `hypercomb-web/src/index.html:163-180`
  imports the pinned code from `hypercomb.com/pin` after checking that it hashes to the pin. The pin itself
  is trusted because of TLS and the owned zone, not a key.

### Frames, folders and the owner's replica

- **Bees are imported from pool bytes without being hashed again (reported).** `script-preloader.ts:1563`,
  `store.ts:1192-1196`; the writers do verify.
- **The owner's replica runs unsealed by where it sits in the tree (reported).** `feature-availability.ts:170`
  → `adopted-roots.ts:209-214`.
- **A sealed page can widen its own session (reported).** `hcFrameWiden` needs no token or click
  (`site-view.drone.ts:1148`, `#widen` 581-592). The frame has no network.
- **The lens and revision viewer skip the review gate (reported)** (`website/lens.view.ts:369-372,545-552`,
  `history/revision-viewer.view.ts:345`). They are sealed: `allow-scripts` only, no frames, and source-checked
  messages.
- **The portal frame trusts any URL (reported).** `hypercomb-shared/ui/portal/portal-overlay.component.ts:80`
  uses `bypassSecurityTrustResourceUrl`, with `allow-scripts allow-same-origin`. Every caller today passes a
  fixed target.
- **The layout designer's raw markup (reported).** `hypercomb-shared/ui/layout-designer/raw-html.directive.ts:52`
  mounts the markup without Angular's sanitiser. It is fed only by the app's own builder, which sanitises
  values.

### Received mail

- **It is cleaned, not refused (reported, and known).** `mail/mail-html.ts` strips what it does not allow and
  shows the rest in a frame that runs no script (`allow-popups` only, CSP `default-src 'none'`).
- **That is not the template rule, and it cannot be.** A stranger's email has no vetted resource behind it.
- **What fits the rule:** run nothing (true today), and show it as the stranger's, never as the hive's.

### Hosts and dev tools

- **The mail Worker sends whatever html the owner's key signs (reported)** (`hypercomb-relay/mail-worker/worker.js:572,610`).
  The template header is only a hint, and the Worker does not check the html against a template. A leaked
  owner key can send any markup from the domain.
- **The relay's heap has no `nosniff` or sandbox (reported)** (`hypercomb-relay/relay.js:2129-2137`), on the
  origin that also serves the shim with `--shell-dir`.
- **The hosting generator splices tile names into command lines and paths (reported).**
  `scripts/bridge/_hosting-site/generate.cjs:178,230,739,665,721` puts child names into hive command lines
  and file paths unchecked.
- **Dev hosts serve uploads with no type or no CSP (reported).** `scripts/local-relay.ts:142-180` and
  `scripts/local-content-host.mjs:229-235`; the visitor mirrors drop `nosniff`.

## Already following the rule (a sample)

- `mail/template.ts`: templates refused whole, fields typed and escaped.
- `mail/format.ts`: every character escaped, a fixed set of tags, links parsed.
- Chat markdown: escaped before `innerHTML` (`chat-markdown.ts:51,76`).
- Sealed page mounts (site view, post-it, lens, revision viewer):
  - `sandbox="allow-scripts"` inside a `sealedWrapper`;
  - a CSP with no frames;
  - messages checked by source, with a token and a live click for links.
- An unreviewed page is shown as inert text (`inertPageText`). A page with someone else's part runs sealed
  whole.
- The activation gate decides before any fetch (`activation-authority.ts:103-137`), and `mayRunBee` is asked
  where a bee becomes code. DependencyLoader re-hashes.
- The service worker seals html, svg and xml from `/@resource/` on navigations and frames, with `nosniff`.
- The worker's own pages escape every value. Mail and the heap send `nosniff`. Headers built from input are
  checked for CR and LF.
- Links that are built rather than copied:
  - offering routes are https only (`host-offerings.ts:54-58`);
  - YouTube ids are checked before the embed URL is built;
  - the welcome links pass `href()`.
- Searched for and not found on any input path: `eval`, `new Function`, `setTimeout(string)`, `document.write`.

## Not traced

- How a `hypercomb-write` block is approved by the person before H1's write
  (`hypercomb-shared/ui/chat-window/hypercomb-work-fence.ts`).
- Whether `javascript:` runs through `window.open(…, 'noopener')` in Chromium or WebView2.
- The main hive document's own CSP, and the headers of the Azure origin behind hypercomb.com.
- Where shared keyboard lineups come from.
- `#post=` and open-entry pools: their code is not in this branch.

## Decisions for jwize

1. **H1 and H2 first.** Make "is it a trial?" part of `pageRunsSealed`, and make a part rebuilt from a model's
   write a trial. Then a model's code never runs in the hive by any route.
2. **"Authored" only from this hive's own writes (M1).** `website page <sig>` and `/lounge here <sig>` would
   dress a tile with a held page but leave it sealed unless this hive wrote it. Should accepting someone
   else's page as your own stay possible at all? If it should, it would go through the brood's hand, with its
   two warnings, and never through a typed signature.
3. **Verify every code byte by its signature (M2, the bees in Lower).** Hash before import everywhere, even
   where the host is trusted.
4. **Scripts only for published modules (M3).** The worker would serve a signature as a script only when a
   signed index names it as a module.
5. **One link check (M5).** Use the template's `url` rule wherever a link from data is opened.
6. **Received mail stays cleaned and inert.** It has no template to fill, so the rule for it is "runs
   nothing, and is shown as the stranger's".
