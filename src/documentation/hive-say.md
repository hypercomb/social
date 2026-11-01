# Saying the hive's language over HTTP

**Status: built 2026-10-30; calls from outside wait for the participant since
2026-10-31.**

The hive's language is sentences said on its command line. A browser tab cannot
answer an HTTP request, so something has to hold the hive open and say the
sentences into it. `scripts/hive-say.cjs` does that: it is a small web service
on this machine. It reaches the hive's tab in Microsoft Edge through Playwright,
answers HTTP, hands what it receives to the hive as a call from outside, and
replies with what came of it once you have answered. Anything that speaks HTTP
can use it: curl, a script, an agent.

```
npm run hive:say                      # the hive at http://localhost:4250, HTTP on 127.0.0.1:4262
curl -s -X POST http://127.0.0.1:4262/say -H "X-Hive-Caller: me" --data "read /"
```

## The door

- **`POST /say`** takes one sentence as plain text (one per line), or JSON
  `{ "text": "…" }`, or `{ "sentences": ["…", "…"], "from": "…" }`. The
  caller is named by `from`, or the `X-Hive-Caller` header, or else "an
  agent". Sentences are said as given.
- **`GET /`** replies `{ "ready": true, "url": "…" }` once the hive's command
  line answers.

## Marked as external, and gated

One request is one call. It is not said when it arrives: the hive's command
line stands up its fourth stance, `$`, showing who sent it and its lines, and
a toast says a call is waiting. You answer on the command line
([command-line-reference.md](command-line-reference.md#external-stance--a-call-from-outside-answered-here)):

- **Enter** opens a new conversation on the layer you stand in, starting with
  the request, and says each sentence through the machine door
  (`command-line:remote-submit`). Every word is judged against your grants
  (`grant`) exactly as any machine's line is, so pressing Enter lets the call
  be said; it does not let it say more than a machine may. Each sentence's
  verdict is written into the conversation as it is said.
- **Esc** declines. Nothing is said, and the request and the decline are
  written into a new conversation on this layer.

The reply waits for your answer and the run, however long that takes:

```json
{ "outcome": { "kind": "ran", "convoId": "chat:tile:/::external-me-…",
  "results": [{ "text": "create word", "verdict": "ran /create" },
              { "text": "remove word", "verdict": "refused: /remove is destructive, and this hive grants a machine no further than editing" }] } }
```

or `{ "outcome": { "kind": "declined", "convoId": "…" } }`, or
`{ "outcome": { "kind": "refused", "reason": "…" } }` for a call the hive
would not queue (no lines, too many, too long, or a hive whose modules are
older than this door). A verdict is the machine door's own: `ran …`,
`refused: …`, `"word" is claimed by …` (ambiguous; nothing ran), or
`unknown: …`. A line is answered when its behaviour has finished, so the
next line runs where the last one left the hive: a plain line the hive reads
(`create word`) and a single `/word args` call both report what they ran. A
line in the structural grammar (selections, paths, tags, views) answers
unknown, because its pipeline does not report what it did.

Calls queue in the hive, in the order they arrive, whoever sends them; the
door holds none back itself.

The bridge's `submit` is the same call: while the bridge carries lines only
(the default, [claude-bridge-setup.md](claude-bridge-setup.md#lines-only-the-bridge-is-shut-off-by-default-2026-11-01)),
a line sent over it waits for your Enter in exactly this way.

Enter is taken only once a call has been on the line for a second, so an Enter
you meant for your own line cannot run something that arrived under it.

## Speaking as yourself

`--participant` turns the gate off for a hive you drive alone: each sentence
goes through `command:submit`, your own door, one at a time, with its leading
slash added if it has none, exactly as if you
had typed it (a publish still asks in the page), and the reply is what the
hive showed while it ran, `{ "said": [{ "text": "/read /", "heard": ["…"] }] }`.

Because the door can reach yours, the HTTP side listens on `127.0.0.1` only,
and refuses any request that names a web origin other than localhost, so no
web page can drive it. This is the bridge's rule, kept.

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
--settle <ms>           with --participant, how long each sentence is listened to, default 900
--headless              no window
--participant           speak as you, ungated, through command:submit
```

## Planting your own hive: use the bridge

`--attach` needs your browser started with remote debugging, and on Windows
that usually fails for the everyday hive: Edge keeps running in the background,
so starting `msedge.exe --remote-debugging-port=9222` hands over to the running
Edge and the flag is ignored, and Chromium-based browsers since 136 refuse
remote debugging on the everyday profile anyway. A separate profile works, but
it is a separate, empty hive.

The bridge reaches the tab you already use, with no debugging, and since it
carries lines only it gates the call the same way:

```
npm run bridge                                  # terminal 1: the broker
# open http://localhost:4250/?claudeBridge=1 in your usual Edge (once; it remembers)
npm run living:plant -- --all                   # terminal 2: one call, one Enter
```

The command line shows `living-plant: /go / · /create presentation · …`; after
a second, Enter runs every sentence and the terminal prints each verdict.

## Planting over HTTP

The living presentation's planting script says its sentences through this door:

```
npm run living:plant -- --all --say --publish hypercomb.com
```

The whole planting is one call: the command line shows it as from
`living-plant`, one Enter runs every sentence, and it prints each sentence's
verdict. Esc declines it all. A URL after `--say` points it at another door.

## Related

- [speak-dont-bridge.md](speak-dont-bridge.md): why every act is a sentence
- [change-channel.md](change-channel.md): asking another machine's hive for a
  change, which its participant accepts
- `hypercomb-core/src/external-call.types.ts`: the contract
- `hypercomb-essentials/src/assistant/external-call.drone.ts`: the queue, the
  run, and the record
- `scripts/hive-harness.cjs`: the test harness that says words the same way
