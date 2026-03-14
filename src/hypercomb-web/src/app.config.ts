import { provideBrowserGlobalErrorListeners, provideAppInitializer, provideZoneChangeDetection, type ApplicationConfig } from '@angular/core';

import { BEE_RESOLVER_KEY } from '@hypercomb/core';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';
import { sharedProviders } from '@hypercomb/shared/core/shared-providers';

// side-effect imports: ensure shared services self-register before Angular boots
import '@hypercomb/shared/core'

export const appConfig: ApplicationConfig = {
  providers: [
    ...sharedProviders,
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAppInitializer(() => {
      const preloader = get('@hypercomb.social/ScriptPreloader')
      register(BEE_RESOLVER_KEY, preloader)
    }),
    provideRouter(routes),
  ]
};

