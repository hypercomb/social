import { Pipe, PipeTransform } from '@angular/core'

@Pipe({
  standalone: true,
  name: 'sortByDate'
})
export class SortByDatePipe implements PipeTransform {

  transform(data: any[], descending: boolean = true): any[] {
    if (!data) return []

    return data.sort((a, b) => {
      const dateA = new Date(a.date).getTime()
      const dateB = new Date(b.date).getTime()

      return descending ? dateB - dateA : dateA - dateB
    })
  }
}

