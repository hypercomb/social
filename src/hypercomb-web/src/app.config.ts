import { inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, type ApplicationConfig } from '@angular/core';

import { DRONE_RESOLVER_KEY, register } from '@hypercomb/core';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';
import { ScriptPreloader } from '@hypercomb/shared/core';

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

