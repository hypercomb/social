// hypercomb-shared/ui/docked-panel/hc-docked-panel.directive.ts
//
// hcDockedPanel — the Angular ADAPTER for the docked-panel primitive. It owns
// no behaviour: every input below is handed straight to `DockedPanel`
// (@hypercomb/core, core/panels/docked-panel.ts), which is where the chrome,
// the lane, the group and the settings popover actually live.
//
// It exists so the ~50 Angular tool windows keep working unchanged. Template
// usage is exactly what it always was:
//
//   <aside class="files-panel" hcDockInset="right"
//          hcDockedPanel="files-viewer" dockSide="right"
//          [minWidth]="280" [maxWidth]="680" [defaultWidth]="340"> … </aside>
//
// Why the split: a module may only import from core, and the framework-free
// harness (hypercomb-shim) cannot load Angular at all — its field decorators
// throw in JIT and the build guard fails the bundle. So a behaviour that wants
// a docked panel of its own calls `attachDockedPanel` from core directly, and
// this file is what an Angular component uses to reach the same class.
//
// Read the primitive for the model. This file should stay boring: a new
// setting, lane rule or gesture belongs in core/panels, never here. If this
// file grows behaviour again, the split has failed.

import {
  Directive, ElementRef, EventEmitter, Input, Output, inject,
  type OnChanges, type OnDestroy, type OnInit, type SimpleChanges,
} from '@angular/core'
import {
  DockedPanel, type DockedPanelOptions, type PanelSizeOwner,
  type SettingRow, type WindowSession,
} from '@hypercomb/core'

// Re-exported from their old home so no importer had to move with the model.
export { dismissOpenPopover, type PanelSizeOwner } from '@hypercomb/core'

@Directive({
  selector: '[hcDockedPanel]',
  standalone: true,
})
export class HcDockedPanelDirective implements OnInit, OnChanges, OnDestroy {

  /** Stable participant-local id → localStorage width key. */
  @Input('hcDockedPanel') id = ''
  /** Screen edge the panel docks against; the grip sits on the opposite edge. */
  @Input() dockSide: 'left' | 'right' = 'right'
  @Input() minWidth = 280
  @Input() maxWidth = 680
  @Input() defaultWidth = 360
  @Input() minScale = 0.82
  @Input() maxScale = 1.4
  /** Opening text size, or `null` for AUTO (width-derived). */
  @Input() defaultText: number | null = null
  /** False for a window that already sizes itself — it takes the settings half
   *  only. See the primitive; the whole rule is written there. */
  @Input() ownsSize = true
  @Input() sizeOwner: PanelSizeOwner | null = null
  @Input() launcherControlId = ''
  @Input() ownSettings: (() => SettingRow[]) | null = null
  @Input() pairWindow = ''
  @Input() pairOpenEffect = ''
  @Input() pairCloseEffect = ''
  @Input() pairWhen: boolean | null = null
  @Input() pairLabel = ''
  @Input() hasReadingSurface = false
  @Input() hcSession: WindowSession | null = null

  /** Live-flippable: how the notes strip leaves and rejoins the rail. Held here
   *  as well as on the panel because it can be set BEFORE `ngOnInit` builds
   *  one, and the panel's own setter is what reacts once there is a panel. */
  @Input() set dockExclusive(value: boolean) {
    this.#dockExclusive = value !== false
    if (this.#panel) this.#panel.dockExclusive = this.#dockExclusive
  }

  /** The owning component handles this through its normal close method, keeping
   * its signal, launcher state, and teardown path authoritative. */
  @Output() readonly hcDockedPanelClose = new EventEmitter<void>()

  readonly #el: HTMLElement = inject(ElementRef).nativeElement
  #panel: DockedPanel | null = null
  #dockExclusive = true

  /** Every input, as the primitive's options. One place, so an input added
   *  above and not passed here is a compile error rather than a setting that
   *  silently does nothing. */
  #options(): DockedPanelOptions {
    return {
      id: this.id,
      dockSide: this.dockSide,
      minWidth: this.minWidth,
      maxWidth: this.maxWidth,
      defaultWidth: this.defaultWidth,
      minScale: this.minScale,
      maxScale: this.maxScale,
      defaultText: this.defaultText,
      ownsSize: this.ownsSize,
      sizeOwner: this.sizeOwner,
      launcherControlId: this.launcherControlId,
      ownSettings: this.ownSettings,
      pairWindow: this.pairWindow,
      pairOpenEffect: this.pairOpenEffect,
      pairCloseEffect: this.pairCloseEffect,
      pairWhen: this.pairWhen,
      pairLabel: this.pairLabel,
      hasReadingSurface: this.hasReadingSurface,
      hcSession: this.hcSession,
      dockExclusive: this.#dockExclusive,
      onClose: () => this.hcDockedPanelClose.emit(),
    }
  }

  ngOnInit(): void {
    this.#panel = new DockedPanel(this.#el, this.#options())
    this.#panel.init()
  }

  /** Only `pairWhen` ever acted on a change, and the primitive keeps that rule.
   *  Passing the whole option set means an input that starts mattering later
   *  needs no edit here. */
  ngOnChanges(changes: SimpleChanges): void {
    if (!this.#panel || changes['pairWhen']?.firstChange !== false) return
    this.#panel.update(this.#options())
  }

  ngOnDestroy(): void {
    this.#panel?.dispose()
    this.#panel = null
  }
}
