import { Injectable } from '@angular/core'
import { Cell } from 'src/app/cells/cell'

export interface IPropertyMapper<T> {
    sourceProperty: string
    targetProperty: keyof T
}

@Injectable({ providedIn: 'root' })
export class TilePropertyMapper {
    public mapProperties(data: Cell[], mappers: IPropertyMapper<Cell>[]): Cell[] {
        return data.map((item) => {
            const mappedItem = new Cell(item)
            for (const mapper of mappers) {
                this.map(mapper, item, mappedItem)
            }
            return mappedItem
        })
    }

    public map(mapper: IPropertyMapper<Cell>, from: Cell, mappedItem: Cell) {
        mappedItem ??= new Cell(from)
        if (mapper.sourceProperty in from) {
            (mappedItem as any)[mapper.targetProperty] = (from as any)[mapper.sourceProperty]
            delete (mappedItem as any)[mapper.sourceProperty]
        }
    }
}