import { simplify } from "src/app/shared/services/name-simplifier"
import { HiveResolutionType } from "./hive-resolution-type"
import { HashService } from "./storage/hash.service"

export class HiveScout {

  public readonly name: string 
  public seed: string = ''
  public readonly type: HiveResolutionType
  private constructor(hiveName: string, type: HiveResolutionType) {
    this.name = simplify(hiveName)   // always simplified, fragment preserved

    this.type = type

    queueMicrotask(async () => {
      this.seed = await HashService.hash(this.name)
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
