import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import './app/core/ioc.web'

import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
