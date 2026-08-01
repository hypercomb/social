// c:\Projects\Hypercomb\social\src\LOCAL\hypercomb-core\src\core\signature.service.ts

export type Signature = string

/** Signs many buffers off the main thread. Installed by the shell — core
 *  must not know what a worker is, and modules must not import the shell. */
export type BulkSigner = (buffers: ArrayBuffer[]) => Promise<Signature[]>

let bulkSigner: BulkSigner | null = null

/**
 * Route bulk signing somewhere off the main thread.
 *
 * The shell calls this once the packed-store worker is up. Everything
 * upstream keeps calling `signMany` and neither knows nor cares — which is
 * what lets modules (which may never import the shell) benefit from it.
 */
export const setBulkSigner = (signer: BulkSigner | null): void => {
  bulkSigner = signer
}

export class SignatureService {

  public static readonly SIGNATURE_LENGTH = 64

  public static async sign(bytes: ArrayBuffer): Promise<Signature> {
    const hash = await crypto.subtle.digest('SHA-256', bytes)

    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Sign a BATCH — install verification, folder-sync sweeps, any loop that
   * hashes many buffers in a row.
   *
   * Hashing megabytes on the main thread competes directly with rendering:
   * `crypto.subtle.digest` is async but the digest itself still occupies the
   * thread, so a large verify pass shows up as dropped frames. With a bulk
   * signer installed this happens in a worker instead. One call per BATCH,
   * not per buffer — a per-item round trip would cost more than it saves.
   *
   * Falls back to signing inline, so a caller never has to branch.
   */
  public static async signMany(buffers: ArrayBuffer[]): Promise<Signature[]> {
    if (!buffers.length) return []
    if (bulkSigner) {
      try { return await bulkSigner(buffers) } catch { /* fall through to inline */ }
    }
    const out: Signature[] = []
    for (const buffer of buffers) out.push(await SignatureService.sign(buffer))
    return out
  }
}
