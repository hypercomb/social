import { Injectable } from '@angular/core'
import { IImportTransform } from './i-import-transform'
import DBTables from 'src/app/core/constants/db-tables'

@Injectable({ providedIn: 'root' })
export class DefaultImportTransform implements IImportTransform {
  supports(_: string): boolean {
    return true
  }

  transform(table: string, value: any, key?: any) {
    // example transformation logic

    // ensure arrays are present
    if (table === 'Cells') {
      value.tagIds = value.tagIds ?? []
      value.options = value.options ?? 0

      if (value.dateCreated) {
        value.dateCreated = new Date(value.dateCreated).toISOString()
      }
      if (value.dateDeleted) {
        value.dateDeleted = new Date(value.dateDeleted).toISOString()
      }
      if (value.updatedAt) {
        value.updatedAt = new Date(value.updatedAt).toISOString()
      }

      // strip legacy props
      delete (value as any).IsRoot
      delete (value as any).IsStub
    }

    return { value, key }
  }
}
