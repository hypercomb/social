// src/app/core/pathways/pathway-registry.service.ts

import { Injectable } from '@angular/core'
import { Pathway } from './pathway.model'

@Injectable({ providedIn: 'root' })
export class PathwayRegistry {

  private readonly pathways = new Map<string, Pathway<any>>()

  public register<T>(pathway: Pathway<T>): void {
    this.pathways.set(pathway.key, pathway)
  }

  public get<T>(key: string): Pathway<T> | undefined {
    return this.pathways.get(key)
  }
}
