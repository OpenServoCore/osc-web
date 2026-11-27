/** The subset of the File System Access handles the app uses; the browser's OPFS root satisfies it. */
export interface OpfsWritable {
  write(data: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface OpfsFile {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<Blob>;
  createWritable(): Promise<OpfsWritable>;
}

export interface OpfsDir {
  readonly kind: "directory";
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDir>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFile>;
  values(): AsyncIterable<OpfsDir | OpfsFile>;
}

export function opfsRoot(): Promise<OpfsDir> {
  return navigator.storage.getDirectory();
}

function segments(path: string): string[] {
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new Error(`not a storage path: "${path}"`);
  }
  return parts;
}

function notFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === "NotFoundError";
}

async function openDir(root: OpfsDir, dirs: string[]): Promise<OpfsDir | null> {
  let dir = root;
  for (const name of dirs) {
    try {
      dir = await dir.getDirectoryHandle(name);
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }
  return dir;
}

async function makeDir(root: OpfsDir, dirs: string[]): Promise<OpfsDir> {
  let dir = root;
  for (const name of dirs) dir = await dir.getDirectoryHandle(name, { create: true });
  return dir;
}

/** The file's bytes, or null when it or a folder on its path does not exist. */
export async function readFile(
  root: OpfsDir,
  path: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const parts = segments(path);
  const name = parts.pop() ?? "";
  const dir = await openDir(root, parts);
  if (dir === null) return null;
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

/** Creates the folders on the path; the file is replaced whole when the write closes. */
export async function writeFile(
  root: OpfsDir,
  path: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const parts = segments(path);
  const name = parts.pop() ?? "";
  const dir = await makeDir(root, parts);
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  try {
    await writable.write(bytes);
    await writable.close();
  } catch (e) {
    await writable.abort();
    throw e;
  }
}

/** The names of the files in a folder, sorted; empty when the folder does not exist. */
export async function listFiles(root: OpfsDir, path: string): Promise<string[]> {
  const dir = await openDir(root, segments(path));
  if (dir === null) return [];
  const names: string[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === "file") names.push(entry.name);
  }
  return names.sort();
}
