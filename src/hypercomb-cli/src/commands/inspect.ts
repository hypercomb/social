import * as keys from '@hypercomb/sdk'

export async function runInspect(args: string[]): Promise<void> {
  const showKeys = args.includes('--keys') || args.length === 0
  const showRegistry = args.includes('--registry')

  if (showKeys) {
    console.log('[hypercomb] IoC key constants:\n')

    console.log('  Framework:')
    console.log(`    BEE_RESOLVER_KEY = ${keys.BEE_RESOLVER_KEY}`)

    console.log('\n  Shared services:')
    console.log(`    COMPLETION_UTILITY    = ${keys.COMPLETION_UTILITY}`)
    console.log(`    LINEAGE               = ${keys.LINEAGE}`)
    console.log(`    MOVEMENT              = ${keys.MOVEMENT}`)
    console.log(`    NAVIGATION            = ${keys.NAVIGATION}`)
    console.log(`    RESOURCE_COMPLETION   = ${keys.RESOURCE_COMPLETION}`)
    console.log(`    RESOURCE_MSG_HANDLER  = ${keys.RESOURCE_MSG_HANDLER}`)
    console.log(`    SCRIPT_PRELOADER      = ${keys.SCRIPT_PRELOADER}`)
  }

  if (showRegistry) {
    console.log('\n[hypercomb] live IoC registry:\n')
    const registered = keys.ioc.list()
    if (registered.length === 0) {
      console.log('  (empty — no services registered in this environment)')
    } else {
      for (const key of registered) {
        console.log(`    ${key}`)
      }
    }
  }
}
