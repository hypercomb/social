window.addEventListener('error', e => {
  if (e.message?.includes('ResizeObserver loop')) {
    e.stopImmediatePropagation()
  }
})

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
