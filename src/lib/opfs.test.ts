import { expect, test } from "vitest";
import {
  listDirs,
  listFiles,
  listTree,
  readFile,
  removeDir,
  writeFile,
  type OpfsDir,
  type OpfsFile,
} from "./opfs";
import { memoryOpfs } from "./opfs-fake";

const text = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

test("a missing file or folder reads as null", async () => {
  const root = memoryOpfs();
  expect(await readFile(root, "profiles/vorpal-mg90.json")).toBeNull();
  await writeFile(root, "profiles/other.json", text("{}"));
  expect(await readFile(root, "profiles/vorpal-mg90.json")).toBeNull();
});

test("a write creates its folders and reads back the same bytes", async () => {
  const root = memoryOpfs();
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  await writeFile(root, "00000000ffffffff1a2b3c4d5e6f7081/setup.json", bytes);
  expect(await readFile(root, "00000000ffffffff1a2b3c4d5e6f7081/setup.json")).toEqual(bytes);
});

test("a write replaces the whole file", async () => {
  const root = memoryOpfs();
  await writeFile(root, "policies/default.json", text("a longer first version"));
  await writeFile(root, "policies/default.json", text("short"));
  expect(
    new TextDecoder().decode((await readFile(root, "policies/default.json")) ?? undefined),
  ).toBe("short");
});

test("a folder lists its files sorted and skips subfolders", async () => {
  const root = memoryOpfs();
  await writeFile(root, "profiles/b.json", text("b"));
  await writeFile(root, "profiles/a.json", text("a"));
  await writeFile(root, "profiles/nested/c.json", text("c"));
  expect(await listFiles(root, "profiles")).toEqual(["a.json", "b.json"]);
  expect(await listFiles(root, "policies")).toEqual([]);
});

test("a tree lists every file below a folder with its size, and a folder its subfolders", async () => {
  const root = memoryOpfs();
  await writeFile(root, "u/20261127T040624Z/run.json", text("{}"));
  await writeFile(root, "u/20261127T040624Z/captures/rest/02-raw.csv.gz", new Uint8Array(9));
  await writeFile(root, "u/setup.json", text("{}"));
  expect(await listTree(root, "u/20261127T040624Z")).toEqual([
    { path: "captures/rest/02-raw.csv.gz", size: 9 },
    { path: "run.json", size: 2 },
  ]);
  expect(await listTree(root, "v")).toEqual([]);
  expect(await listDirs(root)).toEqual(["u"]);
  expect(await listDirs(root, "u")).toEqual(["20261127T040624Z"]);
  expect(await listDirs(root, "v")).toEqual([]);
});

test("a removed folder takes everything in it; a missing one is no error", async () => {
  const root = memoryOpfs();
  await writeFile(root, "u/20261127T040624Z/captures/rest/02-raw.csv.gz", new Uint8Array(9));
  await writeFile(root, "u/setup.json", text("{}"));
  await removeDir(root, "u/20261127T040624Z");
  await removeDir(root, "u/20261127T040624Z");
  await removeDir(root, "v/w");
  expect(await listTree(root, "u")).toEqual([{ path: "setup.json", size: 2 }]);
});

test("a path with an empty, . or .. part is refused", async () => {
  const root = memoryOpfs();
  for (const path of ["", "profiles/", "/profiles/a.json", "profiles/../a.json", "./a.json"]) {
    await expect(writeFile(root, path, text("x"))).rejects.toThrow("not a storage path");
    await expect(readFile(root, path)).rejects.toThrow("not a storage path");
  }
  expect(await listFiles(root, "profiles")).toEqual([]);
});

test("reading a folder as a file is an error, not a missing file", async () => {
  const root = memoryOpfs();
  await writeFile(root, "profiles/a.json/inner", text("x"));
  await expect(readFile(root, "profiles/a.json")).rejects.toThrow(
    expect.objectContaining({ name: "TypeMismatchError" }),
  );
});

function failingWrites(dir: OpfsDir): OpfsDir {
  const file = (handle: OpfsFile): OpfsFile => ({
    kind: "file",
    name: handle.name,
    getFile: () => handle.getFile(),
    createWritable: async () => {
      const inner = await handle.createWritable();
      return {
        write: () => Promise.reject(new DOMException("disk full", "QuotaExceededError")),
        close: () => inner.close(),
        abort: () => inner.abort(),
      };
    },
  });
  return {
    kind: "directory",
    name: dir.name,
    getDirectoryHandle: async (name, options) =>
      failingWrites(await dir.getDirectoryHandle(name, options)),
    getFileHandle: async (name, options) => file(await dir.getFileHandle(name, options)),
    values: () => dir.values(),
    removeEntry: (name, options) => dir.removeEntry(name, options),
  };
}

test("a write that fails leaves the old file", async () => {
  const root = memoryOpfs();
  await writeFile(root, "profiles/a.json", text("old"));
  await expect(writeFile(failingWrites(root), "profiles/a.json", text("new"))).rejects.toThrow(
    "disk full",
  );
  expect(await readFile(root, "profiles/a.json")).toEqual(text("old"));
});
