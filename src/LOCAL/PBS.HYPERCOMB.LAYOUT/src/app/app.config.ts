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
    
    { provide: ACTION_RESOLVER, useClass: OpfsStore }

  ]
};
