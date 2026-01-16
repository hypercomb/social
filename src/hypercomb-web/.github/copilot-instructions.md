# Copilot instructions (hypercomb-web)

## Big picture
- Angular CLI v20 app using **standalone bootstrap**: see [src/main.ts](src/main.ts) + [src/app/app.config.ts](src/app/app.config.ts).
- Routing is minimal and currently wildcard-based: [src/app/app.routes.ts](src/app/app.routes.ts). Verify the import path before changing routes.
- Root layout is a 3-row CSS grid (header / content / footer) in [src/styles.scss](src/styles.scss); the template uses Angular control-flow `@if` blocks in [src/app/app.html](src/app/app.html).

## Where to implement things
- UI components live under `src/app/*` (e.g., `header/`, `footer/`, `home/`, `core/components/`). Components are written as standalone and declare `imports` in the `@Component` decorator (e.g., [src/app/app.ts](src/app/app.ts)).
- “Core” behavior appears to be evolving; a large scratchpad of planned code exists in [src/app/core/_files](src/app/core/_files). If a symbol is imported but missing as a real file (e.g., `Hypercomb`, `TextIntentSource`, `HypercombMode`), check `_files` before inventing a new API.

## Conventions & gotchas (important)
- There are **two** `SearchBarComponent`s with the same selector (`app-search-bar`):
  - [src/app/core/components/search-bar/search-bar.component.ts](src/app/core/components/search-bar/search-bar.component.ts)
  - [src/app/common/header/search-bar/search-bar.component.ts](src/app/common/header/search-bar/search-bar.component.ts)
  Before editing, confirm which one is referenced by the route/template to avoid changing the wrong component.
- Many files use Angular **signals** for state (`signal`, `computed`) and expose readonly signals from services (example: [src/app/history-service.ts](src/app/history-service.ts)). Prefer this style over RxJS unless the surrounding code already uses Observables.
- Browser history integration:
  - Mutations go through `window.history.pushState/replaceState/back` in [src/app/history-service.ts](src/app/history-service.ts).
  - `popstate` listeners are registered/cleaned up in [src/app/history-component/history.ts](src/app/history-component/history.ts).
  If you add navigation-like state, keep service as the source of truth and sync via `popstate`.

## Styling
- Global layout styles live in [src/styles.scss](src/styles.scss).
- App-level SCSS variables exist in [src/app/variables.scss](src/app/variables.scss); reuse existing variables rather than introducing new ad-hoc values.

## Developer workflows
- Dev server: `npm run start` (runs `ng serve`, default `http://localhost:4200/`).
- Build: `npm run build`.
- Tests are configured in `angular.json` (Karma); there is no `npm test` script currently, so run `ng test` if needed.

## Safe change checklist
- When touching routing or core imports, run `npm run build` to catch missing-file/alias issues early.
- When editing `SearchBarComponent`, double-check the file path to avoid the duplicate component.
