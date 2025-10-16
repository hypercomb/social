import { Injectable } from '@angular/core'
import { ICellIdentifier } from '../model/i-tile-identifiers'

@Injectable({
  providedIn: 'root'
})
export class IdentifierService {
  private idQueue: number[] = []
  private existingIds: Set<number> = new Set()
  private readonly MAX_QUEUE_SIZE = 1000

  public initialize = async (identifiers: ICellIdentifier[]) => {
    try {
      this.existingIds = new Set(identifiers.map(item => item.cellId))
      this.buildIdQueue()
    } catch (error) {
      console.error('Error loading existing Ids:', error)
    }
  }

  private buildIdQueue() {
    let potentialId = 1
    while (this.idQueue.length < this.MAX_QUEUE_SIZE) {
      if (!this.existingIds.has(potentialId)) {
        this.idQueue.push(potentialId)
      }
      potentialId++
    }
  }

  public getNextId(): number | null {
    if (this.idQueue.length === 0) {
      this.buildIdQueue()
    }
    const id = this.idQueue.shift() ?? null
    if (id !== null) {
      this.existingIds.add(id)
    }
    return id
  }

  public markAsUsed(id: number) {
    if (!this.existingIds.has(id)) {
      this.existingIds.add(id)
      this.idQueue = this.idQueue.filter(queuedId => queuedId !== id)
    }
  }

  public releaseId(id: number) {
    if (this.existingIds.has(id)) {
      this.existingIds.delete(id)
      if (!this.idQueue.includes(id)) {
        this.idQueue.push(id)
      }
    }
  }

  /** bulk release multiple IDs at once */
  public bulkReleaseIds(ids: number[]) {
    ids.forEach(id => this.releaseId(id))
  }

  /** bulk mark multiple IDs as used */
  public bulkMarkAsUsed(ids: number[]) {
    ids.forEach(id => this.markAsUsed(id))
  }
}


