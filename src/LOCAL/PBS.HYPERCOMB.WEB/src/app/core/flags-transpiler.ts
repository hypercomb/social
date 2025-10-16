export class FlagTranspiler<T extends number> {
    constructor(private readonly names: Record<T, string>) { }

    // mask → ["Branch", "Hidden"]
    public toStrings(mask: number): string[] {
        return (Object.keys(this.names) as unknown as T[])
            .filter(k => (mask & (k as unknown as number)) === (k as unknown as number) && k !== 0)
            .map(k => this.names[k])
    }

    // ["Branch", "Hidden"] → mask
    public toMask(names: string[]): number {
        return names.reduce((mask, name) => {
            const entry = Object.entries(this.names)
                .find(([, v]) => v === name)
            return entry ? mask | Number(entry[0]) : mask
        }, 0)
    }

}
