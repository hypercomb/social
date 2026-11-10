# The email pages — email.hypercomb.com

**Status 2026-11-09.** Built in jwize's hive as the creation `/email`, not yet published. jwize: *"create a
website for this … publish it as you like settings.email.hypercomb.com or whatever you like just remember we
mirror that in the hive so we can work on it on the subdomain."*

The pages are a creation in the hive: a tile at `/email` with one child per page, published to the door
`email.hypercomb.com`. They are made and kept through the hive like any creation
(`website-artifact-paradigm.md`), never as files in the shell, and they follow the hosting pages' standard
word for word (`hosting-pages.md`: one shape, one voice, one look, one test, one truth). Every *Done when*
line quotes what the mail desk really says (the `mail.*` keys in `hypercomb-shared/i18n/en.json`), and every
control a step names exists in the desk today.

## Why email.hypercomb.com

`*.hypercomb.com/*` already routes to the Worker that serves published hive creations, and a one-level name
resolves to the top-level lineage of that name, so the creation `/email` opens at `email.hypercomb.com` with no
DNS record and no deploy. `settings.email.hypercomb.com` was the first idea; a two-level name is not covered by
the zone's universal certificate, and it would need a nested lineage the Worker does not resolve today.

## The shape

```
/email                       Mail in your hive                 email.hypercomb.com
  /email/get-an-address      Get an address                    free, 5 minutes
  /email/give-addresses      Give addresses from your hive     free, 10 minutes
  /email/run-a-host          Run mail on your domain           paid (Workers Paid), 60 minutes
  /email/what-the-host-sees  What your host sees               read
```

The main page carries one card per walkthrough, quickest first, a callout (the host keeps your mail sealed and
never holds the key), a short *How it works*, and a last line that sends a newcomer to *Get an address* and
anyone cautious to *What your host sees*. Every page ends in the same five-cell mesh. *Run mail on your domain*
is a terminal page, the one exception the standard allows, because its reader chose a terminal; its steps
start a new host from `ADMIN_KEYS` alone, so every address is then given from the hive. *Give addresses from
your hive* is for an operator who already runs a host with the `MAIL_CONFIG` secret, as hypercomb.com does.

## Working on it

The copy lives in the hive: each tile's notes are its page, one part per note, in the note grammar
`scripts/bridge/_hosting-site/generate.cjs` documents. `scripts/bridge/_email-site/notes.json` is only the
first draft the notes grew from. To change a page, change its note in the hive (`unfile` + `file`), then run,
from `src/`, in PowerShell:

```powershell
node scripts/bridge/_hosting-site/generate.cjs --root /email --dry
node scripts/bridge/_hosting-site/generate.cjs --root /email
```

In Git Bash, put `MSYS_NO_PATHCONV=1 ` in front of each, or Git Bash rewrites `/email` into a Windows path.
PowerShell has no such rewrite and refuses the prefix. With nothing changed in the notes, the run says every tile
already wears this build and changes nothing.

The generator dresses each changed tile with its page (`website page`), keeps `/email` opening as a website,
and records the pass as one restorable step (`builds email-pages-<sig>`). Then publish again, which the
participant types in the hive (a session's `publish` is refused: every form but `publish history` is the
participant's):

```
/publish /email on hypercomb.com
```

The first publish asks for consent in the hive; press **Allow**. To work on the published site from another
machine, replicate it from the host and edit it there in its own domain, then publish from that hive.

`scripts/bridge/_email-site/seed.cjs` planted the draft (it makes missing tiles and files missing notes, and
stops when the hive has moved on unless `--replace` says the draft is newer). To look at the pages before they
are said into the hive, render them from the draft and screenshot them:

```bash
MSYS_NO_PATHCONV=1 node scripts/bridge/_hosting-site/generate.cjs --root /email --notes scripts/bridge/_email-site/notes.json --build-only --out <dir>
node scripts/bridge/_didyouknow-site/shoot.cjs <dir>/pages --out <shots>
```

Outside the hive the pages lack the house theme's colour tokens, so those pictures show the layout and the
words, not the look.

## Built

- 2026-11-09: five tiles, 65 notes, planted by `seed.cjs`; pages said by the generator, `/email` opens as a
  website, build `email-pages-0b517aa348b6` recorded. The pages built from the hive's notes carry the same
  signatures as the ones rendered from the draft, so the notes round-tripped exactly.

## Owed

- The publish (`/publish /email on hypercomb.com`, then **Allow**), which is jwize's.
- The mail desk shows a device's key only while that device owns no mailbox. An operator who already reads mail
  finds their key in the host's configuration instead; a desk control that always shows the key would make
  *Give addresses from your hive* step 1 one line.
