// i-entity-factory-port.ts
import { Cell, CellKind, ClipboardCell, Ghost, Hive, NewCell, Pathway } from "src/app/cells/cell"
import { CellEntity } from "src/app/database/model/i-tile-entity"

/**
 * Generic mapping port for any entity/domain conversion.
 * TEntity → persistence model
 * TDomain → runtime domain model
 */
export interface IEntityFactoryPort<TEntity extends CellEntity, TDomain extends Cell | NewCell> {
  /** maps a database entity to a runtime domain object */
  map: (entity: TEntity) => TDomain

  /** maps a runtime domain object back to its database entity form */
  unmap: (domain: TDomain) => TEntity
}
