// src/app/hypercomb.ts

import { Injectable, inject } from '@angular/core'
import { Router } from '@angular/router'
import { web } from './hypercomb.web'

@Injectable({ providedIn: 'root' })
export class hypercomb extends web {

  private readonly router = inject(Router)

  public override async write(text: string): Promise<void> {
    await this.router.navigateByUrl(
      `${window.location.pathname}/${text
        .replace(/[\/\\?:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()}`,
      { replaceUrl: true }
    )
  }
}
