import { inject, provideAppInitializer } from '@angular/core';
import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { ScriptPreloader } from './app/core/script-preloader';
import { DRONE_RESOLVER_KEY, register } from '@hypercomb/core';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    ScriptPreloader,
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAppInitializer(async () => {
      const preloader = inject(ScriptPreloader)
      return () => {
        register(DRONE_RESOLVER_KEY, preloader)
      }
    }),
        provideRouter(routes),
  ]
};

