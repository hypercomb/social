// hypercomb-shared/ui/command-line/command-line.atomizer.ts
//
// Registers the command line input as an atomizable drop target.
// When an atomizer that targets 'input' is dragged over, the command
// input lights up. On drop, the atomizer can inspect and configure it.

import type { AtomizableTarget } from '@hypercomb/core'
import { ATOMIZABLE_TARGET_PREFIX } from '@hypercomb/core'

/**
 * Registers the command-line input element as an atomizable target.
 * Called once after the DOM is ready.
 */
export function registerCommandLineTarget(): void {
  const input = document.querySelector('.command-input') as HTMLInputElement | null
  if (!input) {
    // Retry after DOM settles
    requestAnimationFrame(() => registerCommandLineTarget())
    return
  }

  const target: AtomizableTarget = {
    targetType: 'input',
    targetId: 'command-line-input',
    element: input,
  }

  const ioc = (globalThis as any).ioc
  ioc?.register(`${ATOMIZABLE_TARGET_PREFIX}input:command-line`, target)
}

// Auto-register when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => registerCommandLineTarget())
} else {
  // DOM already loaded — wait one frame for Angular to render
  requestAnimationFrame(() => registerCommandLineTarget())
}
