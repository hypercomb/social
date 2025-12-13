
export class StackEntry {
  private _gene: string = ""
  public get gene(): string { return this._gene }
  public ready = false

  constructor(gene?: string) {
    this._gene = gene ?? ""
    this.ready = true
  }
}
