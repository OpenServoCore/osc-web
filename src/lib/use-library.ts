import { useEffect, useState } from "react";
import type { InputFile, Shelf, Stored } from "./library";
import { opfsRoot, type OpfsDir } from "./opfs";
import { loadWasm } from "./wasm";

let root: Promise<OpfsDir> | undefined;

/** The browser's OPFS root, opened once. */
export function storage(): Promise<OpfsDir> {
  root ??= opfsRoot();
  return root;
}

export interface Library<T extends InputFile> {
  /** Undefined until the storage and the wasm checks are ready. */
  entries: readonly Stored<T>[] | undefined;
  error: string | undefined;
  save: (file: T) => Promise<Stored<T>>;
  exportBytes: (key: string) => Promise<Uint8Array<ArrayBuffer> | null>;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** One folder of the browser's library, listed once and kept current by its own saves. */
export function useLibrary<T extends InputFile>(open: (root: OpfsDir) => Shelf<T>): Library<T> {
  const [entries, setEntries] = useState<readonly Stored<T>[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await loadWasm();
        const listed = await open(await storage()).list();
        if (live) setEntries(listed);
      } catch (e) {
        if (live) setError(message(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [open]);

  async function save(file: T): Promise<Stored<T>> {
    const saved = await open(await storage()).save(file);
    setEntries((old) =>
      [...(old ?? []).filter((e) => e.value.key !== saved.value.key), saved].sort((a, b) =>
        a.value.key < b.value.key ? -1 : 1,
      ),
    );
    return saved;
  }

  async function exportBytes(key: string) {
    return open(await storage()).exportBytes(key);
  }

  return { entries, error, save, exportBytes };
}

/** Hands the user a file with exactly these bytes. */
export function download(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  type = "application/json",
): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
