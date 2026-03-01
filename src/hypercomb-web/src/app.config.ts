import { inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, type ApplicationConfig } from '@angular/core';

import { DRONE_RESOLVER_KEY, register } from '@hypercomb/core';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';
import { ScriptPreloader } from '@hypercomb/shared/core';
import { sharedProviders } from '@hypercomb/shared/core/shared-providers';

export const appConfig: ApplicationConfig = {
  providers: [
    ...sharedProviders,
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAppInitializer(() => {
      const preloader = inject(ScriptPreloader)
      register(DRONE_RESOLVER_KEY, preloader)
    }),
    provideRouter(routes),
  ]
};

