import { Component, inject, signal } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { Header } from './header/header'
import { hypercomb } from '@hypercomb/core'
import { CoreAdapter } from './core-adapter'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, Header],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App extends hypercomb {

  protected readonly title = signal('hypercomb-web')
  public showHeader = true
  public showFooter = false

  private readonly core = inject(CoreAdapter)

  constructor() {
    super()
    window.addEventListener('error', e => {
      if ((e as ErrorEvent).message?.includes('ResizeObserver loop')) {
        e.stopImmediatePropagation()
      }
    })

    void this.core.initialize()
  }
}
