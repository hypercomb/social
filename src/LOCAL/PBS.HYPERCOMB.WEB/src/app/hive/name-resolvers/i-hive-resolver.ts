// i-hive-resolver.ts
import { HiveResolutionType } from "../hive-models"
import { HiveScout } from "../hive-scout"

export interface IHiveGuide {
  type: HiveResolutionType
  enabled(hiveName: string): Promise<boolean> | boolean
  resolve(hiveName: string): Promise<HiveScout | null> | HiveScout | null
}
