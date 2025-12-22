import { Component, ElementRef, ViewChild, AfterViewInit, inject } from '@angular/core'

@Component({
  selector: 'hc-search-bar',
  standalone: true,
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent implements AfterViewInit {

  private readonly hypercomb = inject(Hypercomb)

  @ViewChild('input', { static: true })
  private readonly input!: ElementRef<HTMLInputElement>

  public ngAfterViewInit(): void {
    // keep focus so speech always lands here
    this.input.nativeElement.focus()
  }

  public commit = async (value: string): Promise<void> => {
    await this.hypercomb.commitText(value)
    this.input.nativeElement.value = ''
  }
}
