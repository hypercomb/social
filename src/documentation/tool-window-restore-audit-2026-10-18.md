# Tool-window open/close audit — does the hive come back? (2026-10-18)

jwize: "after closing chat or notes, behaviors sometimes the screen shows blank
… restoring content and position are both critical." This audit traces every
open and close path of the three sidebar windows (chat, notes desk, Beehaviors)
plus the surfaces they pair with, states what each path does to the canvas,
and reproduces the failures live.

## Method

- **Code trace.** `hypercomb-core/src/core/panels/{window-session,window-rule,
  tool-windows,docked-panel,dock-lanes}.ts`, `hcDockedPanel`, `hcDockInset`,
  `navigation/mode-registry.service.ts` (owner-counted `view:active`),
  `presentation/tiles/pixi-host.worker.ts` (`#applyHostVisibility`,
  `#applyHostInset`, `resyncToHost`, `applyCenter`), `keyboard/escape-cascade.ts`,
  `navigation/view-back.ts`, the chat window, notes strip and features viewer
  components.
- **Live probe.** `scripts/drive-window-restore.cjs` against the dev shell on
  4250 in Playwright's own browser profile (own OPFS — never a second tab on
  the participant's hive). Renderer `webgl`, three seeded tiles, 41 scenarios.
  After every step it records: `#pixi-host` visibility and box, `view:active`
  and `view:keeps-controls` owners, `body.hc-view-*`, showing and parked
  windows, stage position, `render:cell-count`, lineage segments, header and
  controls visibility, and any full-bleed surface still standing.

## The model — how the hive hides and how it comes back

| Surface | Kind | What it does to the canvas | How the canvas comes back |
|---|---|---|---|
| Chat window | full-screen **view** | claims `view:active` + `view:keeps-controls` (ModeRegistry); pixi-host sets `#pixi-host` `visibility:hidden` while ANY owner holds `view:active`; header bar + edit-actions hide on `view:shell-hidden` | the claim is released (close, park, fold) and no other owner remains |
| Notes desk | full-screen **view** | same two claims, derived reactively from `visible()` (`effect(() => #claimSurface(visible()))`); brings the pheromone palette as a pair on wide desks (`pairWindow="tags-viewer"`, `pairWhen=deskWide`) | same |
| Beehaviors panel | right **panel** | no claim; reserves its width (`hcDockInset="right"` → `viewport:inset`) → pixi-host shrinks its box → renderer resize → recentre/refit; peels any ViewMode view to hexagons on open | the inset clears when the panel unmounts → box grows back → recentre |
| Pheromone palette (tags viewer) | right **panel**, `companion: true` | reserves its width like Beehaviors | same |
| Tile editor | right **panel** (window session) | reserves its width; `park()` = cancel the edit (draft kept) | same |

Rules that move windows: **one window at a time** (`window-rule.ts`) PARKS the
others when a window opens (the companion palette may stay beside one window);
the **dock lane** holds two per edge above 900px and parks the oldest when a
third arrives; **Escape** parks every showing surface and remembers for 3 s —
a press straight after brings everything back. **Nothing else ever unparks.**

Position is the stage centre plus the saved pan, re-applied by `applyCenter`
on every host resize; a page resting on its fit refits to the new box. The
ticker never stops while covered, so no redraw is owed on uncover.

## Findings

### F1 — BLANK SCREEN: a folded chat plus Escape strands the surface claim  (reproduced 3/3)

**Sequence.** Open chat → press the fold (peek) button → press Escape.

**What the participant sees.** Canvas hidden, header bar and command line
hidden, controls bar still there, no window on screen. Nothing on the screen
says why. It is the reported "blank after closing chat".

**Evidence (probe).** After the press: `#pixi-host visibility:hidden`,
`view:active` owners `["chat-window"]`, showing windows `[]`, header hidden,
cell count 3 (the tiles are there, under a hidden canvas).

**Mechanism.** The keymap hears Escape in the **capture** phase
(`keymap.service.ts:101`) and the cascade's sweep parks the chat:
`visible=false`, the session's announce runs `#claimSurface(false)`. The same
keydown then **bubbles** to the chat's own handler `onKey`
(`chat-window.component.ts:5713`), which sees `peeking()` still true and calls
`togglePeek()` → `#claimSurface(true)` — re-entering `view:active` for a
window that is no longer showing. `#claimSurface` never consults `visible()`.
The composer band's `onInputKey` (line 8102) routes Escape into the same
`onKey`, so typing in the folded band and pressing Escape strands it too.

**Recovery today.** Escape again within 3 s (the put-back unparks the chat,
whose announce re-derives the claim), or open and close chat from its icon.
Both verified by the probe.

**Remedy.**
1. Make the chat's claim **reactive**, as the notes desk already does:
   `effect(() => this.#claimSurface(this.visible() && !this.peeking()))`, and
   drop the imperative `#claimSurface(...)` calls from open/close/park/peek. A
   claim that is a function of what is on screen cannot be stranded.
2. Declare the chat's Escape through its session —
   `signalSession(visible, announce, { dismiss })` where `dismiss` unwinds one
   level (picture viewer, clipboard flyout, fold, rail picks, rail subject) and
   returns whether it consumed the press — and delete the Escape branches from
   `onKey` and `onInputKey`. One press, one owner: the cascade's Priority 2
   asks the focused window first, and only sweeps when nothing was consumed.
   (This also fixes the UX half: today Escape inside a folded chat takes the
   whole window away instead of unfolding it, which is what the chat's own
   code intends.)
3. Ratchet (spec): after any window closes or parks, `ownersOf('view:active')`
   must be a subset of {showing windows ∪ active ViewMode owners}. The probe
   is the behavioural half; `view-back.spec.ts` shows the shape.

Same class of risk, not reproduced: `keyword-suggestions.view.ts`,
`youtube-metadata-queue.ts`, `camera-capture.component.ts` enter `view:active`
imperatively. A `releaseOwner` on teardown or a reactive claim guards each.

### F2 — POSITION NOT RESTORED: closing the notes desk leaves the pheromone palette standing  (every close path except the Escape sweep)

**Sequence.** Open notes (desk ≥ 1024px wide) → close it by the toggle, the
×, the `notes:panel {visible:false}` word, or Escape-then-Escape-then-close.

**What the participant sees.** The desk goes, the hive comes back **inset by
321px** with the palette standing alone on the right: `#pixi-host` box
1079×900 instead of 1400×900, stage centre x 540 instead of 700. Tiles sit
left of where they were. Only the Escape sweep (which parks the palette too)
restores the full box.

**Mechanism.** `#openPairIfWanted` (`docked-panel.ts:613`) brings the palette
when the desk opens. `#closePair` (line 635) runs only on the `pairWhen`
transition (the desk crossing 1024px) — never from `dispose()` when the desk
closes or is parked. The pair the shell brought outlives the window it served.

**Remedy.** Track `#broughtPair` when `#openPairIfWanted` emits; in
`dispose()` (close OR park) park the pair if it is still up and was brought by
this window; bring it again on unpark (the open owner-call already noted in
`feedback_window_opens_only_from_its_door`). A pair the participant opened
themselves is left alone (same `readPairing` asymmetry as `#closePair`).

### F3 — Displaced windows never return (UX)

| First open | Then open | Close the second → | Observed |
|---|---|---|---|
| Chat | Notes | notes close | chat stays parked; palette left standing (F2) |
| Notes | Chat | chat close | notes stays parked; palette left standing (F2) |
| Chat | Beehaviors | Beehaviors close | chat stays parked |
| Beehaviors | Chat | chat close | Beehaviors stays parked |
| Notes | Beehaviors | Beehaviors close | notes stays parked; palette left standing |
| Beehaviors | Notes | notes close | Beehaviors stays parked; palette left standing |
| Tile editor | Chat or Notes | close | edit CANCELLED on park (draft kept), editor not reopened |

The one-window rule parks the window you were in; closing the newcomer brings
nothing back. Escape's 3 s memory and the lane's menu undo are the only
put-backs. **Recommendation:** a window's CLOSE (×, its word, its door toggle —
not a park) restores the window(s) its arrival displaced, a stack of one. A
park stays a park, so Escape and the installer are unchanged.

### F4 — Opening chat or notes cancels an open tile edit (UX)

`tile-editor.view.ts:181` — `park: () => this.#cancel()`, deliberately (a
hidden editor would keep the input gate). The participant gets no word of it.
Recommendation: the door that displaces an editor toasts "draft kept, reopen
the tile to continue" (`toast:show` with the tile as the door), per
`feedback_window_opens_only_from_its_door`.

### F5 — The full-screen chat takes a lane place and evicts the palette (UX)

Chat declares `dockSide="right"` with `dockExclusive` defaulting true, so it
claims a 400px lane slot it never uses (it covers the screen). Palette + chat
fill the right lane; Beehaviors arriving **evicts the palette** (parked, never
returns) and the rule parks the chat. Probe: `showing` went
`["tags-viewer","chat-window"]` → `["features-viewer"]`. Recommendation: chat
sets `[dockExclusive]="false"` like the notes desk — it owns the screen, not a
lane place.

### F6 — Navigation under a covering chat lands you elsewhere on close (UX)

Probe: chat open → `Navigation.goRaw(['alpha'])` under it → close → the hive
shows the empty child (`render:cell-count` 0) — the empty-layer prompt is the
only content. Nothing is broken, but "closing chat" put the participant on a
different page. The chat rail keeps its own trail by design; anything in chat
that moves the hive while covering it should either be the rail (no hive move)
or close the chat first so the move is seen.

### Verified fine — no action

- Chat, notes and Beehaviors release the canvas and the host box on every
  close path (toggle, word, ×), the F1/F2 cases excepted. 41 scenarios in the
  probe; 8 fail, all F1 or F2.
- Escape put-back round trips (park → back → park) for all three windows.
- A ViewMode view under chat (tree): chat releases only its own claim; the
  tree stays; turning the tree off restores the canvas.
- Beehaviors peels a view on open (by design, view.bee) and leaves hexagons.
- Reload with chat remembered open: the late claim lands when the registry
  arrives; close releases it.
- Browser Back with chat open: the view-back trap is consumed, the lineage
  does not move, the chat stays (Back is not a way out of chat — note).
- A user pan survives Beehaviors open/close (stage 850,540 → 648,540 → 850,540)
  and chat open/close.
- Editor then chat: the editor is parked (cancelled, F4), chat close restores
  the canvas; two Escapes afterwards do nothing harmful.

## Window pairings — what makes sense per place

| Place | Shows with | Must not show with | On its close |
|---|---|---|---|
| **Chat** (full-screen) | the controls bar only; the hive when folded (peek) | notes, Beehaviors, editor — any of them parks it | restore what it displaced (F3); never leave a claim (F1) |
| **Notes desk** (full-screen) | the pheromone palette beside it on a wide desk; the controls bar | chat, Beehaviors, editor | take the palette with it (F2); restore what it displaced |
| **Beehaviors** (right panel) | hexagons only (views peeled); the palette in the other lane slot | chat, notes (it parks them); a view (it closes itself when one opens) | restore what it displaced; leave hexagons as-is (by design) |
| **Pheromone palette** | any one window, or the bare hive | nothing — it is the paint | brought by a pair → leaves with it; opened by hand → stays |
| **Tile editor** | the hive beside it | any covering view (park = cancel) | — ; the displacer should say "draft kept" (F4) |

## Remedy order

1. **F1** — chat claim reactive + Escape declared through the session. This is
   the blank screen.
2. **F2** — a brought pair leaves with its window. This is the shifted hive.
3. **F3 + F5** — close restores the displaced window; chat out of the lane.
4. **F4, F6** — toasts and policy.

All of it is shell code (`hypercomb-shared/ui/chat-window`,
`hypercomb-core/src/core/panels/docked-panel.ts`) — not yet reachable as a
module, so the hive's own agent cannot land it.

## Proof

```bash
node scripts/drive-window-restore.cjs --url http://localhost:4250/
```

41 scenarios, JSON per step to the OS temp dir (`--out` to choose). On
2026-10-18 against development: 33 ok, 8 FAIL — three F1 (folded chat +
Escape), five F2 (palette standing after notes close). Re-run after each
remedy; the two FAIL groups must go to zero and nothing else may move.

## Landed (2026-10-18)

F1 and F2 are in. The chat's surface claim is one reactive effect of
`visible() && !peeking()` (no imperative claim on any path but the final
release in `ngOnDestroy`), its Escape is declared through the session
(`signalSession(…, { dismiss })`, unwinding one level: picture → clipboard
flyout → fold → rail picks → rail subject) with no keydown listener of its
own, and the aside sets `[dockExclusive]="false"` (F5). The docked panel
remembers which window brought which pair in a module-level map (the instance
dies with its element on every park), parks the pair in `dispose()` while
the memory is this window's, keeps the memory across Escape's park/put-back,
and lets the pair go when it comes up alone (`#forgetIfAlone`).

Probe: 40 scenarios in the script (the 41 above counted the seed). Before:
32 ok / 8 FAIL. After: 40 ok / 0 FAIL. One scenario changed shape with the
remedy: `chat: open → peek → Escape` used to park the chat and now UNFOLDS it
(the press is the window's own dismiss, one level — remedy 2), so the
scenario is `peek → Escape (unfold) → Escape (park) → wait 4s`, and the probe
records both halves: after the first press `view:active` is owned by
`chat-window` and the chat is showing; after the second no owner, nothing
showing, canvas and header visible, still so 4 s later. Remedy 3's ratchet
is the probe itself (it asserts the owners after every step); no spec in the
suite mounts an Angular component, so a unit ratchet is not its shape.

**F3 and F4 landed (same day).** The docked panel now tells a CLOSE from a
PARK: the session it registers is a wrapper whose `park` goes through
`parkByShell` (the rule, the lane, Escape's sweep, the installer and a pair
all pass there), so `dispose()` releases the one-window rule with
`closed: true` only when no park led to it. The rule (`window-rule.ts`)
remembers, per arrival, the one window it parked for it (`displacedBy`), and
the arrival's close unparks it if it is still away — a stack of one, a step
per close. A park by Escape or the installer spends the memory (the hexagons
were asked for); a park by the rule keeps it (the window above will be closed
in its turn); a displaced window that comes back on its own account is owed
nothing. The companion palette is never what is restored. The tile editor's
park, when the draft had changes, toasts "Draft kept — reopen {tile} to
continue" with `tile:action edit` as the door (`editor.draft-kept`, en + ja),
and its unpark reopens the same tile through that door with the kept draft
offered by the restore strip — so a close that restores the editor (F3)
brings the edit back, and the toast covers the time in between and the parks
nothing brings back. Probe: the six "pair:" scenarios now end by closing the
restored window and assert it came back mid-way, plus "Escape parks → nothing
back", "Escape, put back, then close → nothing back" and the editor case
(toast, then restored with its draft): 43 ok / 0 FAIL. Six
`window-rule.spec.ts` cases pin the rule. F6 remains open.

## Landed (2026-10-21) — the double Escape, and F6

**Escape, Escape changes nothing — including what a close brings back.**
The sweep spent the newcomer's memory, so chat → notes → Escape → Escape
(notes back, exactly as it was) → close notes brought nothing back, although
the two presses had changed nothing on screen. Escape's sweep now holds what
each of its windows owed (`holdDisplacements` in `window-rule.ts`, called by
`putAwayAll` in `tool-windows.ts`) and hands it back, per window, only with
the put-back that returns that window. A sweep nobody takes back keeps the
memory spent, and nothing is handed to a window whose displaced window came
back on its own. Four specs pin it (window-rule and tool-windows).

**F6 — following a place shows the place.** The only thing that moves the
hive under a covering chat is the chat itself: a place link in an answer
(`goPath`). The hive moved behind a window that still covered it, so the
destination was not on screen and closing the chat later dropped the
participant somewhere they had stopped thinking about. Now the chat FOLDS
on that click — the same fold its own button makes: the place is on screen
and live, the conversation is one press (or Escape) away, and closing leaves
you where you went. The agent's work grammar has no navigation verb, so
nothing else moves the hive while chat covers it.

Probe: 44 scenarios — the double-Escape case now expects chat back, and
"follow a place link → folded on the place → close stays" is new. The
harness also survives the shared tree now: every `ng serve` reloads the page
when any session saves a file, so each scenario plants a marker and is RUN
AGAIN (never scored) when a reload takes it; a scenario that reloads on
purpose says `{ reloads: true }`. 44 ok / 0 FAIL on 4253, one reload
absorbed. Nothing from the audit remains open.
