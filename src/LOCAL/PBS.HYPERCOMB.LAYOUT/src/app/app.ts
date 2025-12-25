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
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App extends hypercomb {

  protected readonly title = signal('PBS.HYPERCOMB.LAYOUT')
  public showHeader = true
  public showFooter = false

  // 🔑 force eager construction
  private readonly _sync = inject(synchronizer)

  constructor() {
    super()

    window.addEventListener('error', e => {
      if ((e as ErrorEvent).message?.includes('ResizeObserver loop')) {
        e.stopImmediatePropagation()
      }
    })

    const original = window.location.pathname
    const segs = original.split('/').filter(Boolean)
    const state = window.history.state as any

    if (segs.length && state?.__hc !== 1) {
      window.history.replaceState({ __hc: 1, i: 0 }, '', '/')
      for (const seg of segs) {
        this.act(seg).catch(console.error)
      }
    }
  }
}
