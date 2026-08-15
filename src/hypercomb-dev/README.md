# HypercombDev

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 20.2.0.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

### Why dev's `initial` budget is ~2.3 MB larger than web's

`angular.json` sets `initial` to `maximumWarning: 4.2mb` / `maximumError: 4.5mb`.
`hypercomb-web` sets `1.8MB` / `2.5MB`. **That gap is by design — do not "fix" it
by copying web's numbers, and do not relax web's numbers to match dev's.**

The two shells load drones by different mechanisms (see `src/CLAUDE.md`,
"Dev-time vs Runtime loading"):

- **hypercomb-web never imports essentials.** `grep -r '@hypercomb/essentials'
  hypercomb-web/src` returns nothing. `LayerInstaller` downloads signed bundles
  into OPFS and `ScriptPreloader` imports them at runtime through an import map.
  Essentials bytes are therefore *deployed content*, not bundle — which is why
  web's initial sits at ~1.77 MB.
- **hypercomb-dev imports essentials directly**, so breakpoints, source maps and
  `ng serve` rebuilds work against real `.ts` with no publish step. One line in
  [`src/app/app.ts`](src/app/app.ts) — `import '@hypercomb/essentials/side-effects'`
  — pulls the entire auto-generated startup barrel (~280 self-registering
  `*.drone.ts` / `*.queen.ts` / `*.worker.ts` / `*.view.ts` / `*.atomizer.ts`
  modules) into the initial chunk. That is the whole point of the dev shell.

Making that import dynamic would not be a real saving: every module in the
barrel self-registers into `window.ioc`, and `App`'s constructor enumerates
`list()` on the next microtask to pulse the registered bees. Deferring the
barrel either downloads the identical bytes one tick later (a budget-accounting
trick, not a smaller app) or forces bee startup behind an `await` — a boot-order
change in the shell every other verification leans on. The budget was raised
instead, on purpose.

**The budget still guards against regressions.** Measured initial total is
**4.07 MB** (`main-*.js` 3.53 MB + ~14 shared chunks), so the warning has ~135 kB
of headroom and the error ~450 kB. Bucketing `main-*.js.map` by source package
confirms where it goes: `hypercomb-essentials` 55.8%, `hypercomb-shared` 23.2%,
`@angular/*` ~12%, everything else under 2% each — no single rogue dependency.
Adding a drone or two moves it by single-digit kB; accidentally pulling a heavy library
into the *initial* graph (a second renderer, a parser, a polyfill bundle) trips
it immediately. If the error starts firing from honest drone growth rather than
from one fat import, the fix is to extend the post-render preload lane rather
than to raise the ceiling again — see below.

**Levers, in the order to reach for them:**

1. **Preload lane.** `hypercomb-essentials/scripts/prepare.ts` splits the barrel
   into `side-effects.ts` (initial) and `preload-effects.ts` (dynamic, warmed
   after the first settled render). Classification is path-derived — today only
   `diamondcoreprocessor.com/games/**`. Widening that predicate moves whole
   feature areas out of the initial chunk with no barrel upkeep. Both files are
   generated; edit the predicate, never the barrels.
2. **Genuinely eager third-party code.** Check what actually landed before
   assuming it is essentials:
   ```bash
   npm --prefix hypercomb-dev run ng -- build --configuration production --verbose
   ```
   `sourceMap` is on in the production configuration, so
   `dist/hypercomb-dev/browser/main-*.js.map` can be bucketed by `sources[]`
   prefix for a per-package attribution.
3. **Raising the ceiling** — only with the measured number and a note here
   saying what moved it.

Note that i18n catalogs (`ru`/`hi`/`ar`/`ja`/… ~2.5 MB total) and the games are
already lazy chunks and do **not** count toward `initial`.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
