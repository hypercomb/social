# Module sandbox — every module change is reviewed in public before it goes live

**Status: steps 1–2 BUILT and proven on this machine (2026-09-22, `scripts/verify-hive-publish.cjs` 26/26); steps 3–4 and the communal build not built; the worker is not deployed.** Builds on `hive-read-fence.md` ("Writing a module"), `jev-audit-2026-09-21.md` §6, `install-by-replication.md`.

jwize: "The idea of making a module — then we should go and debug it on a sub domain of one of our hosts, and that way we can review the code from our AI on that host, allowing us to make sure that it's in sandbox until we are happy with it. This should be the paradigm [for] new module changes, because you're basically publishing them to the public as well, so other people can view the code and make their own assessments."

## The paradigm

A module change is never published straight to the live channel. It goes to a **sandbox** first:

1. **Draft** — a model writes a module section; it runs here as a draft (built).
2. **Commit to a sandbox** — `module commit` uploads the new files to the host (built) and stamps a SANDBOX channel, `install:<change>`, in the publisher's signed index. The live channel (`install:essentials`) does not move.
3. **Debug at a subdomain** — `<change>.<zone>` on one of our hosts boots the hive with the package that channel names. Its own origin is its own storage, so nothing it does touches anyone's hive: the origin IS the sandbox.
4. **The host's AI reviews it** — the code the change added is read by the host's AI and scored by Jev, and the review is published beside the change as a signed resource. The pieces exist: the host's `/ai/ask` endpoint, and `safety/brood-audit.ts` (an agent reads held code, Jev scores accept or refuse, the verdict is only ever a score a person acts on).
5. **The public reviews it** — the subdomain is public and the modules are readable, unminified ESM (`code`, `read <sig> src/path.ts`). Anyone can read the change and leave a signed assessment on its root signature.
6. **Promote** — `module promote <change>` stamps `install:essentials` → the sandbox root. Same signature, same files: no rebuild, no re-upload, one pointer move (`feedback_packages_are_followed_pointers`). Followers see the update notice then, and not before.
7. **Withdraw** — the sandbox pointer is removed; the subdomain answers "nothing here". Its files stay on the host under their signatures: unreachable, never deleted.

## What existed before the build (see 'As built' below)

| Step | Today |
|---|---|
| Draft, upload, signed channel stamp | Built, proven (`scripts/verify-hive-publish.cjs` 21/21) — but commit stamps the LIVE channel by default |
| Sandbox channel name | `module commit <name>` already takes any channel word; the default must become a sandbox, and the live stamp must move to `promote` |
| Subdomain boots a package | Missing. The worker maps `<label>.<zone>` only to published TILE lineages, served by the read-only visitor engine (`main.visitor.ts`, memory filesystem). A channel key (`install:x`) is deliberately not a hostname. Needs: a rule mapping a sandbox subdomain to `install:<label>`, a `package` field in `/site.json`, and a boot that takes its package from the door (authority: the door's own operator key) |
| AI review on the host | Parts exist (`/ai/ask`, `brood-audit.ts`); not wired to a published change |
| Public assessments | Missing. Not pheromones — a pheromone is an interest signal, never a verdict. A signed note on the change's root signature, listed on the sandbox door |
| Promote, withdraw | Missing words; `setHiveRoot` sets one key; removal of a key needs checking |

## Decided (jwize, 2026-09-22): one live host

**Sandboxes go to `hypercomb.com`.** Its `*` wildcard is already live, and sites are already served at `<label>.hypercomb.com`. Nested labels are refused, so a sandbox and a site share one label space: every sandbox is named `try-<change>`, which no site uses.

## Still open (jwize's calls)

- **Who uses a sandbox.** Built as a full hive for everyone who opens the door, so anyone can draft on top of a trial and commit their own. A read-only visitor role could still be added for people who only look.
- **Deploying the worker.** The route change deploys the public worker to Cloudflare. It can be built and proven on this machine against `scripts/local-content-host.mjs` at `try-<change>.localhost:4291`, but deploying it is jwize's act.

## Build order

1. Channel split: `module commit` stamps a sandbox, `module promote <change>` moves the live pointer, `module withdraw <change>` clears a sandbox. Local; proven by the existing harness.
2. The sandbox door: the worker route, the `package` field in `/site.json`, and the boot that takes its package from the door. Proven locally against `try-<change>.localhost:4291`.
3. The AI review: brood audit over the change's new modules on publish, with a signed report beside the change.
4. Public assessments: signed notes on the change's root signature, shown on the sandbox door.

## As built (2026-09-22)

- **Words** (`assistant/module.queen.ts`): `module commit [<change>] [@<host>]` commits what runs here, uploads the WHOLE package (the host skips what it holds — a HEAD per file), and stamps `install:try-<change>` only; `module promote <change> [<channel>]` moves the live channel (default `essentials`) to the sandbox's root with no upload; `module withdraw <change>` removes the sandbox key (`hive-pointer.ts` `clearHiveRoot`). All three are refused to a model. The toast names the door.
- **The door** (worker `serveSandbox`): `try-<label>.<zone>` answers `/content/<sign('host:packages')>/` with one member naming the approved publisher's `install:try-<label>` root, serves the package's files from the heap, describes itself at `/site.json` (`sandbox, package, pubkey, channel`), and proxies everything else to the participant shell (`SANDBOX_SHELL_ORIGIN`). No stamp → "nothing here".
- **The boot** (web `ensure-install.ts` `sandboxDoor`): on a `try-` origin the cold boot takes its package from the door alone — never another host, so a sandbox can never silently run the live package.
- **Loopback**: any `*.localhost` is loopback in the runtime, the upload and the signed index, so a door is proven at `try-<change>.localhost:<port>` and writes go to `content.localhost:<port>`, the zone's content face, as in production.
- **Back-to-back writes**: the signed index stamps whole seconds and the host refuses a same-age index as a rollback; every write now names the index it replaces and is stamped at least one second after it (`putHiveManifest` `replaces`).
- **Proof**: `node scripts/local-content-host.mjs 4291 http://localhost:4260` (the real worker code over memory storage; `POST /__bind` stands in for the operator's binding), the web shell on 4260, then `node scripts/verify-hive-publish.cjs` → 26/26. Shared harness pieces: `scripts/hive-harness.cjs`.

## Before it runs on hypercomb.com (jwize's acts)

- Set `SANDBOX_SHELL_ORIGIN` on the worker to the deployed participant shell (hypercomb.io is the natural choice) and deploy the worker.
- A door opens only for a publisher the zone approves (`SITE_BINDINGS` / `SITE_OPERATORS`). Letting the community open doors means granting keys, or a separate rule for `try-` names — a decision, not a detail.

## The communal build (thought through, not built)

jwize: "think of all the bug fixes your community can make … come up with the best build for everybody or for yourself, each person personalized to their own needs"; "publishing something and then people replicate it and start their own trials and errors … you get to see a communal build, and then maybe use some AI or some discussion to decide which directions to focus on"; "each person can just go to each domain if they're working together and see the differences one at a time."

Almost every piece is a primitive the hive already has; the missing ones are discovery, a diff view, and folding someone else's change into a commit.

| Piece | Built from | State |
|---|---|---|
| **A trial** — anyone opens a door, drafts on top, commits their own `try-` | the sandbox paradigm | built (doors need the key to be approved on the zone) |
| **Finding the trials** — every open `try-` door on a zone, whose, when | the worker already lists doors (`/publications.json`, the ledger); a `try-` listing is the same read over `install:try-*` keys | missing |
| **One difference at a time** — what a sandbox changes against the live root | `movedPaths` / `changedBeneath` (runtime) name the paths; `module-sections` names the source files inside a module | missing: the door's "what changed" panel |
| **Your own build** — take one community change at one path, leave the rest | picks (`pick`, `revisionsOf` over any roots) — a sandbox root is just another root | exists; missing: feeding sandbox roots into `revisionsOf` |
| **A build for everybody** — fold several people's changes into one root | `commitSelection` folds drafts; a picked revision stays a pick | missing: folding picks (their namespace bundles come with them — `composeDependencies` exists) |
| **Two changes to one path** | one layer per path: they cannot both be picked | a model writes the merge as a new draft of the section, judged by Jev like any write |
| **Deciding directions** | adoption (who took which change), the host's AI review (brood audit + Jev score), signed notes from people | missing: publishing adoption as a signed mark; an AI pass that reads every open trial with those signals and proposes where to focus |

The order that pays off first: the trial listing and the "what changed" panel (people can already walk the doors one at a time), then sandbox roots offered as revisions (personal builds from community changes), then folding picks into a commit (the communal build), then the AI direction pass.
