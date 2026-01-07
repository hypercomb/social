
export class StackEntry {
  private _gene: string = ""
  public get seed(): string { return this._gene }
  public ready = false

  constructor(seed?: string) {
    this._gene = seed ?? ""
    this.ready = true
  }
}
