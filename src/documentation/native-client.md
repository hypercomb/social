# The native client (Windows, macOS and Linux)

`src/hypercomb-client` is one Tauri 2 project that builds a native window on
the hive for Windows, macOS and Linux. There is no per-platform fork, and there
should not be one.

## Why one project

The three Rust crates — `protocol`, `store`, `host` — contain no
platform-specific code at all. That is not a coincidence to be preserved by
vigilance; it falls out of two decisions:

- **The store is redb.** The hive is ONE database file. Names — pool keys, bag
  markers, member names — are keys in a B-tree, never paths on disk. This is
  what makes the port boring, and it is worth stating explicitly because the
  alternative is not: a filesystem-backed store would have to contend with
  APFS being case-insensitive by default (two pool keys differing only in case
  would collide) and with HFS+ normalizing filenames to NFD (a user-chosen
  name would not read back byte-identical). Neither is reachable here. The OS
  never sees a name.
- **The renderer gets an allowlist, not a path.** No command accepts a
  filesystem path from page script, so there is no path handling to make
  portable. `restore` and `export` take paths, and those come only from a
  native dialog.

A second project would fork all three crates — three copies of the thing the
conformance vectors are the contract for. Don't.

## The native shell is its own update authority

On the web, installs are **push-only**: DCP pushes, the participant clicks
"Upgrade Hypercomb", and boot never decides. The native client deliberately
skips DCP (the sentinel handshake does not know `tauri.localhost`), so on the
desktop there is no pusher — and the bundled package is not a fallback there,
it is *the version of the application you installed*.

So `ensureInstall` compares the shipped `/content/manifest.json` package
signature against the installed one and, on native only, adopts the shipped
package and reloads once. Without it a hive keeps the bees from its FIRST
launch forever: every later binary ships content that is never adopted, and
each new feature reads as "broken on Windows" while working fine on the web.
That is not hypothetical — measured on the real hive on 2026-08-03, the app
shipped package `5d001713…` while the store still ran `e89773f1…`, several
builds behind, which is why the Living Brief (and the website view before it)
appeared to do nothing there.

The comparison is a local asset read and the adopt happens at most once per
installed version, so the ordinary launch pays nothing.

## Backing up the hive

`Hive ▸ Back Up Hive…` picks a folder and writes the whole store into it in the
interchange form — flat sig-named content at the root, lineage sigbags and
pools of meaning as sig-named directories. It is the same layout the web shell
keeps in OPFS, so a folder written here restores there and the other way round.

**Backup is the full-store `export`, not `export_root`.** The two are easy to
confuse, and were confused: the menu ran the root closure until 2026-08-20.
`export_root` is the *drain* — it walks one root BY NAME, follows children
through their layers, and deliberately leaves every pool behind. That is right
for handing a branch to someone else and wrong for the only question a backup
answers. A closure backup came back without threads, clipboard, hidden marks,
collections and the behaviour roster, and without any root the walk could not
reach by name.

### It verifies itself

An export can only report what it believed it wrote. `verify` reads the
DESTINATION back: every signature the store holds must be present, each of
those files must still hash to its own name, and every marker and pool member
must be there byte for byte. Content is hashed **from disk**, so the expensive
half — pulling every blob back out of redb — is never paid. The cost is one
pass over the folder, spent at the end of a backup rather than at the start of
a recovery.

The dialog says which it was, and `VERIFY FAILED` names what is missing.

### Damage is refused, never imported

`restore` re-signs every content file and compares the result to the filename.
This is the only place that check ever happens, and without it a truncated file
lands under a *different* signature: the content the hive asks for stays
missing, the restore counts it as imported, and the damage surfaces months
later as a tile with no picture and no explanation. Mismatches are counted as
`content_corrupt` and reported.

Every write in the interchange module lands in a `.hcpart` sibling and is then
renamed, so a file present under its real name is a file that was written
whole. Markers and pool members carry no self-check, and this is what protects
them.

### It happens without being asked

The chosen folder is remembered in `<hive dir>/backup-target.txt` — beside the
store, never inside it, so it survives restoring someone else's backup and each
named instance keeps its own. Every launch tops that folder up on a background
thread and refreshes `hypercomb-backup.json`: what the folder is, when it was
last written, and what last verified. `Hive ▸ Back Up Again` runs it on demand
with no picker; `Forget Backup Folder` stops it.

Because export never deletes and never overwrites a marker, the folder is a
growing archive rather than a rolling window — content that leaves the hive
stays in it.

### The rules the menu enforces

| Rule | Why |
|---|---|
| One transfer at a time | Two exports would write the same temp paths and each report half a truth; a restore racing an export reads a folder being written underneath it. |
| Never inside the hive | A target under the hive directory would back up its own backup, fill the store's directory with tens of thousands of hex names, and die with the thing it was insurance against. |
| A restore reloads | The running shell holds the pre-restore head in memory and would keep painting it. A restore you cannot see reads as a restore that did not happen. |
| The parent folder is fine | A picked folder with no hive in it, holding exactly one subfolder that has one, restores from that subfolder. Two candidates restore nothing rather than guess which hive was meant. |

## Serving the hive

**Hive ▸ Serve This Hive** turns this machine into a host: other people's
browsers open it, and other nodes replicate from it. It binds every interface on
the first free port in 4270–4279 and reports the address; **Stop Serving** ends
it, and so does quitting.

Nothing is exported first. `hypercomb-serve` (`crates/serve`) answers the host
contract live out of the open store — `/<sig>` is a content read, `/<bagSig>/
00000007` is a marker, `/<poolSig>/<member>` is a pool member — so the hive
being served is the hive as it is, not a copy that was current when someone last
remembered to publish. Full picture:
[hosting-from-a-machine.md](hosting-from-a-machine.md).

Three things about it are deliberate and should stay that way:

- **The renderer cannot reach any of it.** Serving is a native menu action, like
  backup. Page script chooses no port, learns no address, and cannot turn the
  host on. Adopted content runs in that renderer.
- **The store is not opened twice.** redb is single-writer and the app holds it
  open, so the host reads through the `Host` already in app state (an
  `AppHandle`, which is `Send + Sync + 'static`; a `State` guard could never
  be). Never open a second store for serving — including from the headless
  binary, which must be pointed at a hive nothing else has open.
- **The shell is the shim, not this app's frontend.** They are different
  artifacts for different readers: `app/frontend` is the Angular shell THIS
  window shows, baked for its webview with a static import map and no `/pin`.
  `app/host-shell` is what a stranger's browser boots, and only a shim build
  mints the `/pin` → bootstrap-bundle pair the contract requires. Stage it with
  `node scripts/stage-host-shell.mjs` after `npm run build:shim`; all three CI
  workflows do it before bundling.

There is no write path, on purpose. A host publishes; it does not accept.

## Nothing in the shell may navigate the document

A native window has no address bar. Three behaviours were measured in
WebView2 (2026-08-03) and together they make the ordinary web idioms unusable
inside a view or a mounted site page:

| Idiom | What it does natively |
|---|---|
| `<a href="https://…">` | navigates the WHOLE webview off `tauri.localhost` — the app is gone until relaunch |
| `target="_blank"` / `window.open` | returns `null`, does nothing at all — external links are silently dead |
| `<a href="#section">` | writes `location.hash`, which this shell reads back as a tile SELECTION (`Navigation.getSelections`) and then carries through every later navigation |

The policy lives in
`hypercomb-essentials/.../presentation/tiles/document-view-links.ts` and every
document view and the site view route their anchors through it: in-page jumps
scroll, internal links move reading position or lineage **in place**, and
external links go to the OS through the `open_external` command in `main.rs`
(scheme allowlist, no shell interpreter, URL passed as a single argument).

A view is an overlay inside the running shell. Reloading it is not navigation,
it is a reboot — drones unload, the store re-opens, every bee re-instantiates.

## What differs per platform

| | Windows | macOS | Linux |
|---|---|---|---|
| Bundle | `msi`, `nsis` | `app`, `dmg` | `deb`, `appimage` |
| Config | `app/tauri.windows.conf.json` | `app/tauri.macos.conf.json` | `app/tauri.linux.conf.json` |
| Icon | `icons/icon.ico` | `icons/icon.icns` | the PNG set |
| Webview | WebView2 (Chromium) | WKWebView (WebKit) | WebKitGTK 4.1 |
| Hive lives at | `%APPDATA%\io.hypercomb.client\hive` | `~/Library/Application Support/io.hypercomb.client/hive` | `~/.local/share/io.hypercomb.client/hive` |

Linux is the platform that matters for HOSTING — see *Serving the hive* above —
so its workflow also builds and ships `hypercomb-serve`, the headless host, as
a separate artifact. The webview there is versioned in the distro rather than
shipped with the OS: Tauri 2 targets WebKitGTK **4.1**, which is what Ubuntu
24.04 carries. A 4.0 image fails at link time, which is the good failure; the
bad one is a mismatched libsoup that only shows up as a blank window.

Tauri merges `tauri.<platform>.conf.json` over `tauri.conf.json` automatically
for whichever target is being built. No flag selects it. Everything common —
identity, CSP, product name, the icon list — is declared once in the base.

### The one branch in the source

`main.rs` diverges in exactly one place: the menu.

On macOS the menu bar belongs to the APPLICATION, not the window, and the
standard submenus carry key equivalents the system does not otherwise supply.
Building a menu from scratch there would remove Cmd+Q along with the whole
Edit menu — and the Edit menu is what makes Cmd+C/V/X/A work inside a
WKWebView. A hive that cannot copy text is the result. So macOS starts from
`Menu::default` and appends the Hive submenu; Windows keeps the single Hive
menu it always had.

That branch uses runtime `cfg!(target_os = "macos")`, deliberately, not a
`#[cfg]` attribute. `cfg!` keeps BOTH arms visible to the compiler on every
platform, so a `cargo check` on Windows type-checks the macOS path. An
attribute would hide it, and the first sign of a mistake would be a red CI
run. Prefer `cfg!` for any future divergence that is not an API that simply
does not exist off-platform.

## Icons

`scripts/make-icons.mjs` generates the whole set from `app/icons/icon.ico`.

The `.ico` is not one image: it holds six frames (16, 32, 48, 64, 128, 256),
each drawn at its native size as uncompressed 32-bit BGRA. So the script
resamples NOTHING — it transcodes each frame to PNG and assembles them into an
`.icns`. The only consequence is a ceiling: 256 is the largest frame, so the
512/1024 Retina slots are empty and macOS upscales for Finder's largest icon
preview and Quick Look. Drop in a 1024x1024 master and the ceiling lifts with
no other change.

Re-run after changing the art; the outputs are committed.

```bash
node hypercomb-client/scripts/make-icons.mjs
```

## Building

The frontend is the web shell, baked. `app/frontend` is gitignored and must be
produced before any bundle:

```bash
npm run build:core
npm run build:essentials
npm --prefix hypercomb-web run runtime
npm run build:web
```

The bake is `hypercomb-web`'s `postbuild`, so **every web build re-bakes the
client frontend** — the native app cannot silently ship a stale shell because
someone forgot a step. It runs as `--if-available`, which skips (with a note,
exit 0) when the dist has no `content/manifest.json`: in that position a
contentless dist means the build was a partial one, not that the bake broke.
Run it by hand — no flag — before a bundle if you want the hard failure:

```bash
node hypercomb-client/scripts/bake-frontend.mjs
```

Then, from `hypercomb-client/`:

```bash
npx @tauri-apps/cli@^2 build --config app/tauri.conf.json
```

`bake-frontend.mjs` exists because a script-injected import map is inert in
WebView2 — see its own header for the measurements. Baking is harmless on any
engine, so it runs for both platforms.

### The baked frontend is a COMPILE-time dependency, not a runtime one

`tauri::generate_context!()` reads `frontendDist` while the proc macro
expands, so **the app crate does not compile until `app/frontend` exists**.
Not "builds but ships empty" — fails outright with `this path doesn't exist`.

This has a nasty property on a developer machine: once you have baked the
frontend even once, it sits there gitignored and every later `cargo` command
works. A clean checkout — that is, CI, or a new machine — hits the wall that
your machine no longer can. It cost one red CI run to learn, from a local test
pass that was only green because of a stale directory.

Practical consequences:

- `cargo test`/`clippy` on the LIBRARY crates needs no frontend, and that is
  where the conformance vectors are. Lint and test them first and separately;
  the workflow does exactly this.
- Anything touching `-p hypercomb-client` must come after a bake.
- If `cargo` suddenly fails on a fresh clone, this is why. Bake, then retry.

## Testing macOS without a Mac

There is no Mac in the development loop. `.github/workflows/build-client-macos.yml`
is the Mac. Treat a red run there exactly as a local build failure.

It runs the conformance and unit tests FIRST, ahead of the long Angular build,
so a genuine macOS divergence in the store reports in a couple of minutes
rather than fifteen. Then it builds the frontend, bundles, and — the part that
matters — **launches the app and waits for Angular's first paint**, read from
the milestone trace the client already writes to `renderer.log`.

That last step is what makes the run meaningful. "It compiled" says almost
nothing here: the crates are shared and already tested. The open question is
whether WKWebView boots the baked frontend, and a blank window passes every
other check in the workflow. Reaching first paint proves the import map
resolved, the dependencies loaded, and the shell rendered.

The smoke test is currently `continue-on-error` — until one green run confirms
the step itself is sound on a runner, a GUI-session quirk should not mask the
artifacts. The job summary states plainly which of the two happened. Once it
has passed, make it a hard gate.

The `.app` and `.dmg` upload as run artifacts. Download and open on a real Mac
when one is available.

## Building Windows in CI

`.github/workflows/build-client-windows.yml` is the Windows twin — and on a
locked-down machine it is the ONLY place the Windows client can be built at
all. Smart App Control, once enforced, refuses to EXECUTE freshly compiled
unsigned binaries, and every cargo build script is exactly that: measured
2026-08-20, `cargo build -p hypercomb-client` died with
`os error 4551 — An Application Control policy has blocked this file` on
tauri-build's own build script, before the bundler was ever reached. Moving the
target directory elsewhere changes nothing; the policy is not path-based.

What still works locally is worth knowing, because it bounds the damage:
`cargo check`, and `cargo test`/`clippy` on the library crates, all pass. Only
things that must RUN a new binary are blocked — the app bundle, and the
`a_commit_survives_process_abort` durability test, which spawns a freshly built
helper.

Check the state before blaming the repo:

```powershell
(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
# 0 = off, 1 = enforced, 2 = evaluation
```

Individual blocks are logged with the offending path under
`Microsoft-Windows-CodeIntegrity/Operational`, event ID 3077 — which is how you
tell "the policy blocked my build" from "the policy blocked something else".

The workflow mirrors the macOS one step for step — library tests and lint
first, then the Angular build, the bake, the bundle, and a
launch-and-wait-for-first-paint smoke test — with three Windows-specific
additions:

- It asserts the **WebView2 runtime** is present before anything else. Without
  it the window comes up blank and every other check still passes.
- It runs the durability test, which on an enforced machine can only run here.
- The smoke test is a **hard gate**, not advisory. It earned that on its second
  run, because its first went green while the log read `no Hypercomb.exe was
  built` — cargo names the binary after the CRATE, and `productName` only
  applies inside the bundle. A smoke test nobody is forced to read reports
  nothing.
- The bundle is **msi + nsis**, selected by `tauri.windows.conf.json`.

### What the workflow watches

The client is built from the **whole monorepo** — `build:core`,
`build:essentials`, `build:shim`, the vendored runtimes, `build:web` — and
that result is baked into the binary. `app/frontend/` is gitignored, so none of
it ever appears in a commit: a path filter that watches only
`src/hypercomb-client/**` sees a client that never changes while the app it
produces changes every day.

That is the mechanism behind the entire "works on the web, broken in the app"
class of report. It is not a webview quirk and it is rarely the feature: the
binary simply predates the feature. Measured once at 248 commits stale.

So the trigger names every package the build actually compiles —
`hypercomb-web`, `hypercomb-shared`, `hypercomb-essentials`,
`hypercomb-core`, `hypercomb-runtime`, `hypercomb-shim` — plus the root
lockfile that pins what they compile against. All three platform workflows carry
the same list; an asymmetric trigger is the same trap wearing a different OS.

The rule for anything added later: **if the bundle would differ, the trigger
must fire.** A new workspace consumed by the shell belongs in that list on the
same commit that introduces it.

## Keeping the installed app current

CI builds it; nothing installs it. Because Smart App Control makes CI the only
builder, every refresh used to be a manual `gh run download` and a click, and
an app nobody remembers to update is an app that silently drifts — which lands
back in exactly the stale-binary failure above, now as a habit rather than a
config bug.

`scripts/client/windows-client.mjs` closes it:

```bash
npm run client:windows          # update to the newest green build, then launch
npm run client:windows:update   # update only
```

It asks `gh` for the newest **successful** `build-client-windows.yml` run on
`development`, compares that run's commit against `installed-build.json` beside
the exe, and if they differ downloads the artifact and runs the NSIS installer
with `/S` — per-user, no elevation. Fetched through `gh` the installer carries
no Mark-of-the-Web, which is what lets an unsigned build install on a machine
with SAC enforced.

Three things it deliberately does:

- **Launching is never blocked by updating.** No `gh`, no network, no artifact,
  a red run — every failure path falls through to starting whatever is already
  installed. An updater that can stop you opening your own hive is worse than a
  stale build.
- **It refuses to install over a running app** and says so, rather than half
  writing an exe that is open.
- **It waits for the exe to change**, not for the installer to exit. NSIS `/S`
  returns before it has finished writing, so the exit code is not the witness.

`install-launcher.ps1` wires it into the shell: a Desktop shortcut that updates
then launches, and a Startup shortcut that updates only, minimised, at logon. By
the time the app is opened the newest build is usually already installed, so the
launch is instant rather than a download; the Desktop half covers the machine
being off when the build landed.

```powershell
powershell -ExecutionPolicy Bypass -File scriptsclientinstall-launcher.ps1
powershell -ExecutionPolicy Bypass -File scriptsclientinstall-launcher.ps1 -Remove
```

Neither shortcut is a system change, and deleting either by hand leaves the
other working.


## Signing, notarization, distribution

The CI build is **unsigned and un-notarized** — no Apple Developer credentials
live in this repo. Gatekeeper will refuse the download on first open. For
testing:

```bash
xattr -dr com.apple.quarantine /Applications/Hypercomb.app
```

The workflow signs and notarizes automatically **if** the credentials are
present, and builds unsigned if they are not. Absent secrets never fail the
run — an unsigned build is still a valid test build; it only changes who can
open it without friction. So the wiring is done and idle; supplying the
secrets is the only remaining step.

### What only you can do

Enrolling and issuing the certificate happen in Apple's portal under your
Apple ID and cannot be automated from here:

1. Enrol in the Apple Developer Program ($99/year).
2. Create a **Developer ID Application** certificate (this is the one for
   distributing outside the App Store — not "Apple Distribution", which is
   App Store only, and not "Development", which only works on registered
   machines). Export it from Keychain Access as a `.p12` with a password.
3. Create an **app-specific password** at appleid.apple.com — notarization
   will not accept your normal Apple ID password.

### Then add these repository secrets

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | the `.p12`, base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | the password you set when exporting it |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password from step 3 |
| `APPLE_TEAM_ID` | your 10-character team ID |

Base64 the certificate with:

```bash
base64 -i certificate.p12 | pbcopy
```

Signing without notarizing is a half-step that looks finished and is not:
other people's Macs still warn. Both halves, or the friction remains.

### Reading the result

The `Inspect the signature` step asks `spctl` — the component Gatekeeper
actually consults — rather than reporting our own intent. Its verdict is the
honest answer to "will this open on someone else's Mac", because a bundle can
be correctly signed and still be refused when the notarization ticket was
never stapled.

### Windows: signing, and why unsigned is worse here

Same shape as the Apple wiring above — signs if the secrets are present,
builds unsigned if they are not — but the mechanism differs. Tauri resolves a
Windows signature by certificate THUMBPRINT against the machine's own
certificate store, so the workflow imports the `.pfx` into
`Cert:\CurrentUser\My` first and passes the resulting thumbprint through
`--config`. Two secrets:

| Secret | What it is |
|---|---|
| `WINDOWS_CERTIFICATE` | the code-signing `.pfx`, base64-encoded |
| `WINDOWS_CERTIFICATE_PASSWORD` | the password it was exported with |

Unexercised: no certificate has ever been configured for this repo, so that
branch has never run. Treat its first green run as the test.

What unsigned costs on Windows deserves precision, because it is worse than
Gatekeeper:

| | Unsigned | OV certificate | EV certificate |
|---|---|---|---|
| SmartScreen | warns; *More info ▸ Run anyway* | warns until the certificate earns download reputation | trusted immediately |
| Smart App Control, enforced | **refuses — no override** | trusted | trusted |

That last cell is the one that matters. Smart App Control has no "run anyway":
the only way past it is turning the feature off, and that is a ONE-WAY DOOR —
it cannot be re-enabled without resetting Windows. So an unsigned build is a
test build for machines that do not enforce it, and nothing more. Handing the
client to anyone else needs a certificate.

## Known gaps

- 512/1024 icon slots are empty — needs a 1024 master (see above).
- The universal (Intel + Apple silicon) build exists as a `workflow_dispatch`
  input but has not been exercised; the default is arm64.
- Unsigned on both platforms, per the sections above. On Windows that is not
  cosmetic: a machine with Smart App Control enforced refuses the build.
- The Windows signing branch of the workflow has never run — no certificate is
  configured.
- Windows builds x64 only; there is no ARM64 target in the workflow.
- No macOS-native window chrome work has been done — the window is the same
  1280x800 dark-themed window as on Windows.
- The Linux workflow has never run. The serving crate's own tests and the host
  conformance check pass locally on Windows; the .deb, the AppImage and the
  Xvfb smoke test are unexercised until its first green run.
- Serving speaks plain HTTP and holds no certificate. Reaching a host from the
  internet is a port forward, a tunnel or a reverse proxy — the app does not
  try to arrange one, and there is no UPnP or hole-punching anywhere in it.
