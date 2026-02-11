// hypercomb-web/src/main.ts
/// <reference path="./global.d.ts" />

import './app/core/ioc.web'
import { resolveImportMap } from './setup/resolve-import-map'

const ensureSwControl = async (): Promise<void> => {
  if (!('serviceWorker' in navigator)) return

  await navigator.serviceWorker.register('/hypercomb.worker.js', { scope: '/' })
  await navigator.serviceWorker.ready

  if (navigator.serviceWorker.controller) return

  const key = '__hypercomb_sw_reload__'
  if (sessionStorage.getItem(key) === '1') return

  sessionStorage.setItem(key, '1')
  location.reload()
}

const attachImportMap = async (): Promise<void> => {
  const imports = await resolveImportMap()

  const script = document.createElement('script')
  script.type = 'importmap'
  script.textContent = JSON.stringify({ imports }, null, 2)
  document.head.appendChild(script)

  await Promise.resolve()
}

const bootstrap = async (): Promise<void> => {
  await attachImportMap()
  await ensureSwControl()

  const { bootstrapApplication } = await import('@angular/platform-browser')
  const { appConfig } = await import('./app/app.config')
  const { App } = await import('./app/app')

  await bootstrapApplication(App, appConfig)
}

bootstrap().catch(err => console.error('[main] bootstrap failed:', err))
