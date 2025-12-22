// src/app/common/header/search-bar/search-bar.component.ts

import { AfterViewInit, Component, ElementRef, HostListener, ViewChild, inject } from "@angular/core"
import { hypercomb } from "../../../hypercomb"

@Component({
  selector: "hc-search-bar",
  standalone: true,
  templateUrl: "./search-bar.component.html",
  styleUrls: ["./search-bar.component.scss"]
})
export class SearchBarComponent implements AfterViewInit {

  // core engine
  private readonly hyper = inject(hypercomb)

  // input element
  @ViewChild("input", { static: true })
  private readonly input!: ElementRef<HTMLInputElement>

  public ngAfterViewInit(): void {
    // always keep focus so speech + keyboard land here
    this.input.nativeElement.focus()
  }

  // keyboard commit (enter)
  @HostListener("keydown.enter")
  public onEnter = async (): Promise<void> => {
    const value = this.input.nativeElement.value
    await this.commit(value)
  }

  // explicit commit (button / speech)
  public commit = async (value: string): Promise<void> => {
    const text = value.trim()
    if (!text) {
      console.debug("[search-bar] empty commit ignored")
      return
    }

    console.debug("[search-bar] committing:", text)

    await this.hyper.commit(text)

    // clear + refocus for continuous flow
    this.input.nativeElement.value = ""
    this.input.nativeElement.focus()
  }
}
