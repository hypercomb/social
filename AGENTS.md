# Repository agent doctrine

## Scratch workspaces and generated files (mandatory)

Disposable output must not be created in normal source paths.

- Use a unique directory under the operating system's temporary directory by default. This includes test runs, extracted checkouts, audits, browser profiles, bundle analysis, build mirrors, and dependency installs.
- If a tool requires a repository-local path, use only `/.tmp/<tool>-<unique-id>/` at the repository root. The directory is disposable and must never be committed.
- Before creating any other generated path, add a narrow rule to the nearest checked-in `.gitignore` in the same change, then prove the destination is ignored with `git check-ignore -q -- <path>` **before** writing files. `.git/info/exclude` and global Git excludes do not count because they do not protect other clones.
- The hidden `.tmp-*`, `.scratch-*`, `.audit-*`, `.bundle-*`, and `.test-tmp-*` namespaces are reserved for disposable workspaces. They must never contain source-of-truth files.
- Never install dependencies or copy a checkout into an ad-hoc directory inside a package. Heavy scratch work belongs in the OS temporary directory.
- Tests and scripts must clean up their own temporary directories in a `finally`/equivalent cleanup path. Before handoff, run `git status --short --untracked-files=all` and remove only residue created by the current task; never delete unfamiliar files.
- `test-results/` is not a generic scratch directory. This repository intentionally tracks some test evidence there, so use it only when the output is meant to be reviewed and committed.

Commit the ignore rule, not the generated files.

## All code is atomic beehaviors on tiles (mandatory)

Adopted by the repository owner on 2026-09-26.

- All code lives in beehaviors (drones, queens, workers), and all code is atomic:
  one signed atom per beehavior or dependency, addressed by its signature.
- Beehaviors belong to tiles. Every running beehavior is carried by a tile in the
  hive, so the hive shows what is running, and any hive resource can be opened to
  see its code in place.
- The only code outside a tile is what runs tiles: the install's kernel and the
  core processor (`hypercomb-core/src/processor.ts`). Keep both to a couple of pages.
- New features are new beehaviors on tiles. Do not add code to a shell, host bundle,
  or core library; when you touch code that lives there, prefer moving it out into
  an atomic beehavior. Data (word lists, catalogs, locales) belongs in pools of
  meaning, not in code.
- Signatures are hashed once, when bytes first arrive on the device. A held copy is
  never hashed again.

The migration plan and its progress live in
`src/documentation/everything-is-a-beehavior.md`.

## Protected `development` branch (mandatory)

`development` is maintained directly by the repository owner only. Agents must
work on a dedicated task branch and may commit and push only that branch; they
must never commit, merge, rebase, or push directly to `development`.

The shared pre-push hook rejects any direct update of `development`. Do not
disable, edit around, or bypass that hook, including by setting
`HYPERCOMB_ALLOW_DIRECT_DEVELOPMENT_PUSH`. Only the repository owner may use
that explicit, one-command override when intentionally publishing
`development`.
