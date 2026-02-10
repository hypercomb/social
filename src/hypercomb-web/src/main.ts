// src/main.ts
/// <reference path="./global.d.ts" />
import './app/core/ioc.web'

import { resolveImportMap } from './setup/resolve-import-map'

const url =
  window.location.pathname +
  window.location.search +
  window.location.hash

window.history.replaceState(
  window.history.state ?? {},
  '',
  url
)

resolveImportMap()
  .then(async importMap => {

    const script = document.createElement('script')
    script.type = 'importmap'
    script.textContent = JSON.stringify({ imports: importMap }, null, 2)
    document.head.appendChild(script)

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/hypercomb.worker.js', { scope: '/' })
    }


    // 🔑 critical: allow the browser to commit the import map
    await Promise.resolve()

    // no reference to @essentials/* here
    const { bootstrapApplication } = await import('@angular/platform-browser')
    const { appConfig } = await import('./app/app.config')
    const { App } = await import('./app/app')

    bootstrapApplication(App, appConfig)
      .then(() => {
        console.log('[main] 🎉 Angular bootstrap complete')
      })
      .catch(console.error)
  })
  .catch(err => {
    console.error('[main] ❌ Failed to resolve import map:', err)
  })
