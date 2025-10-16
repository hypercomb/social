// main.ts
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http'
import { importProvidersFrom, inject, provideAppInitializer, Injector } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import { provideAnimations } from '@angular/platform-browser/animations'
import { AppComponent } from './app/app.component'
import { AuthConfigModule } from './app/core/auth/auth-config.module'
import { PolicyRegistrations } from './app/navigation/menus/policy-registrations'
import { AppRoutingModule } from './app/shared/modules/app-routing.module'
import { HiveModule } from './app/shared/modules/hive.module'
import { PixiManager } from './app/pixi/pixi-manager'
import { PIXI_MANAGER } from './app/shared/tokens/i-pixi-manager.token'
import { DATABASE_PROVIDERS } from './app/shared/tokens/i-database.token'
import { HypercombModule } from './app/shared/modules/hypercomb.module'
import { RepositoryModule } from './app/shared/modules/repository.module'
import { CombStoreModule } from './app/shared/modules/comb-store.module'
import { CombServiceModule } from './app/shared/modules/comb-service.module'
import { CombQueryModule } from './app/shared/modules/comb-query.module'
import { HiveImageModule } from './app/shared/modules/hive-image.module'


// ðŸ‘‡ hold a reference
let appInjector: Injector

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptorsFromDi()),
    provideAnimations(),
    importProvidersFrom(AuthConfigModule),
    importProvidersFrom(AppRoutingModule),
    ...DATABASE_PROVIDERS,
    importProvidersFrom(HiveModule),
    importProvidersFrom(CombStoreModule),
    importProvidersFrom(CombServiceModule),
    importProvidersFrom(CombQueryModule),
    importProvidersFrom(HiveImageModule),
    importProvidersFrom(HypercombModule),
    provideAppInitializer(() => inject(PolicyRegistrations).initialize()),
    importProvidersFrom(RepositoryModule),
    { provide: PIXI_MANAGER, useClass: PixiManager }
  ],
}).then(ref => {
  // ðŸ‘‡ capture the injector when the app boots
  appInjector = ref.injector
})

export { appInjector }

