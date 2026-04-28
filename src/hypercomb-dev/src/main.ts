// hypercomb-dev/src/main.ts

import '@hypercomb/shared/core/ioc.web'
import { bootstrapApplication } from '@angular/platform-browser'
import { SignatureStore } from '@hypercomb/core'
import { Store } from '@hypercomb/shared'
import { initializeRuntime, DroneRegistry, IconProviderRegistry } from '@hypercomb/shared/core'
import { appConfig } from './app/app.config'
import { App } from './app/app'

// keep this as a value-use so the module can't be elided
void Store
void DroneRegistry
void IconProviderRegistry

const main = async (): Promise<void> => {

  // central signature allowlist — signText() memoizes repeated computeSignatureLocation calls
  register('@hypercomb/SignatureStore', new SignatureStore())

  await initializeRuntime()

  await bootstrapApplication(App, appConfig)
}

main().catch(err => console.error(err))
