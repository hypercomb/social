import { inject, Injectable } from '@angular/core'
import { CELL_REPOSITORY } from '../shared/tokens/i-cell-repository.token'

@Injectable({ providedIn: 'root' })
export class HierarchyService {

  public build(hierarchyText: string) {
    const json = JSON.parse(hierarchyText)
    console.log(json)
  }

}
