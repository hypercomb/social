# Saying the hive's language over HTTP

**Status: built 2026-10-30.**

The hive's language is sentences said on its command line. A browser tab cannot
answer an HTTP request, so something has to hold the hive open and say the
sentences into it. `scripts/hive-say.cjs` does that: it opens the hive in a
browser it drives (Playwright) and answers HTTP on this machine, saying each
sentence it receives through the same door Enter uses, and replying with what
the hive said back.

```
npm run hive:say                      # the hive at http://localhost:4250, HTTP on 127.0.0.1:4262
curl -s -X POST http://127.0.0.1:4262/say --data "read /"
```

## The door

- **`POST /say`** takes one sentence as plain text, or JSON `{ "text": "…" }`,
  or `{ "sentences": ["…", "…"] }`. Each sentence gets its leading slash if it
  has none, is said on the command line, and the hive is listened to while it
  runs. The reply is `{ "said": [{ "text": "/read /", "heard": ["…"] }] }`:
  every toast and activity line the hive showed for that sentence.
- **`GET /`** replies `{ "ready": true, "url": "…" }` once the hive's command
  line answers.

Sentences are said one at a time, in the order they arrive, whoever sends them.

## The same as typing

Each sentence goes through `command:submit`, the participant's own door, so it
is admitted, undone and consented to exactly as if it had been typed: a
publish still asks in the page. Nothing new is allowed by speaking over HTTP.

Because that door has the participant's authority, the HTTP side listens on
`127.0.0.1` only, and refuses any request that names a web origin other than
localhost, so no web page can drive it. This is the bridge's rule, kept.

## Its own hive

The browser keeps its own profile, `.hive-profile` in your home folder unless
`--profile` names another, so the hive it opens stays between runs and is a
hive of its own. Chrome no longer lets a script drive your everyday profile,
so this cannot be the hive in your usual browser; it is a separate, visible
window you can use like any other. `--headless` hides it.

## Options

```
--url <hive url>        default http://localhost:4250
--port <port>           default 4262
--profile <folder>      default ~/.hive-profile
--chrome <path>         a browser of your own (Chrome, Edge) instead of Playwright's
--settle <ms>           how long each sentence is listened to, default 900
--headless              no window
```

## Planting over HTTP

The living presentation's planting script says its sentences through this door:

```
npm run living:plant -- --all --say --publish hypercomb.com
```

It prints each sentence and what the hive said back. A URL after `--say`
points it at another door.

## Related

- [speak-dont-bridge.md](speak-dont-bridge.md): why every act is a sentence
- [change-channel.md](change-channel.md): asking another machine's hive for a
  change, which its participant accepts
- `scripts/hive-harness.cjs`: the test harness that says words the same way
