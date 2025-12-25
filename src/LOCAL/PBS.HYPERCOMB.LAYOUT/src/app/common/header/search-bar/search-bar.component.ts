import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core'
import { hypercomb } from '../../../hypercomb'

@Component({
  selector: 'hc-search-bar',
  standalone: true,
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss']
})
export class SearchBarComponent extends hypercomb implements AfterViewInit {

  @ViewChild('input', { static: true }) private readonly input!: ElementRef<HTMLInputElement>

  public ngAfterViewInit(): void { this.input.nativeElement.focus() }

  public commit = async (): Promise<void> => {
    const v = this.input.nativeElement.value.trim()
    if (!v) return
    await this.act(v)
    this.input.nativeElement.value = ''
  }
}
