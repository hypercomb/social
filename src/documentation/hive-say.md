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

- **Enter** writes a new conversation on the layer you stand in, starting
  with the request, and says each sentence through the machine door
  (`command-line:remote-submit`). Every word is judged against your grants
  (`grant`) exactly as any machine's line is, so pressing Enter lets the call
  be said; it does not let it say more than a machine may. Each sentence's
  verdict is written into the conversation as it is said.
- **The run is watched in the hive, not in the chat.** jwize, 2026-11-04:
  "when we are planting we shouldn't open the chat. That is confusing. Then
  we can just see the files processing instead of getting taken away." The
  conversation is written but never opened for you: each sentence's place in
  the run and its verdict appear in the activity log as it is said
  (`agent 12/125: /trait simple organized … → ran /trait`), you stay on the
  layers the call is building, and a toast at the end says how many lines
  were said and how many refused. The chat icon at the top right says where
  the record is going instead: bright and pulsing while the run is written,
  bright and still once it waits unread, quiet again when you open the chat
  (jwize, 2026-11-04: "make the chat icon on the top right pulse and be
  bright when you are adding these … instead of showing chat immediately").
  Open the conversation yourself when you want the record.
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

### The run preview: read it before you press Enter

jwize, 2026-11-26: "a full screen view semi-transparent background so you can
see the screen behind. The details in professional code formatted glory so you
can see what the command line is going to execute with a clear description
based on the behaviors."

While a call waits, the run preview (`essentials/assistant/run-preview.view.ts`)
draws it over the whole hive, nearly opaque (jwize: "much less transparency"),
as ONE LIST (jwize: "a single list … if you click the term you can get a
breakout row so you can see the meaning"):

- each item is its line of code, numbered: the behaviour words lit, paths,
  signatures (drawn short, whole on hover), strings and selections each in
  their own ink, and the words a sentence throws away dimmed;
- click a behaviour word and a row breaks out under the line: what the
  behaviour does, in your language, and exactly what it is handed; click
  again to fold it;
- a line the door will refuse wears a short tag (`refused`, `choose`, `not a
  behaviour`); click the tag for the door's own reason, before anything runs.

Each line's reading is `commands/utterance/line-plan.ts`, which follows the
door's own fork in the same order: a word that keeps its arguments, a slash
word, a sentence read by the utterance reader, the structural grammar, or a
sentence that names nothing (refused). Every verb is asked of core's machine
admission with your grant, as the door asks it. So the preview shows what the
door will do, including what you may not expect: `spotlight the history tile`
also runs `history`, and `go to protocol` hands `go` the words `to protocol`.

The answer is unchanged. While the command line has the keyboard it answers
there; anywhere else the preview takes Enter (run, after the same one-second
arming) and Esc (decline). Run and Decline buttons do the same. The command
line stops listing the lines under itself while the preview shows them.

### Stepping through a call: the debugger

jwize, 2026-11-26: "this should be a debugger as well if we want it to … we
can step through and see the results in a sub list in each item after
completed." Opt-in, per call:

| Key | While the call waits | While a debugged run is paused |
|---|---|---|
| click a line number | set or clear a breakpoint | the same, heard by the run at once |
| **F10** | run it paused before line 1 (Debug) | say this line, pause before the next |
| **F5** | run it, pausing at breakpoints | run on to the next breakpoint |
| **Shift+F5** / Esc | — / decline | stop: nothing more is said |

Enter with a breakpoint set runs under the debugger too. Every line that has
run gets its verdict, and everything the hive said while it ran, in a list
under it; a walk back to where the call stands (the hive had moved) is listed
there as well. A stopped run writes the lines it never said into its
conversation, and the caller hears each as `refused: the participant stopped
the run before this line`. While paused the hive is yours: look around, and
on resume the call walks back to where it stood before its next line.

The pauses are the external-call bee's: the preview sends
`external-call:debug { id, step, breakpoints }` before its `run` answer and
`external-call:resume { id, mode }` (step, continue, stop); the bee says
`external-call:paused`, `external-call:line` (every call, debugged or not) and
`external-call:finished`. A finished debugged run stays on screen until Esc or
Close.

### Your own line: F2

jwize: "opt-in key only." **F2** on the command line draws the line you are
typing in the same view, live as you type, read the way your own Enter will
read it (`line-plan.ts` `planOwnLine`): by stance, with no machine grant (your
own words are not a machine's), and a destructive word marked as asking first.
Enter still runs it on the command line exactly as before; F2 again or Escape
puts it away.

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
stage from it on your domains, allow its key with the keys word.
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
