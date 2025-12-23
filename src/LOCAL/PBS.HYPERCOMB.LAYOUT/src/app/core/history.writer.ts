// src/app/core/history.writer.ts

import { Injectable } from '@angular/core'
import { Location } from '@angular/common'
import { formatLineage } from './lineage'

@Injectable({ providedIn: 'root' })
export class HistoryWriter {

  constructor(private readonly location: Location) {}

  public replace = (lineage: string[]): void => {
    this.location.replaceState(formatLineage(lineage))
  }
}
