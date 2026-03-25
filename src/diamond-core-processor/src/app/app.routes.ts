// diamond-core-processor/src/app/app.routes.ts

import { Routes } from '@angular/router'

export const routes: Routes = [
  { path: '', loadComponent: () => import('./home/home.component').then(m => m.HomeComponent) },
  { path: 'sentinel', loadComponent: () => import('./sentinel/sentinel.component').then(m => m.SentinelComponent) },
  { path: 'inspect/:hash', loadComponent: () => import('./intent-inspector/intent-inspector-pro.component').then(m => m.IntentInspectorProComponent) },
  { path: ':hash', loadComponent: () => import('./intent-inspector/intent-inspector-pro.component').then(m => m.IntentInspectorProComponent) }
]
