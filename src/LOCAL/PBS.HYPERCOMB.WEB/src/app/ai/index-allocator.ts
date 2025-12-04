import { Injectable } from "@angular/core"

@Injectable({ providedIn: "root" })
export class IndexAllocator {

  public nextFreeIndex(used: number[]): number {
    let i = 0
    while (used.includes(i)) i++
    return i
  }
}
