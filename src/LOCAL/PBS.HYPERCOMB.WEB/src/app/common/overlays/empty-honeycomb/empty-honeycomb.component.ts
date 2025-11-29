import { Component, OnDestroy } from '@angular/core'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { HypercombMode } from 'src/app/core/models/enumerations'

@Component({
  standalone: true,
  selector: 'app-empty-honeycomb',
  templateUrl: './empty-honeycomb.component.html',
  styleUrl: './empty-honeycomb.component.scss'
})
export class EmptyHoneycombComponent extends Hypercomb implements OnDestroy {
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
  }

  // ─────────────────────────────────────────────
  // remove listeners to avoid duplicates
  // ─────────────────────────────────────────────
  ngOnDestroy() {
    // Always remove; we don't need the el guard here
    document.removeEventListener('click', this.onLeft)
  }

  // ─────────────────────────────────────────────
  // handlers
  // ─────────────────────────────────────────────
  private onLeft = (event: MouseEvent) => {
    this.state.setMode(this.EditMode)
  }
}
