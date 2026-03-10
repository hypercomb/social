// hypercomb-dev/src/main.ts

import '@hypercomb/shared/core/ioc.web'
import { bootstrapApplication } from '@angular/platform-browser'
import { BootstrapHistory } from '@hypercomb/shared/core/bootstrap-history'
import { SignatureStore } from '@hypercomb/core'
import { Store } from '@hypercomb/shared'
import { appConfig } from './app/app.config'
import { App } from './app/app'

// keep this as a value-use so the module can't be elided
void Store

const main = async (): Promise<void> => {

  // central signature allowlist — signText() memoizes repeated computeSignatureLocation calls
  register('@hypercomb/SignatureStore', new SignatureStore())

  // store is registered by side-effect in store.ts, but guard just in case
  const store = get('@hypercomb.social/Store') as Store
  await store.initialize()

  // start listening before bootstrap emits popstate
  try {
    const nav = get('@hypercomb.social/Navigation') as any
    nav?.listen?.()
  } catch {
    // ignore
  }

  // always rebuild the stack on refresh
  const history = get('@hypercomb.social/BootstrapHistory') as BootstrapHistory
  await history.run()

  await bootstrapApplication(App, appConfig)
}

main().catch(err => console.error(err))
