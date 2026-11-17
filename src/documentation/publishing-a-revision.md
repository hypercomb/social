# Publishing a revision

A build is not a revision. A revision exists because somebody said "publish now".

## The act

```bash
npm run publish:revision                 # a new revision under the default name (essentials)
npm run publish:revision -- beta         # a new revision under "beta"
```

In VS Code: **Terminal → Run Task → Publish revision**. It asks for a name; Enter
publishes under the default name, typing one publishes under it. The broker
(`ws://localhost:2401`) and the authoring hive must be attached — the stamp is
required, so a publish nobody could be told about fails loudly instead of
reporting success. The debt is recorded and the broker pays it when a hive
attaches (`scripts/bridge/owed-stamps.cjs`).

## What it does

1. **Build** — `build-module.ts` (the cache makes an unchanged tree free).
2. **Ship** — `copy-content.ts --publish --name <name>` copies the bytes and
   appends the package to the additive host's `sign('host:packages')` pool. The
   member is `<packageSig>\n<name>`: the second line IS the name, and the member
   file's date IS the revision's date. Nothing else records either.
3. **The public install host takes it** — for the channel the host installs
   (the publisher record's, `essentials`), and BEFORE anything is announced,
   `replicate-public-host.ts` asks the host for every file of the new root by
   its bare signature. Nothing is uploaded and nothing is built: the host's
   worker answers from its heap or reads the file from its **farm** — this
   machine, as jwize.com — and keeps it only if it hashes to its name. The
   package is walked here first, from the bytes this machine published, so a
   missing file stops the run before the host is asked anything; every answer
   is hashed again; a miss is asked once more after a minute; the root is
   asked for last.

   A pull that does not finish stops the publish with a **NOTHING WAS
   ANNOUNCED** box (exit 1): `install:<name>` still names the previous
   package, so nobody is offered a build the host cannot serve. That is the
   point of the order — a stamp naming bytes the host lacked would send every
   client that looked there into a 404 it remembers for good (core `eggs.ts`).
   Fix what the box names and publish again, or publish without the public
   host for one run: `HYPERCOMB_PUBLIC_INSTALL_HOST=none`.
4. **Announce** — `stamp-install-channel.ts <name> --require` advances the signed
   `install:<name>` root through the authoring browser. While the bridge
   carries lines only (the default, `claude-bridge-setup.md`), the stamp waits
   on the hive's command line as `publish:revision: stamp install:<name> → …`:
   press Enter there (Esc declines; the stamp is then owed). It waits up to
   fifteen minutes. Followers of that name
   are told; nobody else is. It also writes the publisher record into both
   shells' copies (`hypercomb-essentials/src/sharing/install-publisher.json`
   and `hypercomb-web/src/setup/install-publisher.json`, byte for byte — a spec
   fails if they differ), because a first install follows that record too.
5. **Confirm** — the host is read the way a cold install reads it: its pool
   head must now be the root, and `/content/<root>` must hash to it. The
   host's pool is derived from the signed index and names a root only once
   its heap holds that root's WHOLE package (the worker walks it and checks
   every file — it never trusts the order anything was pulled in), so it
   moves the moment the stamp does. When it has not moved, a **REPLICATION
   UNCONFIRMED** box gives the retry — `npm run replicate:revision -- --sig
   <root>`, from `src/`, idempotent — and the publish exits **3**: the stamp
   stands, and every byte is already on the host.

   This machine must be on while a publish runs (the stamp goes through it,
   and the host reads the files from it) and is not needed afterwards.

   The host is named in one place (`PUBLIC_INSTALL_HOST` in
   `replicate-public-host.ts`); `HYPERCOMB_PUBLIC_INSTALL_HOST=<zone>` moves it
   for a run, and an empty value or `none` skips steps 3 and 5.
   `npm run replicate:revision` with no `--sig` replicates whatever the
   followed publisher signs now.

### The package's TypeScript rides along, and decides nothing (2026-11-17)

jwize, 2026-11-16: "Host the package's TypeScript without installing it,
fetched only when a file is opened." A build writes one text atom per source
folder to `dist/.typescript/` and names each on its folder's layer
(`knowledge-atoms.md`, "The package's own TypeScript"). The atoms are not part
of the package's closure, so steps 1 to 5 ask for exactly what they asked
before. A publish adds two things around them, and neither changes the exit
code or what anybody is offered:

- **The ship's first act**, before the pool is read: the atoms are copied to
  this machine's host (`scripts/typescript-ship.ts`, only under `--publish`).
  `[copy-content] TypeScript — 46 source atom(s), 18.4 MB: 46 copied, 0
  already held → <dir> (before the pool was read)`. A later publish copies
  only the folders whose text changed. A failure is one line and the package
  ships as before. A copy in flight is stamped with the time it was made, so
  another session's ship, sweeping copies abandoned more than ten minutes
  ago, never takes it for one.
- **After `PUBLISHED`**, last: the public host is asked for each atom by its
  bare signature, the ones over a megabyte one at a time, largest first, and
  every answer is hashed. `[replicate] TypeScript: <host> holds 46 of 46
  source atom(s) of <root> — N copied from its farm (… MB), M already held`.
  Each ask has a clock of its own, thirty seconds plus the atom's size at
  20 KB a second (about four minutes for the largest folder), and three asks
  in a row that get no answer in time end the pass, so a stalled host cannot
  hold a publish that has already printed `PUBLISHED`.
  Anything less prints a **TYPESCRIPT NOT HOSTED** block that says why and
  gives the retry (`npm run replicate:revision -- --sig <root>`). Whenever an
  atom is missed the host's pool head is read, because it is what says why:
  the host's farm gives a root's TypeScript only while the host announces
  that root. The block then says one of: the host is not on this root yet
  (the confirm found it behind; the retry works once it is); this revision
  was superseded (the host was on it and now announces another; no retry);
  the host announces this root but could not read the atoms from its farm
  (this machine's host must be on); its pool could not be read; the pass
  stopped on timeouts. Only a host that announces this root and still
  refuses every atom is told its worker does not take TypeScript. The package
  is published and installs either way; only the code view's TypeScript
  button answers "not on the hosts this hive reads it from" until the host
  holds the atoms. A device's own press also fills the host: asked bare, the
  worker reads its farm, so a missed atom arrives while this machine is on.

Other lines: a publish under a name other than the channel says the
TypeScript is on this machine's host only; a stamp that is not answered adds
that the TypeScript reaches the public host once the stamp is paid; a build
from a checkout before this change `names no source atoms`.

**The worker must carry the change first.** The public host's farm gives
package files only. The worker counts the atoms a package's layers name in
`typescript` as package files, and gives a stream whose length the farm
declares time in proportion to its size (a floor of 131,072 bytes a second),
so a four-megabyte folder is not cut off. That change is merged (#191) and
has to be the deployed worker BEFORE a build with slots is published. There
is no probe for it: the first publish's `holds 46 of 46` line is the proof,
and a later worker deploy from a tree without the change stops the hosting
without any error, so read that line on the publish after every worker
deploy. This machine's relay keeps the atoms of a published package through
`/forget` once it runs the new `relay.js`.

### The host's side (one worker deploy, by the operator, from a clean copy)

hypercomb.com's apex is routed through `pluginthematrix-core`
(`hypercomb-relay/blossom-worker`), and its site stays on Azure (`ORIGIN_HOSTS`).
Two fields on its `SITE_BINDINGS` entry make the heap its package host:

- `"installs": "essentials"` — `/content/<sign('host:packages')>/` and its
  member are derived from the primary publisher's signed `install:essentials`,
  answered only once the heap holds that root's whole package; otherwise
  Azure's staged pool answers, as before.
- `"farm": ["jwize.com"]` — a bare `/<sig>` the heap lacks is read from there,
  on hypercomb.com and every `*.hypercomb.com` name. Because the binding
  installs a channel, the farm gives **package files only**: a signature is
  read through only when it is part of the root the signed index names or of
  the newest member of jwize.com's own `host:packages` pool (which the ship
  step has just appended to — that is what lets step 3 run before the stamp).
  Anything else jwize.com serves — a swarm participant's upload among it — is
  never copied. Files read through keep no owner, so no key's `/forget` takes
  them: they are the published package every install needs.

`/content/<sig>` is the heap's first and Azure's on a miss — never the farm.
Both fields come from the deployed var only, never from a signed record.
Remove them and Azure's staged pool answers again. `npm run
deploy:hypercomb.com` remains the act that redeploys the host card and shell;
it is no longer how a package reaches the host.

**Deploying this worker change.** `npm --prefix hypercomb-relay/blossom-worker
run deploy:pluginthematrix` builds the visitor engine from the working tree it
runs in (`build:site` → `hypercomb-web build:visitor`, whose prebuild rebuilds
essentials and takes the newest local package) and ships it to every bound
host. So it runs ONLY from a clean worktree at the merged commit — never from
the shared checkout, whose working tree holds other sessions' edits, and never
before this change is merged (a deploy from a checkout without it silently
ships the old worker). In the copy: diff its `public/content/manifest.json`
against the live one first, then `npx wrangler versions upload --config
wrangler.pluginthematrix.toml`, `npx wrangler versions deploy <live>@100%
<new>@0%`, the cold-load audit against `<new>`
(`HC_VERSION=<new> node scripts/visitor-cold-load.cjs`), and promote with
`versions deploy <new>@100%` only when every site comes up. Until it is live,
step 3 finds no farm and a publish stops there — publish with
`HYPERCOMB_PUBLIC_INSTALL_HOST=none` meanwhile.

## Names

- A name is also an install channel, so it is lowercase letters, digits and
  hyphens, starting with a letter. Anything else is folded to that.
- **Unnamed means the default name, always** — never "whatever was last
  published". The same command means the same thing every time.
- A name never published before starts a new named head. Publishing the head of
  a name again is a no-op; going back to an earlier package, or moving a package
  to another name, is a NEW member — the pool is a history and only grows.

## What a plain build does now

`build:module` copies bytes and puts the working build at the head of the
mirrored dev feed (`hypercomb-web/public/content`), so local iteration is
unchanged. It does not enter the additive host's pool and it does not stamp, so
a build can never become a revision a follower is offered. The dev feed keeps
one unpublished head on top of the published pool and rewrites it each build;
the additive host stays append-only.

## How an instance shows it

Host directory → a package's revisions. One heading per name, its dates
beneath it, newest first:

```
stable                      ← the name with the newest revision leads
   2026-09-20 12:00
   2026-09-19 09:30
   2026-09-17 08:00         ← a name that came back appends to its own heading
renamed
   2026-09-18 08:00
```

A name is the active line its revisions belong to, so every revision published
under it lands under that one heading wherever it falls in time. Nothing is
stored to make this so: read every label a host's pool carries, and the dates
give the order. A revision published under two names is a line under each, at
its own date. Revisions nobody named (held here, or published before names
existed) sit last under "Held here"; a list with no names at all stays one
plain list.

The name is the pool member's label, carried as `InstallRevisionSource.name` by
`revisionsOf` (`acquire.ts`); `revisionGroups` in `host-directory.view.ts` is the
pure function that builds the groups. Note a revision here is one PATH's layer, so
a path that did not change between two publishes appears once, under the newest
name that carried it.

Only what may be taken here is listed (`offeredRevisions`): the root the
publisher you follow names now — it leads and is the one marked "latest", even
before any host dates it — what runs here, and roots that publisher named
before. A host still serving an older build is not offered in this hive's list;
it says "{host} hasn't got the newest version yet" under its own name, and an
update no host can serve yet reads "An update is ready, but none of your hosts
has it yet", with no button that would end in the activation gate's refusal.
