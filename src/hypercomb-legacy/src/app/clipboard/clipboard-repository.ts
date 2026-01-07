// clipboard-repository.ts
import { Injectable, inject } from '@angular/core'

import { CellEntity } from '../database/model/i-tile-entity'
import { MODIFY_COMB_SVC } from '../shared/tokens/i-honeycomb-service.token'
import { IClipboardRepository } from '../shared/tokens/i-clipboard-repository'
import { Cell } from '../models/cell'

@Injectable({ providedIn: 'root' })
export class ClipboardRepository implements IClipboardRepository {
    
    public addCell = async (cells: Clipboard[]): Promise<void> => {
        // if (!cells?.length) return;
        // for (const cell of cells) {
        //     // Assuming factory.create maps Clipboard to CellEntity
        //     const entity = await this.factory.create(cell);
        //     await this.modify.add(entity);
        // }
    }

    private readonly modify = inject(MODIFY_COMB_SVC);

    // Add cells to the clipboard

    // fetch everything under the clipboard root
    public fetchHierarchy = async (rootId: number): Promise<Cell[]> => {
//         // load root so we know hive + id
//         const rootEntity = await this.fetch(rootId);
//         if (!rootEntity) return [];

//         const root = await this.factory.map(rootEntity);
//         if (!root?.seed || !root.hive) return [];

//         const all: Cell[] = [];
//         const seen = new Set<number>();
//         const queue: Array<{ hive: string; parentId: number }> = [{ hive: root.hive, parentId: root.seed }];

//         // bfs over sourceId links
//         while (queue.length) {
//             const target = queue.shift()!;
//             const children = await this.fetchBySourceId(target.parentId);
//             if (!children?.length) continue;

//             const mapped = await Promise.all(children.map(c => this.factory.map(c)))
//             for (const child of mapped) {
//                 if (!child?.seed) continue;
//                 if (seen.has(child.seed)) continue;
//                 seen.add(child.seed);
//                 all.push(<Cell>child);

//                 if (child.hive) queue.push({ hive: child.hive, parentId: child.seed });
//             }
//         }
// ``
//         return all;
        return [];
    };

    // remove all children of clipboard root (but leave the root)
    public clearChildren = async (rootId: number): Promise<void> => {
        // const root = await this.fetch(rootId);
        // if (!root) return;

        // const cell = <Cell>await this.factory.map(root);
        // const hierarchy = await this.fetchHierarchy(rootId);
        // if (!hierarchy?.length) return;

        // const toDelete = hierarchy
        //     .filter(x => x.seed !== rootId)
        //     .map(x => x.seed!)
        //     .filter(Boolean);

        // if (!toDelete.length) return;
        // await this.modify.deleteAll(cell, hierarchy);
    };
}
