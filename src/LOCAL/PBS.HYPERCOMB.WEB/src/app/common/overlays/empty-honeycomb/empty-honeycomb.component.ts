import { Component, ElementRef, inject, OnDestroy } from '@angular/core'
import { ActionRegistry } from 'src/app/actions/action-registry'
import { BackHiveAction } from 'src/app/actions/navigation/back.action'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { HypercombMode } from 'src/app/core/models/enumerations'

@Component({
  standalone: true,
  selector: 'app-empty-honeycomb',
  templateUrl: './empty-honeycomb.component.html',
  styleUrl: './empty-honeycomb.component.scss'
})
export class EmptyHoneycombComponent extends Hypercomb implements OnDestroy {
  private readonly registry = inject(ActionRegistry)
  private readonly host = inject(ElementRef)
  public EditMode = HypercombMode.EditMode

  constructor() {
    super()

    // wait until view settles
    setTimeout(() => {
      this.attachHandlers()
    }, 50)
  }

  // ─────────────────────────────────────────────
  // add listeners dynamically
  // ─────────────────────────────────────────────
  private attachHandlers() {
    document.addEventListener('click', this.onLeft)
    document.addEventListener('contextmenu', this.onRight)
  }

  // ─────────────────────────────────────────────
  // remove listeners to avoid duplicates
  // ─────────────────────────────────────────────
  ngOnDestroy() {
    // Always remove; we don't need the el guard here
    document.removeEventListener('click', this.onLeft)
    document.removeEventListener('contextmenu', this.onRight)
  }

  // ─────────────────────────────────────────────
  // handlers
  // ─────────────────────────────────────────────
  private onLeft = (event: MouseEvent) => {
    this.state.setMode(this.EditMode)
  }

  private onRight = async (event: MouseEvent) => {
    event.preventDefault()
    // overlay is tied to "empty honeycomb" status, so clear it first
    this.state.setHoneycombStatus(false)
    await this.registry.invoke(BackHiveAction.ActionId, { event })
  }
}
