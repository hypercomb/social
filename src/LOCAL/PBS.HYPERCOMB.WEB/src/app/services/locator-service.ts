import { Injectable } from "@angular/core"

@Injectable({ providedIn: "root" })
export class LocatorService {
  /** normalize a full URL into a simplified hive name (path#hash) */
  public simplifyUrl(url: string): string {
    const { pathname, hash } = new URL(url)
    const path = pathname.length > 1 ? pathname.substring(1) : ""
    return hash ? `${path}#${hash.substring(1)}` : path
  }

  /** parse user + share codes from URLs ending with ".../{user}/{share}.json" */
  public parseCodes(url: string): { usercode: string; sharecode: string } {
    const parts = url.split("/").filter(Boolean)
    const sharecode = parts.pop() ?? ""
    const usercode = parts.pop() ?? ""
    return { usercode: usercode.replace(".json", ""), sharecode }
  }
}



