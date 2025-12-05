// import { Injectable } from '@angular/core'
// import { Cell } from '../../../models/honeycomb'
// import { IAction } from '../click-commands/i-command'
// import { HexagonFactory } from '../../tiles/honeycomb-factory'
// import { LayoutState } from 'src/app/state/layout-state'
// import { HoneycombType } from '../../hexagons/enumerations'

// @Injectable({
//     providedIn: 'root'
// })
// export class RenderBackgroundCommand implements IAction<Cell> {
//     constructor(
//         private hexagonFactory: HexagonFactory,
//         private layout: LayoutState) { }

//     public execute = async (data: Cell) => {
//         // Create and add the white background to the stage with clipping
//         const { whiteBg, mask } = this.hexagonFactory.addWhiteBackground(data)
//         this.container.addChild(whiteBg, mask)
//     }

//     public canExecute = async (data: Cell): Promise<boolean> => {
       
//         if (datasourcePath.indexOf('new-placeholder.png') > -1) return false
//         if (data.Type == HoneycombType.Server) return true
//         if (data.name == '' && data.blob == undefined && datasourcePath == '' && data.isBranch === false && data.link == '') return false
//         return true
//     }

// }


