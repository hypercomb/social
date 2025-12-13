import { simplify } from "src/app/shared/services/name-simplifier"
import { HiveResolutionType } from "./hive-resolution-type"
import { HashService } from "./storage/hashing-service"

export class HiveScout {

  public readonly name: string 
  public gene: string = ''
  public readonly type: HiveResolutionType
  private constructor(hiveName: string, type: HiveResolutionType) {
    this.name = simplify(hiveName)   // always simplified, fragment preserved

    this.type = type

    queueMicrotask(async () => {
      this.gene = await HashService.hash(this.name)
    })
  }

  // ---------- static factories ----------
  static new(hiveName: string): HiveScout {
    return new HiveScout(hiveName, HiveResolutionType.New)
  }

  static opfs(hiveName: string): HiveScout | PromiseLike<HiveScout | null> | null {
    return new HiveScout(hiveName, HiveResolutionType.Opfs)
  }

  static server(hiveName: string): HiveScout {
    return new HiveScout(hiveName, HiveResolutionType.Server)
  }
}
