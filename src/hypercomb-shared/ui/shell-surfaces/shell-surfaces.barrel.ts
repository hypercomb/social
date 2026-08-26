// hypercomb-shared/ui/shell-surfaces/shell-surfaces.barrel.ts
//
// The ONE list of registry-fed shell surfaces. Each side-effect import runs the
// element's module-scope registerShellSurface(), so the surface contributes
// itself just by being listed here. Add a surface to this barrel — never add an
// <hc-*> tag to a shell's app.html again.
//
// Listed in mount order (the `order` field on each registration is what the
// host actually sorts by — this list is for humans).

// The floating vertical selection menu that used to lead this list is RETIRED —
// selection flows into each behavior's own tool window now
// (documentation/selection-tool-windows.md).
// ONE index panel for every aggregate — Collections, Websites, and anything
// that registers a source. The per-aggregate landings it replaced (
// `website-landing/`, `collections-landing/`) were deleted 2026-08-06; an aggregate now
// declares a source and inherits the panel's chrome AND its drag-to-create-
// meaning. See aggregate-index/aggregate-source.ts.
