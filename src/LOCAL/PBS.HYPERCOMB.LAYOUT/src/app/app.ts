// src/app/app.ts

import { Component, inject, signal } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { Header } from "./header/header"
import { Footer } from "./footer/footer"
import { hypercomb } from '@hypercomb/core'
import { ScriptPreloaderService } from './core/script-preloader.service' // <-- add this import
import { OpfsStore } from './core/opfs.store'
import { MovementService } from './core/movment.service'

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, Footer],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App extends hypercomb {
  private readonly opfs = inject(OpfsStore)
  protected readonly title = signal('PBS.HYPERCOMB.LAYOUT')
  public showHeader = true
  public showFooter = false

  // --------------------------------------------------------
  // startup dependencies
  // --------------------------------------------------------
  private readonly movement = inject(MovementService)
  private readonly preloader = inject(ScriptPreloaderService) // <-- preload scripts on app start
  // --------------------------------------------------------

  constructor() {
    super()

    window.addEventListener('error', e => {
      if ((e as ErrorEvent).message?.includes('ResizeObserver loop')) {
        e.stopImmediatePropagation()
      }
    })

    // preload scripts first
    // no need to await — just fire it and let it warm up while bootstrapping
    queueMicrotask(async () => {
      await this.opfs.initialize()
      await this.preloader.initialize()
      //synchronize initial directory after OPFS is ready
      window.dispatchEvent(new Event('synchronize'))
    })

  }
}
