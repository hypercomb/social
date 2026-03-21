// meadowverse/src/main.ts
// thin runtime harness — boots the processor, lets bees run
/// <reference path="../../hypercomb-shared/global.d.ts" />
import '../../hypercomb-shared/core/ioc.web'

import { BEE_RESOLVER_KEY, hypercomb } from '@hypercomb/core'
import { DependencyLoader } from '../../hypercomb-shared/core'
import { ensureInstall } from './ensure-install'
import { resolveImportMap } from './resolve-import-map'

// ensure side-effect registration
const _deps = [DependencyLoader]

const ensureSwControl = async (): Promise<void> => {
  if (!('serviceWorker' in navigator)) return

  await navigator.serviceWorker.register('/meadowverse.worker.js', { scope: '/' })
  await navigator.serviceWorker.ready

  if (navigator.serviceWorker.controller) return

  await new Promise<void>(resolve => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
    setTimeout(resolve, 3000)
  })
}

const attachImportMap = async (): Promise<void> => {
  const imports = await resolveImportMap()

  const script = document.createElement('script')
  script.type = 'importmap'
  script.textContent = JSON.stringify({ imports }, null, 2)
  document.head.appendChild(script)

  await Promise.resolve()
}

const bootstrap = async (): Promise<void> => {
  console.log('[meadowverse] booting...')

  await ensureSwControl()
  await ensureInstall()
  await attachImportMap()

  // load dependency namespaces so services self-register
  const loader = get('@hypercomb.social/DependencyLoader') as DependencyLoader | undefined
  await loader?.load?.()

  // wire up the bee resolver
  const preloader = get('@hypercomb.social/ScriptPreloader')
  if (preloader) {
    register(BEE_RESOLVER_KEY, preloader)
  }

  // derive grammar from the URL path
  const grammar = window.location.pathname.replace(/^\/+/, '') || ''

  // run the processor — find bees, pulse them, synchronize
  const processor = new hypercomb()
  await processor.act(grammar)

  console.log('[meadowverse] ready')
}

bootstrap().catch(err => console.error('[meadowverse] boot failed', err))
