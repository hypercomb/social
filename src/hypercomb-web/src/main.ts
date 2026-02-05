// src/main.ts
/// <reference path="./global.d.ts" />

import { resolveImportMap } from './setup/resolve-import-map'

const url = window.location.pathname + window.location.search + window.location.hash
window.history.replaceState(window.history.state ?? {}, '', url)

resolveImportMap().then(importMap => {
  const script = document.createElement('script')
  script.type = 'importmap'
  script.textContent = JSON.stringify({ imports: importMap }, null, 2 )
  document.head.appendChild(script)

  // no reference to @essentials/* here
 
  import('@angular/platform-browser').then(({ bootstrapApplication }) => {
    import('./app/app.config').then(({ appConfig }) => {
      import('./app/app').then(({ App }) => {
        bootstrapApplication(App, appConfig).catch(console.error)
      })
    })
  })
})
