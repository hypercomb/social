// c:\Projects\Hypercomb\social\src\LOCAL\hypercomb-core\src\core\signature.service.ts

export type Signature = string

export class SignatureService {

  public static readonly SIGNATURE_LENGTH = 64

  // debug helper — safe to remove later
  public static dumpBytes(label: string, bytes: ArrayBuffer): void {
    const view = new Uint8Array(bytes)

    const head = Array.from(view.slice(0, 16))
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ')

    const tail = Array.from(view.slice(-16))
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ')

    console.log(label, {
      length: view.length,
      head,
      tail
    })
  }

  public static async sign(bytes: ArrayBuffer): Promise<Signature> {
    // dump at sign-time
    SignatureService.dumpBytes('SIGN INPUT BYTES', bytes)

    const hash = await crypto.subtle.digest('SHA-256', bytes)

    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
