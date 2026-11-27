import type { OpfsDir, OpfsFile, OpfsWritable } from "./opfs";

/** An in-memory OPFS for tests: the browser's error names, and a write lands only on close. */
class MemoryFile implements OpfsFile {
  readonly kind = "file";
  bytes = new Uint8Array(0);
  constructor(readonly name: string) {}

  getFile(): Promise<Blob> {
    return Promise.resolve(new Blob([this.bytes.slice()]));
  }

  createWritable(): Promise<OpfsWritable> {
    const chunks: Uint8Array[] = [];
    let open = true;
    const live = (): void => {
      if (!open) throw new DOMException("the stream is closed", "InvalidStateError");
    };
    return Promise.resolve({
      write: (data) =>
        new Promise<void>((resolve) => {
          live();
          chunks.push(data.slice());
          resolve();
        }),
      close: () =>
        new Promise<void>((resolve) => {
          live();
          open = false;
          const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let at = 0;
          for (const c of chunks) {
            out.set(c, at);
            at += c.length;
          }
          this.bytes = out;
          resolve();
        }),
      abort: () =>
        new Promise<void>((resolve) => {
          live();
          open = false;
          resolve();
        }),
    });
  }
}

class MemoryDir implements OpfsDir {
  readonly kind = "directory";
  readonly entries = new Map<string, MemoryDir | MemoryFile>();
  constructor(readonly name: string) {}

  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDir> {
    return new Promise((resolve) => {
      resolve(this.child(name, options?.create ?? false, MemoryDir));
    });
  }

  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFile> {
    return new Promise((resolve) => {
      resolve(this.child(name, options?.create ?? false, MemoryFile));
    });
  }

  values(): AsyncIterable<OpfsDir | OpfsFile> {
    const items = [...this.entries.values()][Symbol.iterator]();
    return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(items.next()) }) };
  }

  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    return new Promise((resolve) => {
      const found = this.entries.get(name);
      if (found === undefined) throw new DOMException(name, "NotFoundError");
      if (found instanceof MemoryDir && found.entries.size > 0 && options?.recursive !== true) {
        throw new DOMException(name, "InvalidModificationError");
      }
      this.entries.delete(name);
      resolve();
    });
  }

  private child<T extends MemoryDir | MemoryFile>(
    name: string,
    create: boolean,
    type: new (name: string) => T,
  ): T {
    if (name === "" || name.includes("/")) throw new TypeError(`invalid name "${name}"`);
    const found = this.entries.get(name);
    if (found instanceof type) return found;
    if (found !== undefined) throw new DOMException(name, "TypeMismatchError");
    if (!create) throw new DOMException(name, "NotFoundError");
    const made = new type(name);
    this.entries.set(name, made);
    return made;
  }
}

export function memoryOpfs(): OpfsDir {
  return new MemoryDir("");
}
