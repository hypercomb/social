import { Injectable, inject } from '@angular/core'
import { hypercomb } from '@hypercomb/core'

@Injectable({ providedIn: 'root' })
export class ProcessorHost extends hypercomb {

  public start(): void {
    window.addEventListener('navigate', this.onNavigate)
  }

  private readonly onNavigate = async (
    e: Event
  ): Promise<void> => {
    const { segments } =
      (e as CustomEvent<{ segments: string[] }>).detail

    // always act root first
    await this.act('')

    // then act each grammar in order
    for (const seg of segments) {
      await this.act(seg)
    }
  }
}
