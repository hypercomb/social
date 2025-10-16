import { simplify } from "src/app/shared/services/name-simplifier"
import { HiveResolutionType } from "./hive-models"
import { Hive } from "../cells/cell"

export class HiveScout {

  public _hive: Hive | undefined
  public get hive(): Hive | undefined { return this._hive }
  
  public readonly name: string
  public readonly type: HiveResolutionType
  public readonly exists: boolean

  private payloads = new Map<Function, unknown>()

  private constructor(hiveName: string, type: HiveResolutionType, exists: boolean) {
    this.name = simplify(hiveName)   // always simplified, fragment preserved
    this.type = type
    this.exists = exists
  }

  public setHive(hive:Hive) { 
    this._hive = hive
  }

  static firstOpfsHive(hiveName: string): HiveScout | PromiseLike<HiveScout | null> | null {
    return new HiveScout(hiveName, HiveResolutionType.FirstOpfs, true)
  }

  // ---------- static factories ----------
  static genus(hiveName: string): HiveScout {
    return new HiveScout(hiveName, HiveResolutionType.Genus, true)
  }

  static liveDb(hive: string) {
    return new HiveScout(hive, HiveResolutionType.LiveDb, true)
  }
  static server(hiveName: string): HiveScout {
    return new HiveScout(hiveName, HiveResolutionType.Server, true)
  }

  static opfs(hiveName: string): HiveScout | PromiseLike<HiveScout | null> | null {
    return new HiveScout(hiveName, HiveResolutionType.Opfs, true)
  }

  static noserver(hiveName: string): HiveScout {
    return new HiveScout(hiveName, HiveResolutionType.Server, false)
  }

  static fallback(hiveName: string): HiveScout {
    return new HiveScout(hiveName, HiveResolutionType.Fallback, true)
  }

  static local(hiveName: string): HiveScout {
    return new HiveScout(hiveName, HiveResolutionType.Local, false)
  }

  // ---------- payload helpers ----------
  public set<T>(key: Function, payload: T): void {
    this.payloads.set(key, payload)
  }

  public get<T>(key: Function): T | undefined {
    return this.payloads.get(key) as T | undefined
  }

  public has(key: Function): boolean {
    return this.payloads.has(key)
  }
}
