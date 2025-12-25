// src/app/hypercomb.web.ts

import { Injectable, OnDestroy } from '@angular/core'

@Injectable()
export abstract class web  {
  public abstract act(text: string): Promise<void>
}
