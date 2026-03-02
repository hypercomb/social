// hypercomb-shared/core/shared-providers.ts
//
// Bridge providers that connect Angular DI to the canonical window.ioc instances.
// Angular components use inject(Lineage) etc. — these factories ensure they get
// the SAME object that dynamic OPFS modules see via window.ioc.get('Lineage').
//
// Without this, @Injectable({ providedIn: 'root' }) causes Angular to create a
// SECOND instance, leaving Angular-side and dynamic-module-side state diverged.

import {
  bridgeProviders,
  COMPLETION_UTILITY,
  LINEAGE,
  MOVEMENT,
  NAVIGATION,
  RESOURCE_COMPLETION,
  RESOURCE_MSG_HANDLER,
  SCRIPT_PRELOADER,
} from './tokens'

export const sharedProviders = bridgeProviders([
  COMPLETION_UTILITY,
  LINEAGE,
  MOVEMENT,
  NAVIGATION,
  RESOURCE_COMPLETION,
  RESOURCE_MSG_HANDLER,
  SCRIPT_PRELOADER,
])
