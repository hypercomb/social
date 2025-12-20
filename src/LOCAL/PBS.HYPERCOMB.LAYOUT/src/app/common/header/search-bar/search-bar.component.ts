import { Component, ElementRef, ViewChild, AfterViewInit, inject } from '@angular/core'
import { IntentPipeline } from '../../../core/intent/intent.pipeline'

@Component({
  selector: 'hc-search-bar',
  standalone: true,
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent implements AfterViewInit {
  private readonly intentPipeline = inject(IntentPipeline)

  @ViewChild('input', { static: true })
  private readonly input!: ElementRef<HTMLInputElement>

  public ngAfterViewInit(): void {
    // keep focus so speech always lands here
    this.input.nativeElement.focus()
  }

  public commit = async (value: string): Promise<void> => {
    const text = value.trim()
    if (!text) return

    await this.intentPipeline.ingestText(text)

    value = ''
  }
}
