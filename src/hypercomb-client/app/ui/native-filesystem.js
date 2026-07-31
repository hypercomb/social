const SIG = /^[0-9a-f]{64}$/i;
const MARKER = /^\d{8}$/;
const nativeAvailable = () => typeof globalThis.__TAURI__?.core?.invoke === "function";
const ambientBridge = () => nativeAvailable() ? { invoke: globalThis.__TAURI__.core.invoke } : null;
class NativeWritable {
  constructor(commit) {
    this.commit = commit;
  }
  #chunks = [];
  async write(data) {
    if (data && typeof data === "object" && "type" in data) {
      const record = data;
      if (record.type !== "write") return;
      return this.write(record.data);
    }
    this.#chunks.push(await toBytes(data));
  }
  async truncate() {
    this.#chunks = [];
  }
  async close() {
    const total = this.#chunks.reduce((n, c) => n + c.byteLength, 0);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const chunk of this.#chunks) {
      joined.set(chunk, at);
      at += chunk.byteLength;
    }
    await this.commit(joined);
  }
  async abort() {
    this.#chunks = [];
  }
}
const toBytes = async (data) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data == null) return new Uint8Array();
  return new TextEncoder().encode(String(data));
};
class NativeFileHandle {
  constructor(name, read, commit) {
    this.name = name;
    this.read = read;
    this.commit = commit;
  }
  kind = "file";
  async getFile() {
    const bytes = await this.read() ?? new Uint8Array();
    return new File([bytes], this.name, { lastModified: 0 });
  }
  async createWritable() {
    return new NativeWritable(this.commit);
  }
  async isSameEntry(other) {
    return other instanceof NativeFileHandle && other.name === this.name;
  }
}
class NativeSigDirectory {
  constructor(name, bridge) {
    this.name = name;
    this.bridge = bridge;
  }
  kind = "directory";
  async getFileHandle(name, options) {
    const entries = await this.#entries();
    if (!entries.some((e) => e.name === name) && !options?.create) {
      throw notFound(name);
    }
    return new NativeFileHandle(
      name,
      async () => {
        const bytes = await this.bridge.invoke("raw_dir_get", { sig: this.name, name });
        return bytes ? Uint8Array.from(bytes) : null;
      },
      async (bytes) => {
        await this.bridge.invoke("raw_dir_put", {
          sig: this.name,
          name,
          bytes: Array.from(bytes)
        });
      }
    );
  }
  /** Sig-named directories do not nest. The interchange form is exactly two
   *  levels deep, so this always fails — as it does in OPFS today. */
  async getDirectoryHandle(name) {
    throw notFound(name);
  }
  async removeEntry(name) {
    await this.bridge.invoke("raw_dir_remove", { sig: this.name, name });
  }
  async isSameEntry(other) {
    return other instanceof NativeSigDirectory && other.name === this.name;
  }
  async #entries() {
    return await this.bridge.invoke("raw_dir_entries", { sig: this.name });
  }
  async *keys() {
    for (const entry of await this.#entries()) yield entry.name;
  }
  async *values() {
    for (const entry of await this.#entries()) yield await this.getFileHandle(entry.name);
  }
  async *entries() {
    for (const entry of await this.#entries()) {
      yield [entry.name, await this.getFileHandle(entry.name)];
    }
  }
  [Symbol.asyncIterator]() {
    return this.entries();
  }
}
class NativeRootDirectory {
  constructor(bridge) {
    this.bridge = bridge;
  }
  kind = "directory";
  name = "";
  async getFileHandle(name, options) {
    if (!SIG.test(name)) {
      throw notFound(name);
    }
    if (!options?.create) {
      const present = await this.bridge.invoke("content_has", { sig: name });
      if (!present) throw notFound(name);
    }
    return new NativeFileHandle(
      name,
      async () => {
        const bytes = await this.bridge.invoke("content_get", { sig: name });
        return bytes ? Uint8Array.from(bytes) : null;
      },
      async (bytes) => {
        const actual = await this.bridge.invoke("content_put", { bytes: Array.from(bytes) });
        if (actual !== name) {
          throw new Error(
            `[hypercomb] refusing to write content under ${name.slice(0, 16)}\u2026 \u2014 its bytes sign as ${String(actual).slice(0, 16)}\u2026`
          );
        }
      }
    );
  }
  async getDirectoryHandle(name, options) {
    if (!SIG.test(name)) {
      throw notFound(name);
    }
    void options;
    return new NativeSigDirectory(name, this.bridge);
  }
  /**
   * Remove a top-level entry.
   *
   * A NO-OP for content, by design. Removing a tile appends a new layer with
   * one less child; the old layer is still history. Content is reclaimed only
   * by collection, and only when no committed layer ever referenced it.
   *
   * Does not throw — callers treat removal as best-effort, and throwing here
   * would break drain paths that expect absence to be fine.
   */
  async removeEntry(name) {
    if (SIG.test(name)) {
      await this.bridge.invoke("raw_remove", { sig: name });
    }
  }
  async isSameEntry(other) {
    return other instanceof NativeRootDirectory;
  }
  /** Permissions are a browser concept. The native store is simply ours. */
  async queryPermission() {
    return "granted";
  }
  async requestPermission() {
    return "granted";
  }
  async #entries() {
    return await this.bridge.invoke("raw_root_entries");
  }
  async *keys() {
    for (const entry of await this.#entries()) yield entry.name;
  }
  async *values() {
    for (const entry of await this.#entries()) {
      yield entry.directory ? new NativeSigDirectory(entry.name, this.bridge) : await this.getFileHandle(entry.name);
    }
  }
  async *entries() {
    for (const entry of await this.#entries()) {
      yield [
        entry.name,
        entry.directory ? new NativeSigDirectory(entry.name, this.bridge) : await this.getFileHandle(entry.name)
      ];
    }
  }
  [Symbol.asyncIterator]() {
    return this.entries();
  }
}
const notFound = (name) => typeof DOMException !== "undefined" ? new DOMException(`${name} not found`, "NotFoundError") : Object.assign(new Error(`${name} not found`), { name: "NotFoundError" });
const nativeRoot = () => {
  const bridge = ambientBridge();
  return bridge ? new NativeRootDirectory(bridge) : null;
};
export {
  NativeRootDirectory,
  ambientBridge,
  nativeAvailable,
  nativeRoot
};
