# Saying the hive's language over HTTP

**Status: built 2026-10-30.**

The hive's language is sentences said on its command line. A browser tab cannot
answer an HTTP request, so something has to hold the hive open and say the
sentences into it. `scripts/hive-say.cjs` does that: it is a small web service
on this machine. It reaches the hive's tab in Microsoft Edge through Playwright,
answers HTTP, says each sentence it receives through the same door Enter uses,
and replies with what the hive said back. Anything that speaks HTTP can use
it: curl, a script, an agent.

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

## Your Edge, or its own hive

**Attach to the Edge you use.** Close every Edge window, start Edge with remote
debugging, open your hive at `localhost:4250`, then attach:

```
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222
npm run hive:say -- --attach
```

It speaks into the tab at `--url` (opening one if none is there) and never
closes your browser. Chromium, which Edge is built on, stopped honouring remote
debugging on the everyday profile in version 136, and Edge may do the same; if
attaching is refused, start Edge with its own profile instead, adding
`--user-data-dir=<folder>`, or use the next way.

**Or let it open Edge with a profile of its own.** Without `--attach`, it
launches Edge (`--browser chrome` or `chromium` for another) with the profile
`.hive-profile` in your home folder unless `--profile` names another. That hive
stays between runs and is a hive of its own, with its own signing key: to
publish from it to your domains, allow its key with the keys word.
`--headless` hides it.

## Options

```
--url <hive url>        default http://localhost:4250
--port <port>           default 4262
--attach [<url>]        join a browser started with remote debugging, default http://127.0.0.1:9222
--browser <name>        msedge (default), chrome, or chromium, when it launches the browser
--profile <folder>      default ~/.hive-profile, when it launches the browser
--chrome <path>         a browser executable of your own
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
