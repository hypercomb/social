// hypercomb-shared/ui/shell-surfaces/shell-surfaces.barrel.ts
//
// The ONE list of registry-fed shell surfaces. Each side-effect import runs the
// component's module-scope registerShellSurface(), so the surface contributes
// itself just by being listed here. Add a surface to this barrel — never add an
// <hc-*> tag to a shell's app.html again.
//
// Listed in mount order (the `order` field on each registration is what the
// host actually sorts by — this list is for humans).

// The floating vertical selection menu that used to lead this list is RETIRED —
// selection flows into each behavior's own tool window now
// (documentation/selection-tool-windows.md).
import '../history-viewer/history-viewer.component'
import '../notes-strip/notes-strip.component'
// ONE index panel for every aggregate — Collections, Websites, and anything
// that registers a source. The per-aggregate landings it replaced (
// `website-landing/`, `collections-landing/`) were deleted 2026-08-06; an aggregate now
// declares a source and inherits the panel's chrome AND its drag-to-create-
// meaning. See aggregate-index/aggregate-source.ts.
import '../aggregate-index/aggregate-index.component'
import '../aggregate-index/sources/collections.source'
import '../aggregate-index/sources/websites.source'
import '../notes-viewer/notes-viewer.component'
import '../chat-window/chat-window.component'
import '../features-viewer/features-viewer.component'
import '../tags-viewer/tags-viewer.component'
import '../workflow-designer/workflow-designer.component'
import '../publish-panel/publish-panel.component'
import '../clipboard-panel/clipboard-panel.component'
import '../contact-card/contact-form.component'
import '../contact-card/contact-hover.component'
import '../tile-editor/tile-editor.component'
import '../portal/portal-overlay.component'
import '../command-palette/command-palette.component'
import '../atomizer-bar/atomizer-bar.component'
import '../atomizer-bar/atomizer-sidebar.component'
import '../host-panel/host-panel.component'
