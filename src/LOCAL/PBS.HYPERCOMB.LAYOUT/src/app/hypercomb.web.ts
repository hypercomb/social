// src/app/hypercomb.web.ts

import { Injectable, OnDestroy } from '@angular/core'

@Injectable()
export abstract class web implements OnDestroy {

  constructor() {
    window.addEventListener('popstate', this.onPopState)
  }

  protected onPopState = (): void => {/* subclasses may override */ }

  public ngOnDestroy(): void {
    window.removeEventListener('popstate', this.onPopState)
  }

  public abstract act(text: string): Promise<void>
}
