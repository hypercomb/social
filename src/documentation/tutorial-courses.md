# Tutorial Courses

**Everything is a tutorial.** A beeing flies the screen and shows you how the
hive works — not once, as a scripted tour, but as a growing set of independent
lessons organised into four courses.

```
/tutorial                  open the TUTORIALS WINDOW — every course, every lesson
/tutorial start            fly the starter course straight away
/tutorial beginner         the everyday verbs
/tutorial intermediate     meaning: marks, filters, titles, references, filing, history
/tutorial expert           THE WINDOWS — one lesson per primary window
/tutorial <lesson>         one lesson on its own (e.g. /tutorial go-in)
/tutorial list             what is on offer, in the activity log
/tutorial stop             end a running tour
```

## The bare word opens the window, it does not fly

`/tutorial` used to launch the starter course on the spot. That made it the one
command in the hive whose plain form committed you to a five-minute flight
before showing you what else was on offer — and forty-odd lessons across four
courses cannot be chosen from a command whose argument you have to already
know. So the bare word opens the roster, and every argument that NAMES
something still flies it directly, unchanged.

`hypercomb-shared/ui/tutorials-window/` — a **tool window** like every other:
docked in the lane, drag-resized with content-shrink, the common header band,
the shared settings gear (group, text size, and the reading face, because half
of what it shows is prose), parked and unparked with the rest, and Escape
unwound one level at a time through the cascade. It is fed by
`TutorialLessonRegistry` over IoC and never imports essentials, so a build
without the tutorial module simply has no window, and a community module that
registers a lesson appears in it for free.

What it shows, in one screen:

| | |
|---|---|
| **Continue** | the list's FIRST ROW: the next lesson you have not flown, across every course — one door, no choosing. It stands down while you are searching, because the list is then the answer to what you typed |
| **Progress** | a bar over the whole roster; per course a pill (`3/8`) and a hexagon that FILLS as you fly it, numbered with the course's step in the ramp |
| **Search** | narrows by title, blurb, topic mark or id, and opens every course it matched |
| **Courses** | title, one-line blurb, and a play button that flies the whole thing. ONE open at a time (`ui/accordion.ts`), and the window opens with all four closed — all four headers fit on screen, and where you are is already said by the Continue row and each course's pill |
| **Lessons** | curriculum number, title, one-line blurb, topic marks (click one to search it), a tick once flown |
| **Flying** | while a tour is up: which lesson, and a Stop |

Progress is a participant preference, not content — `hc:tutorial:flown` in
localStorage, never a layer, the same call the help launcher's reached-tier
makes. The drone announces `tutorial:flown` only for a lesson that ran to the
END (one that threw is deliberately not ticked) and `tutorial:flying` for what
is in the air; those two effects are what make Stop and Continue possible.

The rail's bee toggles the same window — **one door, not two**. It used to fly
the starter course on a plain click and open a fixed-position course flyout on
Ctrl/⌘+click; the flyout showed an id and a count, said nothing about what a
lesson was for, and the first click anywhere dismissed it. It is gone.

The Help page (`/help`) leads with a **Guided Tours** island — one tile per
course; clicking it sends the bee up.

## A lesson is an independent piece

`hypercomb-essentials/src/diamondcoreprocessor.com/tutorial/`

| File | Role |
|---|---|
| `tutorial-lesson.ts` | the lesson primitive + registry, the declared pheromone vocabulary, each course's group signature and blurb (`TUTORIAL_COURSES`) |
| `tutorial-stage.ts` | the stage contract — the only surface a lesson may touch |
| `bee-tutorial.drone.ts` | the course runner — owns the stage, runs lessons in order |
| `lessons/*.lessons.ts` | the courses: one registration per lesson |
| `lessons/lesson-kit.ts` | the moves every lesson needs so none depends on another |

```ts
tutorialLessons.register({
  id: 'select',
  level: 'beginner',
  order: 10,                                   // the curriculum IS this number
  title: 'Select tiles',
  summary: 'Ctrl+click picks tiles without going in, and Ctrl+drag paints a run.',
  pheromones: ['tutorial', 'lesson', 'beginner', 'editing'],
  requires: () => hasBehaviour('keyword'),     // dormant behaviour → lesson drops out
  async run(stage) { /* fly, talk, demonstrate */ },
})
```

Four properties make this work:

1. **Independent.** A lesson runs alone or as the fifth step of a course and
   behaves the same either way: it asks the stage what is on the page and makes
   what it needs (`subject` / `subjects` in the kit). The runner returns the
   stage to the practice page and clears the selection between lessons, and a
   lesson that throws is logged and stepped over — one broken lesson never takes
   the course down.
2. **Marked.** `pheromones` come from the DECLARED vocabulary in
   `tutorial-lesson.ts`; the registry refuses a lesson that invents a word.
3. **Grouped by signature.** Every course is a group —
   `sign('group:tutorial:course:<level>')` — carried by everything the course
   mints. See `group-signatures.md`.
4. **Gated.** `requires()` asks whether the behaviour being taught is actually
   registered in this build. A retired or uninstalled behaviour means one lesson
   fewer, never a broken step.

**Order is the curriculum**: `order` expresses "most obvious and simplest
first". Adding a lesson is choosing where it belongs in the ramp.

Any module can contribute a lesson for its own behaviour:

```ts
window.ioc.get('@diamondcoreprocessor.com/TutorialLessonRegistry')
  ?.register({ id: 'my-thing', level: 'expert', order: 50, /* … */ })
```

## The expert course is the windows

The advanced course is not a grab-bag of clever moves. It is **one lesson per
primary window**, each carrying every behaviour that lives in that window:

| Lesson | Window | Behaviours it carries |
|---|---|---|
| `window-command-line` | the command line | create, `[brackets]`, paths, `?` filter, `tile@behaviour` calls, every `/` behaviour |
| `window-palette` | command palette | `ui.commandPalette` |
| `window-help` | reference / docs reader | `/help`, `/docs` |
| `window-editor` | tile editor | name, cover, link, colours, the answer box |
| `window-format` | format painter | `/format` — the only copy-appearance verb |
| `window-notes` | annotations window | notes and lists tabs, nesting, marks, reorder, the reading pane |
| `window-reader` | notes reader | hierarchy tabs, prev/next, mark-onto-a-note |
| `window-files` | files viewer | `/files`, scope and reach |
| `window-tags` | tags viewer | `/tags`, `/keyword`, gathering, the collecting walk, bouquets |
| `window-collections` | aggregate index | `/collections`, Add vs Move, `/requires`, `/hive` |
| `window-filters` | filter configurations | `?` filter mode, saved filters, `/clear` |
| `window-clipboard` | clipboard panel | copy, cut, the swap in both directions |
| `window-sequence` | sequence viewer | `/sequence`, cycle, drop/paste targets |
| `window-workflow` | workflow designer | `/workflow new\|run\|step\|stop\|list` |
| `window-history` | history viewer | `/history`, `/revise`, marks |
| `window-rewind` | rewind window | `/rewind` |
| `window-features` | beehaviors window | the bulb, the lens, `/views`, `/tree`, `/website`, `/present`, `/postit`, `/tutor` |
| `window-assistant` | chat window + bee | `/opus`, `/sonnet`, `/haiku`, `/fable`, `/ask`, `/break-apart`, `/expand`, `/organize` |
| `window-context` | context window | `/context`, attached-context (portal-drop) narrated |
| `window-feedback` | feedback window | arrivals and open questions, reach, answering in the row |
| `window-observe` | observe viewer | `/observe`, and `/host` / `/invite` narrated |
| `window-publish` | publish panel | `/publish` — read-only, never fired |

**One window, one lesson — and it rots in both directions.** `window-views` used
to be a row of its own. The Views toolwindow was then retired and `/views`
became a LENS on the beehaviors window, so for a while two lessons opened one
surface and told the participant they were two different things; meanwhile the
format painter, the notes reader, the workflow designer, the feedback window and
the publish panel had all shipped with no lesson at all. Retiring a window means
retiring its lesson in the same pass, exactly as adding one means adding a
lesson.

Two gates, not one. `requires()` asks `hasBehaviour(name)` **and**
`hasWindow('hc-…')` — the shell-surface registry (`shell-surfaces.md`) is the
authority on whether the window is mounted in this build. A shell that never
registered a surface loses that lesson rather than opening nothing and
narrating over an empty screen.

**Adding a window to the shell means adding a lesson here, in the same pass.**
The roster and the interface are 1:1 by construction — the same rule the mirror
applies to tiles and source files.

## The stage

A lesson is handed a `TutorialStage` and nothing else. Every verb on it runs
through the SAME path a real participant's action takes:

| Stage verb | Real path |
|---|---|
| `enterCell` / `leave` / `goHome` | `Lineage.explorerEnter` / `explorerUp` / `Navigation.goRaw` |
| `typeAndSubmit` | the command line's `search:prefill` + `command-line:remote-submit` |
| `invoke(cmd)` | `keymap:invoke` — exactly what the keystroke fires |
| `create` / `createMany` | typed into the command line; `[a, b, c]` is one atomic commit |
| `editCell` | the same `tile:action` payload the pencil icon sends |
| `select` | `SelectionService`, the same service the pointer path drives |

So what the participant watches is exactly what will happen when they do it —
and a lesson cannot demonstrate something that would not really happen.

## Two rules the courses obey

1. **Nothing outside the practice page is touched.** Every course opens a
   transient practice page, teaches inside it, and deletes it — on finish, on
   abort, and (via the `sign('tutorial:artifacts')` provenance record) after a
   crash. Behaviours that act on the whole hive — `/snapshot`, `/restore`,
   `/host` — are NARRATED and pointed at, never fired.
2. **Nothing is ever published.** Going public is always the participant's own
   deliberate act. A tutorial that shared your hive to teach you sharing would
   be the exact opposite of the lesson.
