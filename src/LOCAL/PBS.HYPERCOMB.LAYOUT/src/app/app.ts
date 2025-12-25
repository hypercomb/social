// src/app/app.ts

import { Component, inject, signal } from '@angular/core'
import { RouterOutlet } from '@angular/router'
import { Header } from "./header/header"
import { Footer } from "./footer/footer"
import { hypercomb } from './hypercomb'
import { synchronizer } from './core/synchronizer'

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header, Footer],
  providers: [synchronizer],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App extends hypercomb {

  protected readonly title = signal('PBS.HYPERCOMB.LAYOUT')
  public showHeader = true
  public showFooter = false
  
  // --------------------------------------------------------
  // startup dependencies
  // --------------------------------------------------------
  private readonly sync = inject(synchronizer)
  // --------------------------------------------------------
  // startup dependencies
  // --------------------------------------------------------
  
  constructor() {
    super()

    window.addEventListener('error', e => {
      if ((e as ErrorEvent).message?.includes('ResizeObserver loop')) {
        e.stopImmediatePropagation()
      }
    })

    // replay url once, in order
    this.bootstrapFromUrl().catch(console.error)
  }

  private readonly bootstrapFromUrl = async (): Promise<void> => {
    const original = window.location.pathname
    const segs = original.split('/').filter(Boolean)
    const state = window.history.state as any

    if (!segs.length) return
    if (state?.__hc === 1) return

    window.history.replaceState({ __hc: 1, i: 0 }, '', '/')

    // critical: await, so / -> /jaime -> /jaime/weise (no races)
    for (const seg of segs) {
      await this.act(seg)
    }
  }
}
