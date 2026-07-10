// hypercomb-shared/ui/shell-surfaces/shell-surfaces.barrel.ts
//
// The ONE list of registry-fed shell surfaces. Each side-effect import runs the
// component's module-scope registerShellSurface(), so the surface contributes
// itself just by being listed here. Add a surface to this barrel — never add an
// <hc-*> tag to a shell's app.html again.
//
// Listed in mount order (the `order` field on each registration is what the
// host actually sorts by — this list is for humans).

import '../selection-context-menu/selection-context-menu.component'
import '../history-viewer/history-viewer.component'
import '../notes-strip/notes-strip.component'
import '../website-landing/website-landing.component'
import '../collections-landing/collections-landing.component'
import '../notes-viewer/notes-viewer.component'
import '../files-viewer/files-viewer.component'
import '../features-viewer/features-viewer.component'
import '../tags-viewer/tags-viewer.component'
import '../observe-viewer/observe-viewer.component'
import '../clipboard-panel/clipboard-panel.component'
import '../contact-card/contact-form.component'
import '../contact-card/contact-hover.component'
import '../action-card/action-card.component'
import '../feedback-button/feedback-button.component'
import '../feedback-viewer/feedback-viewer.component'
import '../website-nav/website-nav.component'
import '../tile-editor/tile-editor.component'
import '../portal/portal-overlay.component'
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
import '../swarm-adopt-panel/swarm-adopt-panel.component'
import '../youtube-viewer/youtube-viewer.component'
import '../activity-log/activity-log.component'
import '../command-palette/command-palette.component'
import '../format-painter/format-painter.component'
import '../atomizer-bar/atomizer-bar.component'
import '../atomizer-bar/atomizer-sidebar.component'
