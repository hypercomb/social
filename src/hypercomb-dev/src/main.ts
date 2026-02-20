// hypercomb-dev/src/main.ts

import '@hypercomb/shared/core/ioc.web'
import { bootstrapApplication } from '@angular/platform-browser'
import { BootstrapHistory } from '@hypercomb/shared/core/bootstrap-history'
import { Store } from '@hypercomb/shared'
import { appConfig } from './app/app.config'
import { App } from './app/app'

const { get, register, list } = window.ioc

// keep this as a value-use so the module can't be elided
void Store

const main = async (): Promise<void> => {

  // store is registered by side-effect in store.ts, but guard just in case
  let store: Store | null = null
  try { store = get('Store') as Store } catch { /* ignore */ }

  if (!store) {
    store = new Store()
    register('Store', store)
  }

  await store.initialize()

  // start listening before bootstrap emits popstate
  try {
    const nav = get('Navigation') as any
    nav?.listen?.()
  } catch {
    // ignore
  }

  // always rebuild the stack on refresh
  const history = get('BootstrapHistory') as BootstrapHistory
  await history.run()

  await bootstrapApplication(App, appConfig)
}

main().catch(err => console.error(err))
