// src/app/discovery.web.ts
import { Injectable } from "@angular/core"
@Injectable()
export abstract class web {
  public abstract write(text: string): Promise<void>
}
  