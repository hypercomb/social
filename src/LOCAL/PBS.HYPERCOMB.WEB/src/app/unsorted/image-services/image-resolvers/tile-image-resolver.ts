// import { Injectable } from "@angular/core"
// import { ImageDatabase } from "../../data/images/hypercomb-image-database"
// import { EditorService } from "src/app/state/editor-state"
// import { Constants } from "src/app/helper/constants"
// import { TileImageState } from "src/app/state/tile-image-state"

// @Injectable({ providedIn: 'root' })
// export class TileImageResolver {
//     protected get defaultImage(): string { return 'assets/default-image.svg' }
//     constructor(private editorState: EditorService, 
//         private imageDatabase: ImageDatabase,
//         private tileImageState: TileImageState
//     ) { }

//     public resolve = async () => {
//         const tile = this.editorState.tile
//         if (!tile) return
        
//         // get from dropped file
//         if (this.editorState.file) {
//             this.editorState.setBlob(this.editorState.file)
//             return
//         }

//         // get from database
//         const data = tile.data!
//         const { url } = await this.imageDatabase.retrieve(data.hiveId)

//         // store from database or dropped file large image
//         if (url) {

//             this.editorState.sourceUrl = url
//             this.tileImageState.x = tile.data.X
//             this.tileImageState.y = tile.data.Y
//             this.tileImageState.scale = tile.data.Scale
//             return
//         }

//         // store from saved blob in record
//         this.editorState.setBlob(data.blob)

//         // get from hypercomb server
//         if ( datasourcePath && !this.editorState.sourceUrl && !datasourcePath.includes('assets/')) {
//             if(datasourcePath.startsWith('https')){
//                 this.editorState.sourceUrl = datasourcePath
//             }
//             else { 
//                 const storage = Constants.storage
//                 this.editorState.sourceUrl = `${storage}${datasourcePath}`
//             }
//         }
//     }
// }


