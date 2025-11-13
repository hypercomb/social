import { CellOptions } from "src/app/cells/models/cell-options"

export enum ClipboardMode {
    Default,
    Menu
}

export const hasFlag = (flags: number, flag: CellOptions) =>
    (flags & flag) === flag

export const addFlag = (flags: number, flag: CellOptions) =>
    flags | flag

export const removeFlag = (flags: number, flag: CellOptions) =>
    flags & ~flag





export enum EditorMode {
    None,
    Swatch
}

export enum HypercombMode {
    // general modes
    None = 0x0,
    Normal = 0x1,
    Move = 0x2,
    ShowPreferences = 0x4,
    ViewHelp = 0x8,
    ShowChat = 0x10,
    HiveCreation = 0x20,
    Collaboration = 0x40,
    Focused = 0x80,
    EditMode = 0x200,
    Copy = 0x400,
    Cut = 0x800,
    OpfsFileExplorer = 0x1000,
    Select = 0x2000,
    Transport = 0x4000,
    ViewingClipboard = 0x8000,
    YoutubeViewer = 0x10000,
    EditingCaption = 0x20000,
    ViewingGoogleDocument = 0x40000,
    AiPrompt = 0x80000,
    Filtering = 0x100000,
    ViewingPhoto = 0x200000,

    // grouped convenience modes
    CommandModes =
    AiPrompt |
    Copy |
    EditMode |
    Cut |
    Move |
    Transport |
    ViewingClipboard |
    Select,

    KeyboardBlockedCommands =
    AiPrompt |
    HiveCreation |
    EditingCaption |
    Filtering |
    ShowChat,

    ContextMenuMode =
    Select |
    Move |
    Copy |
    Cut |
    EditMode |
    ViewingClipboard,
    
}

export enum DocumentType {
    None,
    Google
}

export enum HoneycombState {
    None,
    Local,
    Server
}

export enum POLICY {
    ViewingClipboard = 'viewing-clipboard',
    MovingTiles = "moving-tiles",
    NotFirstTile = "not-first-tile",
    EditInProgress = "edit-in-progress",
    KeyboardBlocked = "keyboard:blocked",
    Immutable = "immutable",
    ControlDown = "keyboard:control-down",
    ShiftDown = "keyboard:shift-down",
    AltDown = "keyboard:alt-down",
    SelectingTiles = "layout:selecting-tiles",
    CommbandModeActive = "command-mode-active",
    NormalMode = "layout:normal-mode",
    ShiftNotPressed = "keyboard:shift-not-pressed",
    NoActiveTile = "layout:no-active-tile",
    HiveResolution = "HiveResolution",
    IsMoveMode = "mode:IsMoveMode",
    IsBranch = "IsBranch",
    ShowingContextMenu = "ShowingContextMenu"
}

export namespace Enum {

    /**
     * Gets active flag names for HypercombMode as a single string.
     * @param value HypercombMode enum value
     * @returns Concatenated string of active flag names
     */
    export function getHypercombModeNames(value: HypercombMode): string {
        if (value === HypercombMode.None) return "None"

        return Object.keys(HypercombMode)
            .filter(flag => isNaN(Number(flag))) // Only include string keys (names)
            .filter(flag => {
                const numFlag = HypercombMode[flag as keyof typeof HypercombMode]
                return (value & numFlag) === numFlag
            })
            .join(", ")
    }

    /**
     * Gets active flag names for CellOptions as a single string.
     * @param value CellOptions enum value
     * @returns Concatenated string of active flag names
     */
    export function getTileOptionsNames(value: CellOptions): string {
        if (value === CellOptions.None) return "None"

        return Object.keys(CellOptions)
            .filter(flag => isNaN(Number(flag))) // Only include string keys (names)
            .filter(flag => {
                const numFlag = CellOptions[flag as keyof typeof CellOptions]
                return (value & numFlag) === numFlag
            })
            .join(", ")
    }

}

export { CellOptions }

