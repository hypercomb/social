import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import '@hypercomb/shared/core/ioc.web'
import { App } from './app/app';
import { Store } from '@hypercomb/shared';

const store = <Store>window.ioc.get("Store")
window.ioc.register('Store', store)

store.initialize().then(() => {
  console.log('Store initialized')
  bootstrapApplication(App, appConfig)
    .catch((err) => console.error(err));
})


