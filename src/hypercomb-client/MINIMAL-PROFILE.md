# Pure native host proof

The `app/tauri.minimal.conf.json` profile opens the framework-free
`hypercomb-shim` as the native app's renderer. Its Store uses the existing Tauri
`nativeRoot` facade, so the on/off location bag and signed bytes land in the
same hive that **Hive > Serve This Hive** reads. The ordinary Tauri config still
opens the Angular frontend.

From `hypercomb-client/app`, run the pure profile:

```powershell
npm exec --yes --package=@tauri-apps/cli@2 -- tauri dev --config tauri.minimal.conf.json
```

Build a desktop installer with the same profile on each target operating system:

```powershell
npm exec --yes --package=@tauri-apps/cli@2 -- tauri build --config tauri.minimal.conf.json
```

Both commands build and check the pure host first. The window embeds that
build, and the installer bundles the **same directory** as its `host-shell`
resource. No staging copy or application package enters the minimal profile.
The resulting bundle is under Cargo's target directory; set `CARGO_TARGET_DIR`
to an operating-system temporary directory for a disposable local build.
The build-only [Minimal Host workflow](../../.github/workflows/build-minimal-host.yml)
produces installers for Windows x64, macOS Intel and Apple silicon, and Linux
x64 and ARM64. It also attaches headless host binaries, the npm tarball, and a
static server payload. It does not publish an application revision or update a
hive.

In the pure window, turn on an offered creation and note its proposed local
hostname, such as `tile-jwize-com.localhost`. Use **Hive > Serve This Hive** in
the native menu; the menu reports the actual port (4270–4279). From
`hypercomb-client/`, check the live location bag and host route, substituting
that port and hostname:

```powershell
node scripts/check-minimal-native.mjs http://127.0.0.1:4270 tile-jwize-com.localhost on
```

Turn the same creation off in the pure window and repeat with `off`. The check
requires the latest marker to name the off layer, `/site.json` to return 404,
and the previously selected root bytes to remain available by signature.

This proves that the pure renderer and native HTTP host share one hive. A
separate browser visiting the native host still has its own OPFS. This profile
enables `minimal-deep-link`, so a remote visitor can return an offering
for review through `hypercomb://offering/`. Native code validates its URL and
places it in memory for the pure window to show. The local window must verify
the signed offering and require its own click before writing an activation
layer. The public host remains GET/HEAD-only.

The deep-link feature uses Tauri's single-instance plugin. For this proof it
targets the default native instance; it does not route a link among separately
named `--instance` hives. The ordinary Angular profile remains available
without this optional feature.
