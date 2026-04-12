import { ApplicationConfig, provideAppInitializer } from '@angular/core'
import { provideRouter } from '@angular/router'
import { routes } from './app.routes'
import { initDcpI18n } from './core/dcp-i18n'

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAppInitializer(() => initDcpI18n()),
  ]
}
