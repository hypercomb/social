// src/app/discovery.web.ts
import { Injectable } from "@angular/core"
@Injectable()
export abstract class web {
  public abstract act(text: string): Promise<void>
}
  