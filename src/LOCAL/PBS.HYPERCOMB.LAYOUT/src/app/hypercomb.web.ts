// src/app/core/hypercomb.ts

import { Injectable } from "@angular/core"

@Injectable()
export abstract class web {

  public commit = async (text: string): Promise<void> => {
    const value = text.trim()
    if (!value) return

    await this.write(value)
  }

  protected abstract write(text: string): Promise<void>
}
