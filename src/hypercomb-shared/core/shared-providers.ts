// hypercomb-shared/core/shared-providers.ts
//
// Bridge providers that connect Angular DI to the canonical window.ioc instances.
// Angular components use inject(Lineage) etc. — these factories ensure they get
// the SAME object that dynamic OPFS modules see via window.ioc.get('Lineage').
//
// Without this, @Injectable({ providedIn: 'root' }) causes Angular to create a
// SECOND instance, leaving Angular-side and dynamic-module-side state diverged.

import type { Provider } from '@angular/core'
import { CompletionUtility } from './completion-utility'
import { Lineage } from './lineage'
import { MovementService } from './movement.service'
import { Navigation } from './navigation'
import { ScriptPreloader } from './script-preloader'

export const sharedProviders: Provider[] = [
  { provide: CompletionUtility, useFactory: () => window.ioc.get('CompletionUtility') as CompletionUtility },
  { provide: Lineage, useFactory: () => window.ioc.get('Lineage') as Lineage },
  { provide: MovementService, useFactory: () => window.ioc.get('MovementService') as MovementService },
  { provide: Navigation, useFactory: () => window.ioc.get('Navigation') as Navigation },
  { provide: ScriptPreloader, useFactory: () => window.ioc.get('ScriptPreloader') as ScriptPreloader },
]
