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
3. **Announce** — `stamp-install-channel.ts <name> --require` advances the signed
   `install:<name>` root through the authoring browser. Followers of that name
   are told; nobody else is.

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
