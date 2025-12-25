// src/main.ts

import { bootstrapApplication } from '@angular/platform-browser'
import { appConfig } from './app/app.config'
import { App } from './app/app'
import { hypercomb } from './app/hypercomb'

class main extends hypercomb {
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
      // declare canonical root
      window.history.replaceState({ __hc: 1, i: 0 }, '', '/')

      // rebuild meaning through the engine, not history
      for (const seg of segs) {
        // this is the only allowed authoring path
        // write() owns pushState + synchronize
        this.write(seg).catch(console.error)
      }
    }

    bootstrapApplication(App, appConfig).catch(console.error)
  }
}

new main()
