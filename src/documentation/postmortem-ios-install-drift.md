# Postmortem — iOS playground: blank render → crash-loop (OPFS install ↔ `/content/` drift)

**Date:** 2026-06-15
**Surface:** `playground.hypercomb.io` on iOS Safari (iPhone)
**Severity:** High — app unusable on the device (blank, then repeated WebKit crash)
**Resolution commit:** `64e3fd2e` ("Fix for tiles not showing up on mobile") on `playground-dylan`
**Status:** Resolved. Tile creation/render confirmed working on device.

---

## TL;DR

The device's **OPFS module install** and the web shell's deployed **`/content/`**
are two independently-versioned copies of the essentials build. On iOS the loader
fetches installed module signatures from `/content/`, so when the two drift apart
(which happens on every deploy that rebuilds essentials), **every changed signature
404s** and the canvas never renders. Boot was **push-only** — it never reconciled
the drift — so a device could stay stuck on a stale install indefinitely.

A well-intentioned change (`3cb52d72`, an `/opfs/` import fallback) turned the
**blank** state into a **crash-loop**: the fallback successfully loaded a *stale*
module from OPFS — specifically an **old, un-DPR-capped Pixi host** — which then
initialized WebGL at `devicePixelRatio = 3` and blew past the iOS GPU process memory
limit ("A problem repeatedly occurred").

The durable fix restores **boot-time staleness detection**: if the deployed
`/content/` build differs from what's installed, the device reinstalls from
`/content/` and reloads, so the install always matches the served build.

---

## Background — the moving parts

Essentials (drones/bees, deps) are **signature-addressed**: each module is a file
named by the SHA-256 of its bytes. Two independent distribution channels exist:

1. **The web shell's `/content/`** — static files (`__bees__/<sig>.js`,
   `__dependencies__/<sig>.js`, `__layers__/`, `manifest.json`) shipped by the
   Angular app build and served over HTTP/CDN. Rebuilt by CI on **every deploy**.
2. **The device's OPFS install** — the bytes actually written into the browser's
   Origin-Private File System, sourced from DCP (sentinel) or the bundled
   `/content/`. Recorded in `localStorage` (`core-adapter.installed-manifest`).

How modules load at runtime (`hypercomb-shared/core/store.ts`):
- **Desktop:** imports the bee from the verified OPFS buffer via a blob URL +
  runtime import map. Reads the *installed* bytes directly. Drift-tolerant.
- **iOS Safari:** blob modules have an opaque origin and can't see the page import
  map, so the bee is imported from its **same-origin static URL**
  `/content/__bees__/<sig>.js`. This fetches from the **web `/content/`**, *not*
  from the device's OPFS install. **This is the crux:** on iOS, the loader asks
  `/content/` for the signatures listed in the *install*. If those two are different
  builds, the sig isn't there → **404**.

Boot path (`hypercomb-web/src/setup/ensure-install.ts`, `ensureInstall`):
- Was **push-only**: if a content-complete install exists in OPFS, boot it as-is.
  No `/content/manifest.json` fetch, no staleness comparison. A helper that compared
  the two (`bundledDiffersFromCached`) existed but had **zero call sites** — dead
  code left from when staleness detection was removed.

Pixi host (`hypercomb-essentials/.../presentation/tiles/pixi-host.worker.ts`):
- The mobile-transfer work (Jun 12) added a crash guard: cap DPR at 1.5 on mobile,
  `antialias: dpr < 2`, `powerPreference: 'low-power'`, `ticker.maxFPS = 30`, pause
  on tab-hide. It logs `[pixi-host] mobile-perf-guard dpr=1.5 …` as a confirmation
  marker. This guard exists only in the **new** Pixi-host signature (`e685307a…`),
  **not** in the older one (`737e5e4e…`, `Application.init` at line 109, no marker).

---

## Symptoms

- **First:** app loads the shell but the hex canvas is blank; tiles don't render.
  Console shows mass `404` on `/content/__bees__|__dependencies__/<sig>.js` and the
  critical-wave line reporting `PixiHostWorker`/`ShowCellDrone` as `(null)`.
- **After `3cb52d72`:** loads the shell, flashes once or twice, then the WebKit
  content process dies and Safari shows **"A problem repeatedly occurred."**

Note: **tile *saves* always worked** — the swarm publish log shows new tiles
committed to the layer. Both failure modes were purely on the **render** side.

---

## Root cause

Two coupled problems:

### 1. Install ↔ `/content/` drift (the blank)
The device's OPFS install was a *different essentials build* than the deployed
`/content/`. On iOS the loader fetches the install's signatures from `/content/`,
so every signature that changed between the two builds 404'd. Critical render bees
(`presentation/grid`, `editor`, `ShowCellDrone`, `PixiHostWorker`) failed to load →
null → blank canvas. Push-only boot never reconciled it, and the user's "Clear
Website Data" did **not** wipe OPFS (every boot still logged
`signature store restored: 122 trusted sigs`), so the stale install persisted.

### 2. A stale, crashing module in OPFS (the crash)
Sitting in that stale OPFS install was the **old Pixi host `737e5e4e`** — the
pre-mobile-transfer version *without* the DPR cap. It initializes WebGL at
`devicePixelRatio` (up to 3 on iPhone Pro → a ~3M-pixel framebuffer), which exceeds
the iOS GPU process memory budget and crashes WebKit.

### How `3cb52d72` turned blank into crash
`3cb52d72` added an `/opfs/` fallback to the iOS loader: when `/content/<sig>.js`
404'd, it retried `/opfs/<sig>.js` (served from OPFS by the service worker,
`hypercomb-web/public/hypercomb.worker.js`). That fallback **successfully loaded the
stale `737e5e4e` host from OPFS**, so Pixi actually initialized at DPR=3 → OOM →
crash-loop.

- **Before** the fallback: `737e5e4e` 404'd → returned `null` → Pixi never inited →
  blank, but no crash.
- **After** the fallback: `737e5e4e` loaded from OPFS → Pixi inited at DPR=3 → crash.

The commit also deployed the `development` merge to `/content/` for the first time
(the merge's own deploy had failed on a build error), compounding the drift. But the
crash specifically traces to the fallback executing the stale un-capped host —
confirmed by `Application.init` logging from **line 109** (old host) with **no**
`mobile-perf-guard` marker.

---

## Resolution

1. **Immediate:** rolled `playground-dylan` back to the last working pre-merge build
   `5981293c` (`git reset --hard` + force-push). This removed the `/opfs/` fallback
   and put `/content/` back on a DPR-capped build → crash stopped (back to blank).
2. **Durable (`64e3fd2e`):** re-wired the dead staleness detector in
   `ensureInstall` (`ensure-install.ts`). In the cached-boot success path, before
   "booting from cached state":
   - `fetchBundledPackage()` → fetch `/content/manifest.json`.
   - `bundledDiffersFromCached(bundled, cachedManifest)` → compare to the install.
   - If different → `upgradeFromBundled()` (purge stale OPFS + reinstall from
     `/content/`) → `location.reload()`.

   The web shell is served fresh over HTTP each load, so it ships this logic to the
   device immediately. On next load the device detects its install drifted from
   `/content/`, reinstalls the deployed (DPR-capped) build, and reloads — rendering,
   no crash. **Self-heals every device after every deploy, with no manual clears.**

### Why it doesn't loop
After `upgradeFromBundled()` writes the new manifest, the install equals
`/content/`; the next boot's `bundledDiffersFromCached` returns false → normal
cached boot. No reload loop.

---

## Why this was hard to see

- **Tiles saved fine**, so it looked like a save bug, not a render/loading bug.
- **Two distribution channels** (OPFS install vs web `/content/`) that are
  *supposed* to be the same build but silently drift.
- The crash was a **native WebKit process kill**, not a JS error — it leaves no
  stack, and the console log just stops.
- The fix for the *blank* (`/opfs/` fallback) **exposed** the latent *crash*, making
  the band-aid look like the cause.
- "Clear Website Data" did not actually wipe OPFS, so manual recovery attempts
  failed and masked the real state (`122 trusted sigs` persisted across clears).

---

## Lessons & action items

1. **Install must track the served build.** Two independently-versioned copies of
   the same modules will drift. Boot-time staleness detection (now restored) is the
   reconciliation point — don't remove it again without a replacement.
2. **Never blind-deploy straight to the only test device.** The `playground-dylan`
   push auto-deploys to the live playground; a bad build reaches the phone with no
   gate. Validate on a preview/throwaway, or keep deploys on known-good builds.
3. **Signature-addressed loading on iOS must read from where modules are
   *installed*, not from a parallel channel** (`/content/`). The current fix keeps
   install == `/content/`; if that invariant is ever broken (e.g. DCP pushes a build
   the web shell doesn't serve), iOS will 404 again.
4. **A fallback that "rescues" a failed load can resurrect stale/broken code.**
   The `/opfs/` fallback was reverted for this reason; prefer keeping the install in
   sync over papering over a mismatch at load time.
5. **Keep the `mobile-perf-guard` marker** (and similar "is the new code actually
   running?" log lines) until mobile boot is confirmed stable — it was the single
   most diagnostic signal here.

---

## Open follow-ups (not covered by this fix)

- **`development` merge on iOS:** the merge is still off `playground-dylan` (on
  `origin/development`). Before re-introducing it, verify it doesn't have a *separate*
  iOS crash beyond the old-host DPR issue — test on a preview with the device
  confirmed on the new DPR-capped host.
- **`bundledDiffersFromCached` compares bees only** (length + membership), not deps
  or layers. Covers the common case (essentials rebuilds change bee sigs) but could
  miss a deps-only drift; consider widening if that case appears.
- **OPFS not clearing via Safari "Clear Website Data"** — understand why, since it
  defeats manual recovery. The auto-resync makes manual clears unnecessary, but the
  behavior is worth confirming.
- **UI issues still outstanding:** mic button opens the command line (#3), camera
  buttons show letters + double-tap to shoot (#4). Tracked separately.
