// src/main.ts

import { bootstrapApplication } from '@angular/platform-browser'
import { appConfig } from './app/app.config'
import { App } from './app/app'

// claim the initial session entry *without changing the URL*
const url = window.location.pathname + window.location.search + window.location.hash
window.history.replaceState(window.history.state ?? {}, '', url)

bootstrapApplication(App, appConfig)
  .catch(err => console.error(err))
