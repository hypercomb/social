// src/app/common/header/search-bar/search-bar.component.ts

import { AfterViewInit, Component, ElementRef, ViewChild, inject } from '@angular/core'
import { hypercomb } from '../../../hypercomb'

@Component({
  selector: 'hc-search-bar',
  standalone: true,
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent implements AfterViewInit {

  private readonly processor = inject(hypercomb)

  @ViewChild('input', { static: true })
  private readonly input!: ElementRef<HTMLInputElement>

  public ngAfterViewInit(): void {
    this.input.nativeElement.focus()
  }

  public onEnter = async (): Promise<void> => {
    const raw = this.input.nativeElement.value.trim()
    if (!raw) return

    // send intent only
    await this.processor.commit(raw)

    this.reset()
  }

  private reset(): void {
    this.input.nativeElement.value = ''
    this.input.nativeElement.focus()
  }
}
