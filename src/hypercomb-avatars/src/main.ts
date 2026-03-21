import '@hypercomb/shared/core/ioc.web'
import { bootstrapApplication } from '@angular/platform-browser'
import { SignatureStore } from '@hypercomb/core'
import { Store } from '@hypercomb/shared'
import { initializeRuntime } from '@hypercomb/shared/core'
import { appConfig } from './app/app.config'
import { App } from './app/app'

void Store

const main = async (): Promise<void> => {
  register('@hypercomb/SignatureStore', new SignatureStore())
  await initializeRuntime()
  await bootstrapApplication(App, appConfig)
}

main().catch(err => console.error(err))
