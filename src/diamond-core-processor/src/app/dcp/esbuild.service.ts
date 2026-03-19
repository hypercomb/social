// diamond-core-processor/src/app/dcp/esbuild.service.ts

import { Injectable } from '@angular/core'
import { ensureEsbuild } from './esbuild-runtime'

@Injectable({ providedIn: 'root' })
export class EsbuildService {

  public transform = async (code: string): Promise<string> => {
    const esbuild = await ensureEsbuild()

    const result = await esbuild.transform(code, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022'
    })

    return result.code
  }
}
