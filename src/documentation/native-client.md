# The native client (Windows and macOS)

`src/hypercomb-client` is one Tauri 2 project that builds a native window on
the hive for both Windows and macOS. There is no per-platform fork, and there
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

## What differs per platform

| | Windows | macOS |
|---|---|---|
| Bundle | `msi`, `nsis` | `app`, `dmg` |
| Config | `app/tauri.windows.conf.json` | `app/tauri.macos.conf.json` |
| Icon | `icons/icon.ico` | `icons/icon.icns` |
| Webview | WebView2 (Chromium) | WKWebView (WebKit) |
| Hive lives at | `%APPDATA%\io.hypercomb.client\hive` | `~/Library/Application Support/io.hypercomb.client/hive` |

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

## Known gaps

- 512/1024 icon slots are empty — needs a 1024 master (see above).
- The universal (Intel + Apple silicon) build exists as a `workflow_dispatch`
  input but has not been exercised; the default is arm64.
- Unsigned, per the section above.
- No macOS-native window chrome work has been done — the window is the same
  1280x800 dark-themed window as on Windows.
