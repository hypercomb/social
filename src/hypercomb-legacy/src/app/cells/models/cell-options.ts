// src/app/tile/models/tile-options.ts

// bit flags for tile state
export enum CellOptions {
    None = 0,
    Active = 1 << 0,
    Branch = 1 << 1,
    Deleted = 1 << 2,
    Hidden = 1 << 3,
    IgnoreBackground = 1 << 4,
    Selected = 1 << 5,
    FocusedMode = 1 << 6,
    Locked = 1 << 7,
    NoImage = 1 << 8,
    InitialTile = 1 << 9,

    Recenter = 1 << 14,
    Clipboard = 1 << 15,
    New = 1 << 16,
}

// readable string names for serialization / UI
export const CellOptionNames: Record<CellOptions, string> = {
    [CellOptions.None]: "cell-options:none",
    [CellOptions.Active]: "cell-options:active",
    [CellOptions.Branch]: "cell-options:branch",
    [CellOptions.Deleted]: "cell-options:deleted",
    [CellOptions.Hidden]: "cell-options:hidden",
    [CellOptions.IgnoreBackground]: "cell-options:ignoreBackground",
    [CellOptions.Selected]: "cell-options:selected",
    [CellOptions.FocusedMode]: "cell-options:focusedMode",
    [CellOptions.Locked]: "cell-options:locked",
    [CellOptions.NoImage]: "cell-options:noImage",
    [CellOptions.InitialTile]: "cell-options:initialTile",
    [CellOptions.Recenter]: "cell-options:recenter",
    [CellOptions.Clipboard]: "cell-options:clipboard",
    [CellOptions.New]: "cell-options:new",
}

// reverse lookup: string → CellOptions
export const CellOptionsFromName: Record<string, CellOptions> =
    Object.fromEntries(
        Object.entries(CellOptionNames).map(([key, value]) => [value, Number(key)])
    ) as Record<string, CellOptions>

// helpers
export const TileOptionsUtils = {
    /**
     * parse array of flag names into a bitmask
     */
    parseFlags: (names: string[]): CellOptions =>
        names
            .map(n => CellOptionsFromName[n])
            .filter(f => f !== undefined)
            .reduce((acc, f) => acc | f, CellOptions.None),

    /**
     * expand a bitmask into an array of flag names
     */
    toNames: (flags: CellOptions): string[] =>
        Object.entries(CellOptionNames)
            .filter(([key]) => (flags & Number(key)) !== 0)
            .map(([, name]) => name),
}
