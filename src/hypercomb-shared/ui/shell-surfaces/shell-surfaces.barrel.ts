// hypercomb-shared/ui/shell-surfaces/shell-surfaces.barrel.ts
//
// The ONE list of registry-fed shell surfaces. Each side-effect import runs the
// component's module-scope registerShellSurface(), so the surface contributes
// itself just by being listed here. Add a surface to this barrel — never add an
// <hc-*> tag to a shell's app.html again.
//
// Migration is incremental: panels move out of app.html into this list one at a
// time. notes-strip is the first, proving the round-trip. The rest follow.

import '../notes-strip/notes-strip.component'
import '../website-landing/website-landing.component'
import '../collections-landing/collections-landing.component'
