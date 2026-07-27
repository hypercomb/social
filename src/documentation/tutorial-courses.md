# Tutorial Courses

**Everything is a tutorial.** A beeing flies the screen and shows you how the
hive works — not once, as a scripted tour, but as a growing set of independent
lessons organised into four courses.

```
/tutorial                  the starter course — move, make, get home
/tutorial beginner         the everyday verbs
/tutorial intermediate     meaning: marks, filters, titles, references, filing, history
/tutorial expert           paths, hives, views, the assistant, the swarm
/tutorial <lesson>         one lesson on its own (e.g. /tutorial go-in)
/tutorial list             what is on offer
/tutorial stop             end a running tour
```

The Help page (`/help`) leads with a **Guided Tours** island — one tile per
course; clicking it sends the bee up.

## A lesson is an independent piece

`hypercomb-essentials/src/diamondcoreprocessor.com/tutorial/`

| File | Role |
|---|---|
| `tutorial-lesson.ts` | the lesson primitive + registry, the declared pheromone vocabulary, each course's group signature |
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
   `tutorial-lesson.ts`; the registry refuses a lesson that invents a word. The
   hive mirror paints exactly these marks, so tile and code cannot drift.
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

## The mirror

`scripts/mirror-tutorials.ts` builds the hive mirror: `tutorials` at the root,
one collection per course, one tile per lesson, notes carrying what each teaches
and how to run it alone, pheromones taken verbatim from the lesson
declarations, and the course group signature on every tile. It also spreads the
implementation files as `part` cells under `behaviors/guidance/tutorial` (the
1:1 rule — see `mirror-paradigm.md`).

Run it against a live renderer with the bridge open:

```bash
npx tsx scripts/mirror-tutorials.ts
```

**When a lesson ships, extend the mirror in the same pass** — add its tile under
the right course, paint its marks, note what it teaches.
