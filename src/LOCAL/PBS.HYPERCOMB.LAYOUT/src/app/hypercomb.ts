// src/app/core/hypercomb.ts

import { inject, Injectable } from "@angular/core"
import { Router } from "@angular/router"
import { web } from "./hypercomb.web"
import { OpfsManager } from "./core/opfs.manager"

@Injectable({ providedIn: "root" })
export class hypercomb extends web {

  private readonly router = inject(Router)

  constructor(
    private readonly opfs: OpfsManager
  ) {
    super()
  }

  protected override write = async (text: string): Promise<void> => {
    const value = text.trim()
    if (!value) {
      console.debug("[hypercomb] empty input ignored")
      return
    }

    // derive lineage from url
    const lineage = this.router.url
      .split("/")
      .filter(Boolean)

    console.debug("[hypercomb] lineage resolved:", lineage)

    // ensure directory hierarchy exists
    const dir = await this.opfs.ensureDirs(lineage)

    console.debug("[hypercomb] directory ensured for lineage")

    // normalize input as signature name
    // this becomes the nucleotide identity
    const signature = value
      .toLowerCase()
      .replace(/\s+/g, ".")
      .replace(/[^a-z0-9.]/g, "")

    console.debug("[hypercomb] signature resolved:", signature)

    // write empty marker file (existence = availability)
    await this.opfs.writeFile(dir, signature, "")

    console.debug("[hypercomb] signature written:", {
      lineage,
      signature
    })
  }
}
