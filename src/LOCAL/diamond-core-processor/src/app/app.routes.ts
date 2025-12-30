// src/app/app.routes.ts
import { Routes } from '@angular/router'

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./home/home.component').then(m => m.HomeComponent)
  },
  {
    path: 'inspect/:hash',
    loadComponent: () => import('./intent-inspector/intent-inspector-pro.component').then(m => m.IntentInspectorProComponent)
  },

  // legacy: allow /<hash> too (must be after inspect)
  {
    path: ':hash',
    loadComponent: () => import('./intent-inspector/intent-inspector-pro.component').then(m => m.IntentInspectorProComponent)
  }

  // keep wildcard out for now, or load home (don’t redirect)
]
