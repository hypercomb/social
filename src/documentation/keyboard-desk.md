# The keyboard desk

**Status: built 2026-11-01. The desk, chosen chords and lineups work on the dev shell. Moving a saved keymap between hosts is not built.**

jwize, 2026-11-01: "we need to show our virtual keyboard to help us set our chorded commands try to mimic the tile editor look when going to look at the keybindings not a list stle experience ... lets build the hypercomb way where the code lives in the automatons and they piece together properly so the subdomain lattice can have swarm coding sessions."

The same day: "forget the tiles we have the sidebar. We should also be able to use scripts like a lineup of automatons."

## What it is

`keyboard` opens a full-screen desk in the tile editor's shape: slim header, a list on the left, a labelled drawing in the middle. The drawing is a keyboard. Ctrl+Shift+/ opens it too, and the reference sheet's keyboard section is a door to it.

There are two ways in, and they meet:

- **Start at a key.** Click it or press it. Its callouts say everything it does across every modifier, and the strip under the board shows its lineup. A row in the list joins the end of that lineup.
- **Start at the list.** A row lights the keys it lands on. Rows clicked with no key chosen build a lineup, and the next key chosen binds it.

Clicking Ctrl, Shift, Alt or Win on the board latches that layer, and holding the real key does the same. Each key shows what it does in the layer showing. A binding that fires only because it ignores modifiers reads quiet, because the keymap fires it there too. `then…` adds a step, so a chord can be `Ctrl+K then G`.

A choice runs at once and saves at once. `defaults` puts every key back. `global.escape` cannot be moved and its chord cannot take a lineup, because Escape is the way out of everything, this desk included.

While the desk is open the keymap is held: nothing fires, not even a pierce binding, so pressing Ctrl+K names that chord instead of opening the palette. The browser keeps a few chords for itself, such as Ctrl+W.

## Lineups

Every binding is a lineup of one or more automatons. A sentence is the program (`living-presentation.md`), so a script is sentences in order, and a step is one sentence or one keymap command. `trait simple organized` is a step like any other, so a chord can carry arguments.

- **Building one.** Rows from the list join the end. The box at the end of the strip takes a typed step, or a whole script pasted in: each line is a step, blank lines are skipped, so a `sentences.txt` file goes in as it stands. ‹ and › move a step, and × takes it out.
- **Running one.** The chord says each sentence through `REMOTE_SUBMIT`, the door the bridge and `hive-say` use. That door answers when the behaviour has finished, so each step starts where the last one left the hive. A keymap command is fired and not waited on, because it has no answer to give.
- **Machine rules apply.** That door judges every line as an operator's, so a lineup can use any word that door admits, and the hive's machine grant still holds: a destructive verb is refused. A retired word, or a line that names no behaviour, is refused too.
- **Stopping.** The first step refused or thrown stops the row, and a toast names the step and the reason. Nothing after it runs. An `unknown` answer, from the line grammar that cannot report back, is not a failure, and the row carries on.
- **The line is used.** A step is said on the command line, so a chord's lineup overwrites any draft sitting there.
- **One plain step stays plain.** A single command or a bare word binds as itself and runs directly, as it always did. Anything more is kept as its own resource, `{ "kind": "lineup", "steps": [...] }`, and bound as `lineup:<sig>`. Changing a lineup makes a new signature and leaves the old one where it was.
- **Lineups compose.** A bound lineup is listed under Lineups and can be a step in another. A signature cannot contain itself, so no lineup can loop into itself.

## The parts

The desk is one behaviour and ten parts (`atomic-modules-plan.md`). Each part is a folder holding one trait word's own version.

| Trait | Folder | What a filler replaces |
|---|---|---|
| `board` | `board/` | The keys and where they sit. The own version is ANSI tenkeyless. |
| `legend` | `legend/` | What a key would do. Reads `keyboard/chord-match.ts`, the rule the keymap fires on. |
| `chord` | `chord/` | How a press is written down and read back. |
| `bindings` | `bindings/` | Where the participant's chords live. |
| `behaviours` | `behaviours/` | Everything a chord can run. |
| `lineup` | `lineup/` | What a lineup is, how it is kept, and how it runs. |
| `keycap` | `keycap/` | One key on the board. |
| `callouts` | `callouts/` | The labels and leaders on the drawing. |
| `strip` | `strip/` | The lineup in hand, in running order. |
| `list` | `list/` | The list on the left. |

`keyboard-desk.drone.ts` is the bee. It wires and owns no drawing: it puts the chosen chords into the keymap at boot, runs the ones that name a word or a lineup, and brings the view with the first open. `desk/` pieces the parts together, and `keyboard.queen.ts` is the word.

Three rules keep it apart:

1. **A part never imports another part.** `parts.ts` is the interface, and the only file every part may read. Only `desk/` imports the parts. The one rule two parts share, what a press is and whether a chord fits it, stands in `keyboard/chord-match.ts`, beneath them. How a `cmd` names a word or a lineup is in `parts.ts`.
2. **A part never registers.** It exports, and the bee wires.
3. **The own version stays.** A filler is whatever is registered at `partKey(word)`. With nothing there the part's own version runs, the same fill-then-own order as `traits.md`.

## Swarm sessions on the subdomain lattice

This is the shape `build-debug-isolation.md` asks for. A folder nobody touches keeps its signature, so ten parties can work at once and meeting is one mint.

- **One part, one door:** `try-keyboard-<word>.<zone>`, for example `try-keyboard-strip.hypercomb.com`. The door is its own origin with its own store, so one party's chords never reach another's hive.
- **The interface is the word.** A party gets the trait word and `parts.ts`, and needs nothing else from anyone.
- **The spec is the contract.** `keyboard-desk.spec.ts` asks each part its questions alone, and a filler has to answer the same ones.
- **Coming together is a choice:** one signature per folder, on the host file view, then one mint.

If a part needs something `parts.ts` does not carry, that is a change to the shared interface, so it is the one thing parties must talk about.

## How the keymap changed

- `keyboard/chord-match.ts` holds the press rule, which used to be private to the service, so the drawing and the keymap cannot disagree.
- A layer with the id `user-overrides` is the participant's. A record there needs only `cmd` and `sequence`, and takes the rest from the layer beneath it. An empty sequence takes a default off.
- **The press that finishes a chosen chord belongs to the participant alone.** `{ key: 'h' }` does not look at Ctrl, so without this Ctrl+H would run their binding and the default together. An earlier step only advances, beside everything else, as sequences always have: binding `D then U` leaves plain D doing what it did, so D fires its default on the way through, and a step never cancels another chord under way.
- `keymap:hold` and `keymap:release` are stronger than suppression: nothing fires.
- A chosen chord with Ctrl, Alt or Win reaches past a text field, as the shipped modifier bindings do. A plain key stays typing, so a chord on a bare letter fires only when no field has focus.

## Where a keymap lives

One document in the `keymap:bindings` pool, every version kept. The newest is what runs, and its signature names the whole keymap:

```json
{ "meaning": "keymap:bindings", "bindings": [{ "cmd": "word:history", "sequence": [[{ "key": "h", "code": "keyh", "primary": true }]], "description": "...", "category": "Words" }] }
```

A word binds as `word:<name>`, run through `SlashBehaviourDrone.execute` with no arguments. Anything with arguments or more than one step binds as `lineup:<sig>`.

## Still open

- **A keymap as something that travels.** The document is signature-addressed, so it can be handed over, but no word publishes or takes one. The `bindings` trait is where that goes, as a filler a followed host offers.
- **Groups for words.** A keymap command's group is its category. Words have no category, so they are one long group, and the find box carries it.
