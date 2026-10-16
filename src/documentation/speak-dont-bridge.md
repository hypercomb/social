# Speak, don't bridge

jwize, 2026-10-15: *"we should really retire the bridge and fix the dialect
whenever we reach for the bridge"*, and *"just make it possible to do
everything by behavior. that makes the architecture pure."*

A session changes the hive the way a participant does: by saying a sentence
on the hive's own command line. The words it says are the words a person can
repeat and remember, they run under the same admission rules, and a gap in
what can be said shows up as a gap in the language instead of hiding behind a
private op. **Every time a session reaches for a raw bridge op, the work is
the missing word.**

## What stays of the bridge

One thing is irreducible: a session runs outside the browser, so something has
to carry its sentence into the tab. That carrier is the remote door
(`command-line:remote-submit`, reached by the bridge's `submit`). Everything
else the bridge does is a word that has not been written yet.

`scripts/bridge/say.cjs` is the whole client:

```bash
MSYS_NO_PATHCONV=1 node scripts/bridge/say.cjs "go /meetings"
MSYS_NO_PATHCONV=1 node scripts/bridge/say.cjs "website page {meetings.html}" --file page/meetings.html
```

## Files ride with the sentence

A participant drops a file and the hive holds it by signature. A session sends
its files with the line: each is stored by its SHA-256 before the line runs,
checked against the signature the sender computed (a mismatch runs nothing),
and stays inert until a word names it. In the sentence, `{<file name>}` is
replaced by `say.cjs` with that file's signature. Bytes travel by signature;
there is no second way to change a tile.

## The reply carries what the hive said

While a line runs, the door collects the activity lines and toasts the hive
shows a participant and returns them as `heard`. That is how a session reads by
speaking: a word that answers (`opens meetups`, `website list`) answers in the
reply. `--listen <ms>` keeps listening for slow acts such as a publish.

## Words added for this

| Word | Does |
|---|---|
| `go <tile>`, `go <path>`, `go /<path>`, `go ..`, `go /` | Walks. Refuses a place with no tile. |
| `website page <sig>` | Dresses the tile you stand on with the page whose HTML is resource `<sig>`, closure declared. |
| `publish on <domain>` | Names the domain for the tile you stand on, then publishes it (consent asked). |
| `publish off <domain>` | Takes it off that domain; the last door off withdraws it. |

| `find <word>`, `find <word> /`, `find <word> /<route>` | Names the tiles whose name holds the word, and how the walk went: how many tiles it opened, how long it took, and why it stopped short when it did. The chat's models already read with the same grammar. |
| `chats tidy`, `chats tidy dry` | Puts away (archives, never deletes) the one-off job conversations sessions hand the hive: answered and quiet ten minutes, or never answered and an hour old. Never a manager's own conversation, a tile's chat, or the participant's own chat. `dry` lists them and moves nothing. |

Notes already had a word: `file on /<route>: <text>`.

Both of the last two were bridge ops for one day (`hive-find`, `chat-tidy`,
2026-10-15) and were retired for words the same day. What a session HEARS
never names a withheld tile: the door masks every route the participant
withheld from outside models as `/(withheld)`, whichever word said it, while
the participant's own screen still shows their own tiles.

## Defects the first run found, and their fixes

- **Unmatched prose became a tile.** `go meetups`, said before `go` loaded,
  minted `go-meetups`. A remote line that names no word and uses no structural
  grammar is now refused (`speaksStructure`, remote-verbs.ts).
- **`file` read its note for other words.** The note was cut at "from" and
  `/from`, `/hive`, `/tutorial` ran on its words. `file` keeps its arguments
  verbatim now (`rawArgs`). Any word that takes free text needs the same.
- **Two sessions share one tab.** A sentence acts where the hive stands, and
  another session can move it between two sentences. `publish on` read the
  tile, then `publish here` read it again and could publish whatever tile the
  tab had moved to. The tile is now read once and passed through. Until each
  word can name its target, keep `go` and the act back to back and check the
  `heard` lines say where it acted.

## What is left to retire

The raw ops below still exist for scripts written before this. Each one is
retired by writing its word, then moving its callers to sentences.

| Raw op | Word today |
|---|---|
| `add` | `create <name>` |
| `put-resource` | files ride with the sentence |
| `decoration-add` | `website page <sig>` for pages; other kinds have none yet |
| `note-add` | `file on /<route>: <text>` |
| `note-delete`, `note-split` | none yet |
| `effect-emit publish:*` | `publish on`/`off`, `publish here` |
| `stamp` | `title`, `accent`, `keyword` cover parts |
| `build-record` | `builds` |
| `remove` | `remove`, a participant's act (refused remotely by design) |
| `update`, `bag-add`, `bag-remove`, `bag-set` | none yet |
| `hive-root-set` | none yet |
| reads (`layer-at`, `get-resource`, `inflate`, `ui-state`, …) | words that answer, heard in the reply; most have none yet |
| the manager loop (`chat-*`, `thread-read`, `optimization-*`, `summary-*`) | the hive's own chat; a separate retirement |
