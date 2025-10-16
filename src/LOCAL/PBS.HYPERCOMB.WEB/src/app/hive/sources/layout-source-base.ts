import { DataServiceBase } from "src/app/actions/service-base-classes";
import { Cell } from "src/app/cells/cell";


export abstract class LayoutSourceBase extends DataServiceBase implements ILayoutSource {

    abstract getTiles(state: any): Promise<Cell[]>
    abstract canLayout(state: any): Promise<boolean>
}


