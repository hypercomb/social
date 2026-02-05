import { DRONE_RESOLVER } from '@hypercomb/core';
import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { ScriptPreloader } from './core/script-preloader';


export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    {
      provide: DRONE_RESOLVER,
      useExisting: ScriptPreloader
    }
  ]
};
  