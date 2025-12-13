import { Injectable } from "@angular/core";

export type HashString  = string;  // lowercase hex
export type StrandHash = HashString;
export type GeneHash   = HashString;
export type HiveHash   = HashString;
export type ImageHash  = HashString;
export type RawHash    = HashString;

export class HashService {

    public static async sha256Hex(input: string | Blob): Promise<HashString> {
        let buffer: ArrayBuffer;

        if (typeof input === "string") {
            const uint8 = new TextEncoder().encode(input);
            buffer = uint8.slice().buffer;               // ensures exact bytes
        } else {
            buffer = await input.arrayBuffer();
        }

        const hash = await crypto.subtle.digest("SHA-256", buffer);

        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("") as HashString;
    }

    // NEW: direct string hashing for convenience
    public static hash(input: string): Promise<HashString> {
        return this.sha256Hex(input);
    }

    public static async hashBlob(blob: Blob): Promise<string> {
        const name = await this.sha256Hex(blob);
        return `${name}.${blob.type.split("/")[1] || "webp"}`;
    }

    public static fileNameForBlob(hash: string, blob: Blob): string {
        const ext = blob.type.split("/")[1] || "bin";
        return `${hash}.${ext}`;
    }
}
