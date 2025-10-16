import { Cell } from "../cell"


export class RestorableTileData extends Cell {
    public Id: number | undefined
    public TempId: number | undefined
    public TempSourceId: number | undefined
    public HasImageUpdate
    public IgnoreBackground
    public Base64Image
    public newItem: Cell | undefined

    constructor(cell: Cell) {
        super(cell)
        this.HasImageUpdate = false
        this.IgnoreBackground = false
        this.Base64Image = undefined
    }

}

