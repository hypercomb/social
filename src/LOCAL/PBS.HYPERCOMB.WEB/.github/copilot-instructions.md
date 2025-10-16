# Copilot Instructions for PBS Hypercomb Web

## Project Overview
- This is a modular Angular 13+ application for interactive hive data visualization and manipulation.
- Major domains: `hive` (data models, state, rendering), `actions` (user and system actions), `cells` (cell logic and behaviors), `services` (utility and UI services), and `shared` (tokens, cross-cutting concerns).
- Data flows through resolvers in `hive/data-resolvers/`, with loaders like `OpfsHiveLoader` handling backup, hydration, and activation of hive states.
- State management and navigation are handled via injected services and tokens (see `shared/tokens/`).

## Developer Workflows
- **Dev server:** `ng serve` (auto-reloads at http://localhost:4200/)
- **Build:** `ng build` (outputs to `dist/`)
- **Unit tests:** `ng test` (Karma)
- **E2E tests:** `ng e2e` (requires additional setup)
- **Scaffolding:** Use `ng generate` for new components, services, etc.

## Key Patterns & Conventions
- **Dependency Injection:** Use Angular's `inject()` for service/tokens, especially in loaders and controllers.
- **Data Loading:** All hive data loading is abstracted via resolvers in `hive/data-resolvers/`. Always backup live data before loading new hives (see `OpfsHiveLoader`).
- **State Hydration:** Invalidate hydration before loading new data (`hydration.invalidate()`).
- **Navigation:** Use carousel and controller services to activate and jump to new hives.
- **Debug Logging:** Use `logDataResolution()` for traceable data flow in loaders.
- **Tokens:** Shared tokens in `shared/tokens/` are used for service boundaries and cross-component communication.

## Integration Points
- **Dexie:** Used for client-side database operations (see database services).
- **External Services:** Data export/import via `DatabaseExportService` and related action services.
- **UI Navigation:** Carousel menu and controller services for user navigation.

## Examples
- To add a new hive loader, implement `IHiveLoader` and extend `HiveLoaderBase` in `hive/data-resolvers/`.
- For new actions, register in `actions/action-registry.ts` and follow existing service base class patterns.
- For new cell behaviors, add to `cells/behaviors/` and update relevant models.

## References
- Main app entry: `src/app/main.ts`
- Hive logic: `src/app/hive/`
- Actions: `src/app/actions/`
- Cells: `src/app/cells/`
- Shared tokens: `src/app/shared/tokens/`
- Database: `src/app/database/`

---
For unclear or missing conventions, ask the user for clarification or point to the relevant directory for further inspection.
