import { ApplicationConfig, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { BEE_RESOLVER_KEY } from '@hypercomb/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { sharedProviders } from '@hypercomb/shared/core/shared-providers';

// side-effect imports: ensure shared services self-register before Angular boots
import '@hypercomb/shared/core'

export const appConfig: ApplicationConfig = {
  providers: [
    ...sharedProviders,
    provideBrowserGlobalErrorListeners(),
    // Zoneless: change detection runs from signal updates, not zone tasks.
    // The 84 non-Angular drones doing OPFS / sig / commit / mesh work no
    // longer pay zone-task tax on every await. Performance profile showed
    // 88% of CPU was zone scheduling overhead — this lifts that entirely.
    provideZonelessChangeDetection(),
    provideAppInitializer(() => {
      const preloader = get('@hypercomb.social/ScriptPreloader')
      register(BEE_RESOLVER_KEY, preloader)
    }),
    provideRouter(routes)
  ]
};
