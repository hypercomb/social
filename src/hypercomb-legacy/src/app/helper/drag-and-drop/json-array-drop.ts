import { inject, Injectable } from '@angular/core'
import { JsonHierarchyImporter } from 'src/app/database/json-hierarchy-importer'
import { Hypercomb } from '../../core/mixins/abstraction/hypercomb.base'
import { IDropDispatcher } from './i-drop-dispatcher'

@Injectable({
    providedIn: 'root'
})
export class JsonArrayDropDispatcher extends Hypercomb implements IDropDispatcher {
    private jsonHierarchyImporter = inject(JsonHierarchyImporter)

    canDispatch(event: DragEvent): boolean {
        const dataTransfer = event.dataTransfer!
        const typesToCheck = ['text/uri-list', 'text/html', 'Files']

        if (typesToCheck.some(type => dataTransfer.types.includes(type))) {
            return false
        }

        const json = JSON.parse(dataTransfer.getData('text/plain'))

        let valid = false
        if (!json.isList) {
            valid = false
        }
        else {
            valid = true
        }
        this.debug.log('clipboard', `${JsonArrayDropDispatcher.name} valid: ${valid}`)
        return valid

    }

    public dispatch = async (event: DragEvent): Promise<boolean> => {
        const dataTransfer = event.dataTransfer!
        const json = JSON.parse(dataTransfer.getData('text/plain'))
        const list = json
        await this.jsonHierarchyImporter.createTiles(list)
        return true
    }

}


