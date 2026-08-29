// hypercomb-dev/src/main.deploy.ts
//
// THE DEPLOYABLE ENTRY. One line, and that is the whole point.
//
// The artifact that ships must not be a COPY of the web shell's boot — a copy
// is a fork, and 593 lines of hard-won boot ordering (import-map replay races,
// SW control, cold-install fallbacks, the reload-once guard) would drift the
// moment one side is touched. So this entry does not reproduce that boot, it
// IS that boot: the same module, evaluated for its side effects, exactly as
// hypercomb-web/src/main.ts is evaluated when the web project builds it.
//
// Consequence worth stating plainly: `ng build --configuration deploy` here
// and `ng build --configuration production` in hypercomb-web compile the same
// source through the same compiler, so the outputs are equivalent by
// construction rather than by inspection. That is what makes flipping the
// workflows to this project a path-change instead of a migration.
//
// The dev entry (src/main.ts) is untouched and still bundles essentials via
// the direct `side-effects` import. Two configurations, one project:
//   development → src/main.ts        — direct import, fast iteration
//   deploy      → this file          — installer/OPFS runtime loading
//
// Nothing else may live in this file. Anything the deployed shell needs
// belongs in the shared boot, where BOTH shells get it.
import '../../hypercomb-web/src/main'
