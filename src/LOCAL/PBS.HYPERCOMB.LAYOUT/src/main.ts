// src/main.ts

import { bootstrapApplication } from '@angular/platform-browser'
import { appConfig } from './app/app.config'
import { App } from './app/app'

window.addEventListener('error', e => {
  if ((e as ErrorEvent).message?.includes('ResizeObserver loop')) e.stopImmediatePropagation()
})

const original = window.location.pathname
const segs = original.split('/').filter(Boolean)
const state = window.history.state as any

if (segs.length && state?.__hc !== 1) {
  window.history.replaceState({ __hc: 1, i: 0 }, '', '/')
  let p = ''
  for (let i = 0; i < segs.length; i++) {
    p += '/' + segs[i]
    window.history.pushState({ __hc: 1, i: i + 1 }, '', p)
  }
}

bootstrapApplication(App, appConfig).catch(console.error)
