import { get } from '../ioc/ioc.js'
import { BEE_RESOLVER_KEY, BeeResolver } from './bee-resolver.js'
import { web } from './hypercomb.web.js'

export class hypercomb extends web {
  public override act = async (grammar: string = ''): Promise<void> => {
    try {
      const resolver = get<BeeResolver>(BEE_RESOLVER_KEY)
      const bees = resolver ? await resolver.find(grammar) : []

      for (const bee of bees) {
        await bee.pulse(grammar)
      }
    } finally {
      window.dispatchEvent(new Event('synchronize'))
    }
  }
}
