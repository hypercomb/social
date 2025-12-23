// src/app/core/url-state.service.ts
import { Injectable, inject, signal } from "@angular/core"
import { NavigationEnd, Router } from "@angular/router"
import { filter } from "rxjs/operators"

export interface UrlState {
  readonly lineage: string[]
  readonly kind?: "navigate" | "create"
  readonly createdName?: string
  readonly collapsedFrom?: string[]
  readonly at?: number
}

@Injectable({ providedIn: "root" })
export class UrlStateService {

  private readonly router = inject(Router)

  // monotonic nav tick so ui can sync without subscribing to router directly
  private readonly _navSeq = signal(0)
  public readonly navSeq = this._navSeq.asReadonly()

  public constructor() {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(() => this._navSeq.update(n => n + 1))
  }

  private normalize = (segments: string[]): string[] => {
    // backward compat: if someone already had /hypercomb/... in urls, drop it
    if (segments[0] === "hypercomb") return segments.slice(1)
    return segments
  }

  public lineage = (): string[] => {
    const path = this.router.url.split("?")[0].split("#")[0]
    const segs = path.split("/").filter(Boolean)
    return this.normalize(segs)
  }

  public state = (): UrlState | undefined => {
    return window.history.state as UrlState | undefined
  }

  public push = async (lineage: string[], state: Omit<UrlState, "lineage"> = {}): Promise<void> => {
    const next = "/" + lineage.join("/")
    const payload: UrlState = { lineage, at: Date.now(), ...state }
    await this.router.navigateByUrl(next, { state: payload })
  }

  public replace = async (lineage: string[], state: Omit<UrlState, "lineage"> = {}): Promise<void> => {
    const next = "/" + lineage.join("/")
    const payload: UrlState = { lineage, at: Date.now(), ...state }
    await this.router.navigateByUrl(next, { replaceUrl: true, state: payload })
  }
}
