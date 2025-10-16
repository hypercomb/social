import { CellOptions, TileOptionsFromName, CellOptionNames } from "./cell-options";

// utilities for working with tile flags
export const TileOptionsUtils = {
    /**
     * parse array of names → bitmask
     */
    parseFlags: (names: string[]): CellOptions =>
        names
            .map(n => TileOptionsFromName[n])
            .filter((f): f is CellOptions => f !== undefined)
            .reduce((acc, f) => acc | f, CellOptions.None),

    /**
     * expand bitmask → array of names
     */
    toNames: (flags: CellOptions): string[] =>
        Object.entries(CellOptionNames)
            .filter(([key]) => (flags & Number(key)) !== 0)
            .map(([, name]) => name),

    /**
     * check if all flags are set
     */
    hasAll: (flags: CellOptions, required: CellOptions): boolean =>
        (flags & required) === required,

    /**
     * check if any flag is set
     */
    hasAny: (flags: CellOptions, candidates: CellOptions): boolean =>
        (flags & candidates) !== 0,

    /**
     * check if none of the given flags are set
     */
    hasNone: (flags: CellOptions, forbidden: CellOptions): boolean =>
        (flags & forbidden) === 0,

    /**
     * toggle a single flag
     */
    toggle: (flags: CellOptions, flag: CellOptions): CellOptions =>
        (flags & flag) ? (flags & ~flag) : (flags | flag),
}
