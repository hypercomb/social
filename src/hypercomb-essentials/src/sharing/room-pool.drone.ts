// sharing/room-pool.drone.ts
//
// The bee that keeps a swarm room's pool: it holds the RoomPool service
// (room-pool.service.ts — a dependency, which exports and never registers)
// and registers it. Registration is the bee's act.

import { Drone } from '@hypercomb/core'
import { RoomPool, ROOM_POOL_KEY } from './room-pool.service.js'

export class RoomPoolDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'The swarm room as a pool on its host — what you share goes there as a signed member, and the room is read back from it when you join'

  protected override listens = ['swarm:page-announced', 'swarm:zone-complete']

  readonly service = new RoomPool()
}

const _roomPool = new RoomPoolDrone()
window.ioc.register('@diamondcoreprocessor.com/RoomPoolDrone', _roomPool)
window.ioc.register(ROOM_POOL_KEY, _roomPool.service)
