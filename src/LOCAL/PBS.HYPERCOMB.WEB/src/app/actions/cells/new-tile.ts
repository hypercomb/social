import { effect, inject } from '@angular/core'
import { ActionBase } from '../action.base'
import { PayloadBase } from '../action-contexts'
import { AxialCoordinate } from 'src/app/core/models/axial-coordinate'

export class NewTileAction extends ActionBase<PayloadBase> {
    public static readonly ActionId = 'layout.new-tile'
    public override id: string = NewTileAction.ActionId

    private coordinate: AxialCoordinate | undefined

    constructor() {
        super()



    public override enabled = (payload: PayloadBase): boolean => {
        return !!this.coordinate
    }

    // creates a new tile only if the target coordinate is empty
    public run = async (payload: PayloadBase<Event>): Promise<void> => {
        // check for empty coordinate (computed signal or service value)

        const { x, y } = this.coordinate?.Location ?? { x: 0, y: 0 }
        const hiveName = this.stack.hiveName()

        // // create and persist new cell
        // const cell = await this.factory.map({ hive: hiveName, x, y })
        // const stored = await this.modify.addCell(cell)

    }
}
