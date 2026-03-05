import { Bee } from '../bee.base.js'

export interface BeeResolver {
  find(input: string): Promise<Bee[]>
}

export const BEE_RESOLVER_KEY = 'hypercomb:bee-resolver'
