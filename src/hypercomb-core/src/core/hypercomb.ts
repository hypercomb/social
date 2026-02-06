import { get } from '../ioc/ioc.js'
import { DRONE_RESOLVER_KEY, DroneResolver } from './drone-resolver.js'
import { web } from './hypercomb.web.js'

export class hypercomb extends web {
  public override act = async (grammar: string = ''): Promise<void> => {

    const resolver = get<DroneResolver>(DRONE_RESOLVER_KEY)!

    // invariant: resolver always exists
    const drones = await resolver.find(grammar)

    for (const drone of drones) {
      await drone.encounter(grammar)
    }
  }
}
