import { IShortcut } from "../shortcut-model"

export const globalShortcuts: IShortcut[] = [
  {
    cmd: "global.escape",
    description: "Escape / cancel (contextual)",
    keys: [[{ key: "escape" }]],
    global: true
  },
  {
    cmd: "global.signout",
    description: "Sign out",
    keys: [[{ key: ".", primary: false }]],
    global: true
  },
  {
    cmd: "global.publish",
    description: "Publish changes to hive",
    category: "Destructive",
    risk: "warning",
    riskNote: "This will make changes public",
    keys: [[{ key: ":", primary: true, shift: true, alt: true }]]
  },
  {
    cmd: "rebuild-hierarchy",
    description: "Rebuild hierarchy table",
    keys: [[{ key: "~", ctrl: true, shift: true }]],
    global: true
  },
  {
    cmd: "database.import-to-opfs",
    description: "Import databases to OPFS",
    keys: [[{ key: "?", ctrl: true, shift: true }]],
    global: true
  },
  {
    cmd: "db.export-all",
    description: "Export **all** hives + images as one .zip",
    keys: [[{ key: ">", ctrl: true, shift: true }]],
    global: true,
    category: "Utility"
  }
] as const