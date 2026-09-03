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
