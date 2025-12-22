// src/app/core/substrate/edge-store.service.ts

import { Injectable, signal } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class EdgeStore {

  private readonly _edges = signal<Set<string>>(new Set())
  public readonly edges = this._edges.asReadonly()

  public add(edge: string): void {
    this._edges.update(s => {
      const n = new Set(s)
      n.add(edge)
      return n
    })
  }

  public remove(edge: string): void {
    this._edges.update(s => {
      const n = new Set(s)
      n.delete(edge)
      return n
    })
  }

  public has(edge: string): boolean {
    return this._edges().has(edge)
  }
}
