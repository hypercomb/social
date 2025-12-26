import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { OpfsManager } from './core/opfs.manager';
import { ACTION_MANAGER } from '@hypercomb/core';


export const appConfig: ApplicationConfig = {
  providers: [

    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // action discovery seam
    { provide: ACTION_MANAGER, useClass: OpfsManager }
  ]
};
