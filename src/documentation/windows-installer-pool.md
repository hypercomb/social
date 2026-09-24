# The Windows installer is a pool of meaning

The desktop setup is not a release asset, and it is not a file at a URL two
parties agreed on. It is bytes named by their own signature, and discovery is a
pool: `sign('hypercomb:windows')`. Any host that holds the pool offers the
installer, and a download is trusted for what it is, never for where it came
from.

## The shape

```
<content>/<partSig>                              each part, byte-for-byte
<content>/<recordSig>                            the record (below)
<content>/<sign('hypercomb:windows')>/00000000   `<recordSig>\n<name>`
<content>/<sign('hypercomb:windows')>/index.html the listing, for a static host
```

- **Broken apart.** The setup is split into parts of at most 16 MiB, below the
  25 MiB per-file cap of a static host such as Cloudflare Pages, so every host
  shape can carry every piece. Each part is a sig-named file that stands alone.
- **The record** is the one small artifact that says how the parts compose:

  ```json
  { "kind": "hypercomb:windows@1", "file": "Hypercomb_0.1.0_x64-setup.exe",
    "size": 67005746, "sig": "<sha256 of the whole setup>",
    "parts": ["<partSig>", "…"], "commit": "<git sha>", "run": 36050165880 }
  ```

  `sig` is the signature of the reassembled file, so the download checks
  itself end to end, not only piece by piece.
- **The pool** is the same shape as `host:packages`
  ([publishing-a-revision.md](publishing-a-revision.md)): one member per build
  at an 8-digit index, `<recordSig>\n<name>`. The MAX INDEX IS THE HEAD, the
  member file's date IS the release date, and the pool only grows. The name is
  the line the build belongs to (`development` by default).
- **The meaning carries a colon**, so no tile location can ever mint the same
  address. `hypercomb:macos` and `hypercomb:linux` follow the same shape.

## Publishing a build

```bash
node scripts/client/publish-windows-installer.mjs              # newest green development build
node scripts/client/publish-windows-installer.mjs --run=<id>   # one CI run
node scripts/client/publish-windows-installer.mjs --file=<setup.exe> --commit=<sha>
node scripts/client/publish-windows-installer.mjs --dry
```

The script fetches the CI artifact with `gh` (CI builds; it never publishes),
breaks the setup apart, and writes into this machine's additive host,
`hypercomb-relay/content` (or `HYPERCOMB_RELAY_CONTENT_DIR`). Every write is
skip-if-exists, and publishing the head again appends nothing. A file that is
not a Windows executable is refused: whatever is at the head is offered to
every visitor as the Windows app.

## Reading it

A host lists the pool at `/<sign('hypercomb:windows')>/`: the relay answers
from `readdir` because the meaning is in `PUBLIC_POOL_MEANINGS`
(`hypercomb-relay/replicate.js`), and a static host serves the `index.html` the
publish wrote. The downloads page (`documentation/hypercomb.com`) names the
meaning and its hosts on the Windows row (`data-installer-pool`,
`data-installer-hosts`), reads the head, verifies the record, and on click
fetches each part, checks it against its signature, reassembles the file,
checks the whole, and only then saves it. With no pool to read, or one byte
that fails, the row stays exactly as the page wrote it.

## What the pool does not solve

The setup is not code-signed. SmartScreen warns (*More info ▸ Run anyway*), and
a machine with Smart App Control enforced refuses a browser-saved unsigned
setup outright. The pool fixes where the installer lives and how it is found;
signing ([microsoft-store-submission.md](microsoft-store-submission.md)) is
what lets a stranger run it.
