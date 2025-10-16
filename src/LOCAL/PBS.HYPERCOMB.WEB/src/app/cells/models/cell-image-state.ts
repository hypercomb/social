import { Injectable } from "@angular/core"

@Injectable({ providedIn: 'root' })
export class TileImageState { 
  public scale: number = 1
  public x: number = 0
  public y: number = 0
  public width:number = 0
  public height:number = 0
}


