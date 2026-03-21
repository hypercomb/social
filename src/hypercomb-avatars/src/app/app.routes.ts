import type { Routes, UrlMatchResult, UrlSegment } from '@angular/router'
import { RouteSinkComponent } from './router/route-sink.component'

export const lineageMatcher = (segments: UrlSegment[]): UrlMatchResult => ({
  consumed: segments,
})

export const routes: Routes = [
  {
    matcher: lineageMatcher,
    component: RouteSinkComponent,
  },
]

export class AppRoutes {
  public readonly routes = routes
  public readonly matcher = lineageMatcher
}

register('@hypercomb.social/AppRoutes', new AppRoutes())
