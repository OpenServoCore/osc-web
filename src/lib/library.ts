import type { ServoProfile, TuningPolicy } from "@openservocore/client";
import { listFiles, readFile, writeFile, type OpfsDir } from "./opfs";

export type { ServoProfile, TuningPolicy };

/** What the library reads of any input file; the rest of it is the file type's. */
export interface InputFile {
  schema: string;
  key: string;
  revision?: number;
}

/** A stored file always carries the revision the library gave it. */
type Saved<T extends InputFile> = T & { revision: number };

/** A file as stored: its parsed value, its exact bytes and their SHA-256 in hex. */
export interface Stored<T extends InputFile> {
  value: Saved<T>;
  bytes: Uint8Array<ArrayBuffer>;
  sha256: string;
}

export interface Source<T extends InputFile> {
  list(): Promise<Stored<T>[]>;
  get(key: string): Promise<Stored<T> | null>;
}

export type ProfileSource = Source<ServoProfile>;

export interface Shelf<T extends InputFile> extends Source<T> {
  /** The library owns `revision`: 1 on the first save, one more on each save that changes the file. */
  save(file: T): Promise<Stored<T>>;
  /** Exactly the stored bytes, so an exported file hashes to its setup reference. */
  exportBytes(key: string): Promise<Uint8Array<ArrayBuffer> | null>;
}

/** The file name a key may take: lowercase, digits and dashes, at most 40 characters. */
const KEY_PATTERN = /^[a-z0-9-]{1,40}$/;

function checkKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`"${key}" cannot name a file: use 1 to 40 of a-z, 0-9 and -`);
  }
}

function encode(file: InputFile, revision: number): Uint8Array<ArrayBuffer> {
  const ordered = Object.assign({ schema: file.schema, key: file.key, revision }, file, {
    revision,
  });
  return new TextEncoder().encode(`${JSON.stringify(ordered, null, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(bytes: Uint8Array, path: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw new Error(`${path} is not JSON`, { cause: e });
  }
}

// The file's own fields are the type's to check (validateProfile, validatePolicy);
// the library reads only what names and orders it.
function decode<T extends InputFile>(bytes: Uint8Array, path: string, key: string): Saved<T> {
  const parsed = parseJson(bytes, path);
  if (
    !isRecord(parsed) ||
    typeof parsed.schema !== "string" ||
    typeof parsed.key !== "string" ||
    typeof parsed.revision !== "number" ||
    !Number.isInteger(parsed.revision) ||
    parsed.revision < 1
  ) {
    throw new Error(`${path} has no schema, key and revision`);
  }
  if (parsed.key !== key) throw new Error(`${path} holds the key "${parsed.key}"`);
  return parsed as unknown as Saved<T>;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function shelf<T extends InputFile>(root: OpfsDir, folder: "profiles" | "policies"): Shelf<T> {
  const pathOf = (key: string): string => {
    checkKey(key);
    return `${folder}/${key}.json`;
  };
  const stored = async (bytes: Uint8Array<ArrayBuffer>, key: string): Promise<Stored<T>> => ({
    value: decode<T>(bytes, pathOf(key), key),
    bytes,
    sha256: await sha256(bytes),
  });
  const get = async (key: string): Promise<Stored<T> | null> => {
    const bytes = await readFile(root, pathOf(key));
    return bytes === null ? null : stored(bytes, key);
  };
  return {
    get,
    async list() {
      const keys = (await listFiles(root, folder))
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length))
        .filter((key) => KEY_PATTERN.test(key));
      const found = await Promise.all(keys.map(get));
      return found.filter((entry) => entry !== null);
    },
    async save(file) {
      const path = pathOf(file.key);
      const old = await readFile(root, path);
      let revision = 1;
      if (old !== null) {
        const previous = decode<T>(old, path, file.key).revision;
        if (sameBytes(encode(file, previous), old)) return stored(old, file.key);
        revision = previous + 1;
      }
      const bytes = encode(file, revision);
      await writeFile(root, path, bytes);
      return stored(bytes, file.key);
    },
    exportBytes(key) {
      return readFile(root, pathOf(key));
    },
  };
}

export function profiles(root: OpfsDir): Shelf<ServoProfile> {
  return shelf<ServoProfile>(root, "profiles");
}

export function policies(root: OpfsDir): Shelf<TuningPolicy> {
  return shelf<TuningPolicy>(root, "policies");
}

/** Which file a servo uses, pinned to the bytes chosen. */
export interface InputRef {
  key: string;
  revision: number;
  sha256: string;
}

export interface ServoSetup {
  profile: InputRef | null;
  policy: InputRef | null;
}

export function refOf(entry: Stored<InputFile>): InputRef {
  return { key: entry.value.key, revision: entry.value.revision, sha256: entry.sha256 };
}

const UID_PATTERN = /^[0-9a-f]{32}$/;

/** A servo's folder is its uid as the bus gives it, the name osc-ident's run folders use. */
function setupPath(uid: string): string {
  if (!UID_PATTERN.test(uid)) throw new Error(`"${uid}" is not a 32-character lowercase hex uid`);
  return `${uid}/setup.json`;
}

function isRef(value: unknown): value is InputRef {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.revision === "number" &&
    typeof value.sha256 === "string"
  );
}

export async function readSetup(root: OpfsDir, uid: string): Promise<ServoSetup | null> {
  const path = setupPath(uid);
  const bytes = await readFile(root, path);
  if (bytes === null) return null;
  const parsed = parseJson(bytes, path);
  const ref = (value: unknown): InputRef | null => {
    if (value === null) return null;
    if (!isRef(value)) throw new Error(`${path} is not a setup`);
    return { key: value.key, revision: value.revision, sha256: value.sha256 };
  };
  if (!isRecord(parsed)) throw new Error(`${path} is not a setup`);
  return { profile: ref(parsed.profile), policy: ref(parsed.policy) };
}

export async function writeSetup(root: OpfsDir, uid: string, setup: ServoSetup): Promise<void> {
  const path = setupPath(uid);
  const { profile, policy } = setup;
  const bytes = new TextEncoder().encode(`${JSON.stringify({ profile, policy }, null, 2)}\n`);
  await writeFile(root, path, bytes);
}
