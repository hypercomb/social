// events.ts
export const Events = {
  DirectImageDrop: "editor:direct-image-drop" as const,
  PanningThreshold: "panning-threshold" as const,
  TileSelected: "tile-selected" as const,
  TileDeleted: "tile-deleted" as const,
  EscapeCancel: "document:escape-cancel" as const,
  NotifyLocked: "notify-locked" as const,
  HexagonDropCompleted: "hexagon-drop-completed" as const,
  ShowHive: "show-hive" as const,
  ZoomChanged: "zoom-changed" as const,
}

// infer the union of values

export type EventNames = typeof Events[keyof typeof Events]

export interface AppEvents {
  [Events.DirectImageDrop]: { Blob: Blob }
  [Events.PanningThreshold]: { dx: number; dy: number }
  [Events.TileSelected]: { id: string }
  [Events.TileDeleted]: { hiveId: string }
  [Events.EscapeCancel]: { event: any }
  [Events.NotifyLocked]: {}
  [Events.HexagonDropCompleted]: {}
  [Events.ShowHive]: { hive: string }
  [Events.ZoomChanged]: { level: number }
}
