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
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
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

/** The names of the folders in a folder (the root when no path is given), sorted. */
export async function listDirs(root: OpfsDir, path?: string): Promise<string[]> {
  const dir = path === undefined ? root : await openDir(root, segments(path));
  if (dir === null) return [];
  const names: string[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === "directory") names.push(entry.name);
  }
  return names.sort();
}

/** A file somewhere under a folder: its path from that folder and its size in bytes. */
export interface TreeFile {
  path: string;
  size: number;
}

/** Every file under a folder at any depth, sorted by path; empty when the folder does not exist. */
export async function listTree(root: OpfsDir, path: string): Promise<TreeFile[]> {
  const top = await openDir(root, segments(path));
  if (top === null) return [];
  const found: TreeFile[] = [];
  const walk = async (dir: OpfsDir, prefix: string): Promise<void> => {
    for await (const entry of dir.values()) {
      const at = `${prefix}${entry.name}`;
      if (entry.kind === "directory") await walk(entry, `${at}/`);
      else found.push({ path: at, size: (await entry.getFile()).size });
    }
  };
  await walk(top, "");
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Removes a folder and everything in it; a folder that does not exist is no error. */
export async function removeDir(root: OpfsDir, path: string): Promise<void> {
  const parts = segments(path);
  const name = parts.pop() ?? "";
  const parent = await openDir(root, parts);
  if (parent === null) return;
  try {
    await parent.removeEntry(name, { recursive: true });
  } catch (e) {
    if (!notFound(e)) throw e;
  }
}

/** The file's bytes; null where no file is there, a folder too. */
async function fileAt(root: OpfsDir, path: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return await readFile(root, path);
  } catch (e) {
    if (e instanceof DOMException && e.name === "TypeMismatchError") return null;
    throw e;
  }
}

/** Removes a file; a file that does not exist is no error. */
export async function removeFile(root: OpfsDir, path: string): Promise<void> {
  const parts = segments(path);
  const name = parts.pop() ?? "";
  const parent = await openDir(root, parts);
  if (parent === null) return;
  try {
    await parent.removeEntry(name);
  } catch (e) {
    if (!notFound(e)) throw e;
  }
}

/**
 * Moves the file at `from`, or the folder there whole, to `to`, bytes untouched: each file is
 * copied, then the old one removed. Refused when nothing is at `from`, or something is at `to`.
 */
export async function movePath(root: OpfsDir, from: string, to: string): Promise<void> {
  const there = (await fileAt(root, to)) !== null || (await listTree(root, to)).length > 0;
  if (there) throw new Error(`${to} exists`);
  const file = await fileAt(root, from);
  if (file !== null) {
    await writeFile(root, to, file);
    await removeFile(root, from);
    return;
  }
  const tree = await listTree(root, from);
  if (tree.length === 0) throw new Error(`nothing at ${from} to move`);
  for (const f of tree) {
    const bytes = await readFile(root, `${from}/${f.path}`);
    if (bytes !== null) await writeFile(root, `${to}/${f.path}`, bytes);
  }
  await removeDir(root, from);
}
