import { Hypercomb } from "src/app/actions/hypercomb-data";
import { Cell } from "src/app/models/cell-kind";


export abstract class LayoutSourceBase extends Hypercomb implements ILayoutSource {

    abstract getTiles(state: any): Promise<Cell[]>
    abstract canLayout(state: any): Promise<boolean>
}


