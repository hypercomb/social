// src/app/hypercomb.ts

import { Injectable } from '@angular/core'
import { web } from './hypercomb.web'

@Injectable({ providedIn: 'root' })
export abstract class hypercomb extends web {

  public readonly path = (): string => window.location.pathname
  public readonly segments = (): readonly string[] => this.path().split('/').filter(Boolean)
  public readonly depth = (): number => this.segments().length
  public readonly active = (): string => this.segments().at(-1)!

  public override write = async (text: string): Promise<void> => {
    const clean = text.replace(/[\/\\?:]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!clean) return
    const next = this.path() === '/' ? `/${clean}` : `${this.path()}/${clean}`
    window.history.pushState(null, '', next)
  }
}
