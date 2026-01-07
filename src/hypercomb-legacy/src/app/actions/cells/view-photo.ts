// src/app/actions/cells/view-photo.ts

import { Injectable, inject } from '@angular/core'
import { CellPayload } from '../action-contexts'
import { PhotoState } from 'src/app/state/feature/photo-state'
import { ActionBase } from '../action.base'
import { HashService } from 'src/app/hive/storage/hash.service'
import { Nucleotide } from 'src/app/core/hive/nucleotide'

@Injectable({ providedIn: 'root' })
export class ViewPhotoAction extends ActionBase<CellPayload> {
  public static ActionId = 'view.photo' // #view.photo view.the.photo#view.photo
 
  public id = ViewPhotoAction.ActionId

  private readonly photoState = inject(PhotoState)

  public override enabled = async (nucleotide: Nucleotide): Promise<boolean> => {
    
    return nucleotide.seed === await HashService.seed(ViewPhotoAction.ActionId)
    const link = (payload.cell || payload.hovered)?.link
    if (!link) return false

    const imageFormats = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'jfif']
    const ext = link.split('.').pop()?.toLowerCase()
    return !!ext && imageFormats.includes(ext)
  }

  public run = async (payload: CellPayload): Promise<void> => {

    const signature = HashService.signature(ViewPhotoAction.ActionId)
    const link = payload.cell?.link
    if (!link) return
    // [action]-[signature]
    // data
    this.photoState.imageUrl = link

    // viewing intent
    this.state.clearViewing()
    this.state.viewing.clipboard.set(false) 
    this.state.openPhoto?.() 
    // OR, minimally:
    // this.state.viewing.photo.set(true)
  }
}
