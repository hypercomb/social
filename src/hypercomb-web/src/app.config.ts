import { provideBrowserGlobalErrorListeners, provideAppInitializer, provideZonelessChangeDetection, type ApplicationConfig } from '@angular/core';

import { BEE_RESOLVER_KEY } from '@hypercomb/core';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';

// side-effect imports: ensure shared services self-register before Angular boots
import '@hypercomb/shared/core'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless: change detection runs from signal updates, not zone tasks.
    // The 84 non-Angular drones doing OPFS / sig / commit / mesh work no
    // longer pay zone-task tax on every await.
    provideZonelessChangeDetection(),
    provideAppInitializer(() => {
      const preloader = get('@hypercomb.social/ScriptPreloader')
      register(BEE_RESOLVER_KEY, preloader)
    }),
    provideRouter(routes),
  ]
};

