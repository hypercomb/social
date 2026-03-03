import { provideBrowserGlobalErrorListeners, provideAppInitializer, provideZoneChangeDetection, type ApplicationConfig } from '@angular/core';

import { DRONE_RESOLVER_KEY } from '@hypercomb/core';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';

// side-effect imports: ensure shared services self-register before Angular boots
import '@hypercomb/shared/core'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAppInitializer(() => {
      const preloader = get('@hypercomb.social/ScriptPreloader')
      register(DRONE_RESOLVER_KEY, preloader)
    }),
    provideRouter(routes),
  ]
};

