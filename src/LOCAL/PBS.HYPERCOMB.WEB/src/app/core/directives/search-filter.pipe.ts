import { Pipe, PipeTransform } from '@angular/core'
import { Hive } from '../models/hive'

@Pipe({
  standalone: true,
  name: 'searchHives'
})
export class SearchHivesPipe implements PipeTransform {

  transform(items: Hive[], searchText: string): any[] {

    if (!items) return []
    if (!searchText) return items
    searchText = searchText.toLowerCase()
    return items.filter(item => item.Name.toLowerCase().includes(searchText))
  }
}


