// hypercomb-web/src/main.ts
/// <reference path="./global.d.ts" />

import './app/core/ioc.web'
import { resolveImportMap } from './setup/resolve-import-map'
import { appConfig } from './app.config'

const ensureDevDroneHost = async (): Promise<void> => {
  // dev is "present" if the dev manifest exists
  try {
    const r = await fetch(`/dev/name.manifest.js?_=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return
  } catch {
    return
  }

  // create iframe only in dev
  if (document.getElementById('hc-drone-host')) return

  const iframe = document.createElement('iframe')
  iframe.id = 'hc-drone-host'
  iframe.src = `/drone-host.html?boot=${Date.now()}`
  iframe.style.display = 'none'
  document.body.appendChild(iframe)
}

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
  await ensureDevDroneHost()

  const { bootstrapApplication } = await import('@angular/platform-browser')
  const { App } = await import('./app/app')
  await bootstrapApplication(App, appConfig)
}

bootstrap().catch(err => console.error(err))
