// src/app/app.routes.ts

import { Routes, UrlMatchResult, UrlSegment } from '@angular/router'
import { OpfsExplorerComponent } from './common/file-explorer/opfs-explorer.component'

export const lineageMatcher = (
  segments: UrlSegment[]
): UrlMatchResult | null => {

  // match everything, including empty
  return {
    consumed: segments,
    posParams: {
      lineage: new UrlSegment(
        segments.map(s => s.path).join('/'),
        {}
      )
    }
  }
}

export const routes: Routes = [
  {
    matcher: lineageMatcher,
    component: OpfsExplorerComponent
  }
]
