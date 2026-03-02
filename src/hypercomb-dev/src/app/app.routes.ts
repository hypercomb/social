// hypercomb-dev/src/app/app.routes.ts

import type { Routes, UrlMatchResult, UrlSegment } from '@angular/router'
import { RouteSinkComponent } from './router/route-sink.component'

export const lineageMatcher = (segments: UrlSegment[]): UrlMatchResult => ({
  consumed: segments
})

export const routes: Routes = [
  {
    // accepts any url segments so angular router never blocks deep links
    matcher: lineageMatcher,
    component: RouteSinkComponent
  }
]

export class AppRoutes {
  public readonly routes = routes
  public readonly matcher = lineageMatcher
}

register('@hypercomb.social/AppRoutes', new AppRoutes(), 'AppRoutes')
