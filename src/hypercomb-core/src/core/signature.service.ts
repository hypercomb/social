// c:\Projects\Hypercomb\social\src\LOCAL\hypercomb-core\src\core\signature.service.ts

export type Signature = string

export class SignatureService {

  public static readonly SIGNATURE_LENGTH = 64

  public static async sign(bytes: ArrayBuffer): Promise<Signature> {
    const hash = await crypto.subtle.digest('SHA-256', bytes)

    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
