import { Injectable, Injector } from "@angular/core"
import { Cell } from "src/app/cells/cell"
import { combId, sourceKey } from "src/app/cells/models/cell-filters"
import { NotifyTileUpdate } from "../requests/notify-tile-update"

@Injectable({
    providedIn: 'root'
})
export class HandleHiveSynchronization extends MessageHandler {
    public override get method(): string { return HandleHiveSynchronization.name }

    constructor(override injector: Injector, private notifyTileUpdate: NotifyTileUpdate) {
        super(injector)
    }

    protected override onHandle = async (...args: any) => {

        const [_, hive,cellIdntifiers] = args

        try {
            const cell = await this.tile_queries.fetchByHive(hive)
            const identifiers = await this.CellManager.getIdentifiers(cell)
            const identifierMap = this.createIdentifierMap(identifiers)

            const changedIdentifiers = this.getChangedIdentifierscellIdntifiers, identifierMap)
            const newIdentifiers = this.getNewIdentifiers(identifiers,cellIdntifiers)

            const changedData = await this.fetchDataForIdentifiers(cell, changedIdentifiers)
            const newData = await this.fetchDataForIdentifiers(cell, newIdentifiers)

            const allDataToSend = [...changedData, ...newData]
            await this.sendUpdates(allDataToSend)
        } catch (error) {
            this.debug.log('error', 'Error processing identifiers:', error)
        }
    }


    private async sendUpdates(dataItems: any[]) {
        const sorted = []
        this.getHierarchySortedItems(dataItems, sorted)
        // get the root items
        for (const data of sorted) {
            try {
                setTimeout(async () => {
                    await this.notifyTileUpdate.send([data])
                }, 20)
            } catch (error) {
                this.debug.log('error', 'Failure sending update for tile:', error)
            }
        }
    }

    private getHierarchySortedItems(dataItems: Cell[], output: Cell[] = []) {
        const identifiers = dataItems.map(t => t.HiveId)
        const items = dataItems.filter(item => !identifiers.some(i => item.SourceKey === i))
        const remainingItems = dataItems.filter(item => !items.some(s => s.uniqueId === item.uniqueId))

        output.push(...items)

        if (remainingItems.length > 0) {
            this.getHierarchySortedItems(remainingItems, output)
        }
    }



    private createIdentifierMap(identifiers: any[]): Map<string, string> {
        const identifierMap = new Map<string, string>()
        for (const identifier of identifiers) {
            identifierMap.set(identifier.uniqueId, identifier.Hashcode)
        }
        return identifierMap
    }

    private getChangedIdentifierscellIdntifiers: any[], identifierMap: Map<string, string>): any[] {
        returncellIdntifiers.filtercellIdntifier => {
            const storedHashcode = identifierMap.getcellIdntifier.uniqueId)
            return storedHashcode !== undefined && storedHashcode !==cellIdntifier.Hashcode
        })
    }

    private getNewIdentifiers(identifiers: any[],cellIdntifiers: any[]): any[] {
        constcellIdntifierSet = new SetcellIdntifiers.map(ti => ti.uniqueId))
        return identifiers.filter(identifier => cellIdntifierSet.has(identifier.uniqueId))
    }

    private async fetchDataForIdentifiers(cell: Cell[], identifiers: any[]): Promise<any[]> {
        const data: any[] = []
        for (const identifier of identifiers) {
            try {
                const fetchedData = cell.find(t => t.uniqueId === identifier.uniqueId)
                    ; (<any>fetchedData).SourceUniqueId = cell.find(t => combId(t) == sourceKey(fetchedData!))?.uniqueId

                if (!(<any>fetchedData).SourceUniqueId) continue
                data.push(fetchedData)
            } catch (error) {
                this.debug.log('error', `Failure fetching data for identifier ${identifier.uniqueId}:`, error)
            }
        }

        return data
    }
}



