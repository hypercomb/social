import { ACTION_RESOLVER } from '@hypercomb/core';
import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { OpfsStore } from './core/opfs.store';



export const appConfig: ApplicationConfig = {
  providers: [

    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    OpfsStore, // optional if already providedIn: 'root'
    {
      provide: ACTION_RESOLVER,
      useExisting: OpfsStore
    }
  ]
};
