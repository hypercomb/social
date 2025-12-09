import { Injectable } from "@angular/core";

@Injectable({ providedIn: 'root' })
export class HashingService {

    public async sha256Hex(input: string | Blob): Promise<string> {
        let buffer: ArrayBuffer;

        if (typeof input === "string") {
            const uint8 = new TextEncoder().encode(input);
            buffer = uint8.buffer;                // <- OK
        }
        else {
            buffer = await input.arrayBuffer();    // <- OK
        }

        const hash = await crypto.subtle.digest("SHA-256", buffer);

        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    }

    // create hash filename using sha256Hex
    public async hashName(blob: Blob): Promise<string> {
        const name = await this.sha256Hex(blob);
        return `${name}.${blob.type.split("/")[1] || "webp"}`;
    }

    public fileNameForBlob(hash: string, blob: Blob): string {
        const ext = blob.type.split("/")[1] || "bin";
        return `${hash}.${ext}`;
    }

}