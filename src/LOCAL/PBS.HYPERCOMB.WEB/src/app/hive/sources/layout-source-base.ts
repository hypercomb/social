import { HypercombData } from "src/app/actions/hypercomb-data";
import { Cell } from "src/app/cells/cell";


export abstract class LayoutSourceBase extends HypercombData implements ILayoutSource {

    abstract getTiles(state: any): Promise<Cell[]>
    abstract canLayout(state: any): Promise<boolean>
}


