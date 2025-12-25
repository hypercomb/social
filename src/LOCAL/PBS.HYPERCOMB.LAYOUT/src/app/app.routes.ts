// src/app/app.routes.ts

import { Routes, UrlMatchResult, UrlSegment } from '@angular/router'
import { Home } from './home/home'

export const lineageMatcher = (segments: UrlSegment[]): UrlMatchResult => ({
  consumed: segments
})

export const routes: Routes = [
  {
    matcher: lineageMatcher,
    component: Home
  }
]
  