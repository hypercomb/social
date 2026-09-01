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
import '../rewind-window/rewind-window.component'
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
import '../files-viewer/files-viewer.component'
import '../context-window/context-window.component'
import '../references-window/references-window.component'
import '../chat-window/chat-window.component'
import '../features-viewer/features-viewer.component'
// The guided tours, as a roster you can read before you fly one. It replaced
// the rail bee's Ctrl+click flyout — see tutorials-window.component.ts.
import '../tutorials-window/tutorials-window.component'
// What is behind the hive and what fills a blank tile, in one window — and the
// only surface from which a picture of your own can be either.
import '../backgrounds-window/backgrounds-window.component'
// Makes the pictures the window above puts behind things. ComfyUI runs on the
// participant's own machine; this panel is the prompt, the workflow and where
// the picture lands — the data lives in essentials and crosses on comfy:render.
import '../comfy-panel/comfy-panel.component'
import '../sequence-viewer/sequence-viewer.component'
import '../tags-viewer/tags-viewer.component'
import '../workflow-designer/workflow-designer.component'
import '../layout-designer/layout-designer.component'
import '../flex-editor/flex-editor.component'
import '../pheromone-tiles/pheromone-tiles.component'
import '../observe-viewer/observe-viewer.component'
// The hosts you carry — lifted out of the publish panel, where it had been a
// tab. It is the data set that panel's picker draws from, so it has to be
// readable on its own terms and not as a by-product of a publish sweep.
import '../hosts-panel/hosts-panel.component'
import '../publish-panel/publish-panel.component'
import '../clipboard-panel/clipboard-panel.component'
import '../contact-card/contact-form.component'
import '../contact-card/contact-hover.component'
import '../action-card/action-card.component'
import '../feedback-viewer/feedback-viewer.component'
import '../website-nav/website-nav.component'
import '../tile-editor/tile-editor.component'
import '../camera-capture/camera-capture.component'
import '../portal/portal-overlay.component'
// Draw on the screen, photograph it, and hand the picture to the agents —
// opened from the annotations window (markup-overlay.component.ts).
import '../markup-overlay/markup-overlay.component'
import '../confirm-dialog/confirm-dialog.component'
import '../icon-picker/icon-picker.component'
import '../mesh-modal/mesh-modal.component'
import '../trust-prompt/trust-prompt.component'
import '../sensitivity-bar/sensitivity-bar.component'
import '../docs-overlay/docs-overlay.component'
import '../shortcut-sheet/shortcut-sheet.component'
import '../layer-cycle-strip/layer-cycle-strip.component'
import '../toast/toast.component'
import '../presence-banner/presence-banner.component'
import '../preview-banner/preview-banner.component'
// The quiet-landing badge — a background write landed and the repaint is
// being held until the participant taps for it (show-cell #quietLanding).
import '../landing-badge/landing-badge.component'
import '../example-hives/example-hives-offer.component'
import '../youtube-viewer/youtube-viewer.component'
import '../activity-log/activity-log.component'
import '../command-palette/command-palette.component'
import '../format-painter/format-painter.component'
import '../atomizer-bar/atomizer-bar.component'
import '../atomizer-bar/atomizer-sidebar.component'
