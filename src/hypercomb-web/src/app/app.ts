import { Component, inject, signal } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { Header } from './header/header'
import { CoreAdapter } from './core-adapter'
import { TileEditorComponent } from '@hypercomb/shared/ui/tile-editor/tile-editor.component'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, Header, TileEditorComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {

  protected readonly title = signal('hypercomb-web')
  public showHeader = true
  public showFooter = false

  protected readonly core = inject(CoreAdapter)
  protected readonly meshPublic = this.core.meshPublic
  protected readonly toggleMesh = () => this.core.toggleMesh()

  constructor() {
    window.addEventListener('error', e => {
      if ((e as ErrorEvent).message?.includes('ResizeObserver loop')) {
        e.stopImmediatePropagation()
      }
    })

    void this.core.initialize()
    console.log('[app] initialized')
  }
}
