// diamondcoreprocessor.com/sharing/facade.nurse.ts
//
// FacadeNurse — tends each cell's `0000.facade` flag.
//
// A facade cell is a tile materialised on a receiver from an approved
// paired-channel share, where only the structural skeleton (name +
// reference to the source layer sig) has been written so far. Its
// children may be empty folders. Clicking the sync icon recursively
// pulls the rest of the layer tree from the channel's buffer and
// drops the facade flag.
//
// Same NurseBee pattern as IndexNurse — sync peek, write-through cache
// invalidated by `cell:0000-changed` broadcasts from
// writeCellProperties.

import { NurseBee } from '../history/nurse.bee.js'

export class FacadeNurse extends NurseBee<boolean> {

  readonly namespace = 'diamondcoreprocessor.com'
  readonly attribute = 'facade'

  protected parse(raw: unknown): boolean | undefined {
    if (typeof raw !== 'boolean') return undefined
    return raw === true ? true : undefined  // only `true` is meaningful
  }
}

const _facadeNurse = new FacadeNurse()
;(window as any).ioc?.register?.(_facadeNurse.iocKey, _facadeNurse)
