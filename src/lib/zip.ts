/** One file of an archive: its path inside it, `/`-separated, and its bytes. */
export interface ZipEntry {
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 a zip stores for a file (IEEE, reflected). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END_SIZE = 22;
const UTF8_NAMES = 0x0800;

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The files of a zip, read through its central directory: stored or deflated,
 * each checked against its CRC-32 and size. Folder entries are left out.
 */
export async function readZip(zip: Uint8Array<ArrayBuffer>): Promise<ZipEntry[]> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  let end = -1;
  // The end record sits last, after a comment of at most 65535 bytes.
  for (let at = zip.length - END_SIZE; at >= Math.max(0, zip.length - END_SIZE - 0xffff); at--) {
    if (u32(at) === END) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("it is not a zip file");
  const count = u16(end + 10);
  const dirSize = u32(end + 12);
  const dirAt = u32(end + 16);
  if (count === 0xffff || dirAt === 0xffffffff || dirSize === 0xffffffff) {
    throw new Error("it is a zip64 archive, which this app does not read");
  }
  if (dirAt + dirSize > end) throw new Error("its file list is cut short");
  const names = new TextDecoder();
  const entries: ZipEntry[] = [];
  let at = dirAt;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== CENTRAL) throw new Error("its file list is damaged");
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const crc = u32(at + 16);
    const packed = u32(at + 20);
    const size = u32(at + 24);
    const nameLen = u16(at + 28);
    const extraLen = u16(at + 30);
    const commentLen = u16(at + 32);
    const headerAt = u32(at + 42);
    const path = names.decode(zip.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/")) continue;
    if (packed === 0xffffffff || size === 0xffffffff || headerAt === 0xffffffff) {
      throw new Error("it is a zip64 archive, which this app does not read");
    }
    if (flags & 1) throw new Error(`${path} is encrypted`);
    if (headerAt + 30 > zip.length || u32(headerAt) !== LOCAL) {
      throw new Error(`${path} has no file header where the list says`);
    }
    const dataAt = headerAt + 30 + u16(headerAt + 26) + u16(headerAt + 28);
    if (dataAt + packed > zip.length) throw new Error(`${path} is cut short`);
    const data = zip.slice(dataAt, dataAt + packed);
    let bytes: Uint8Array<ArrayBuffer>;
    if (method === 0) bytes = data;
    else if (method === 8) {
      try {
        bytes = await inflate(data);
      } catch (e) {
        throw new Error(`${path} does not decompress`, { cause: e });
      }
    } else
      throw new Error(
        `${path} is packed with method ${String(method)}, which this app does not read`,
      );
    if (bytes.length !== size || crc32(bytes) !== crc) {
      throw new Error(`${path} does not match its checksum`);
    }
    entries.push({ path, bytes });
  }
  return entries;
}

function dosTime(t: Date): { time: number; date: number } {
  const year = Math.min(Math.max(t.getUTCFullYear(), 1980), 2107);
  return {
    time: (t.getUTCHours() << 11) | (t.getUTCMinutes() << 5) | (t.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((t.getUTCMonth() + 1) << 5) | t.getUTCDate(),
  };
}

/**
 * A zip of the files, stored (method 0): the bulk of a run is gzipped
 * already. Every entry carries the time `at`, so the same files always give
 * the same zip.
 */
export function writeZip(entries: readonly ZipEntry[], at: Date): Uint8Array<ArrayBuffer> {
  if (entries.length >= 0xffff) throw new Error("too many files for a zip without zip64");
  const encoder = new TextEncoder();
  const { time, date } = dosTime(at);
  const files = entries.map((e) => ({
    name: encoder.encode(e.path),
    bytes: e.bytes,
    crc: crc32(e.bytes),
  }));
  const localSize = files.reduce((n, f) => n + 30 + f.name.length + f.bytes.length, 0);
  const dirSize = files.reduce((n, f) => n + 46 + f.name.length, 0);
  if (localSize + dirSize >= 0xffffffff)
    throw new Error("the files are too large for a zip without zip64");
  const out = new Uint8Array(localSize + dirSize + END_SIZE);
  const view = new DataView(out.buffer);
  const put16 = (at: number, v: number) => {
    view.setUint16(at, v, true);
  };
  const put32 = (at: number, v: number) => {
    view.setUint32(at, v, true);
  };
  const offsets: number[] = [];
  let p = 0;
  for (const f of files) {
    offsets.push(p);
    put32(p, LOCAL);
    put16(p + 4, 20);
    put16(p + 6, UTF8_NAMES);
    put16(p + 8, 0);
    put16(p + 10, time);
    put16(p + 12, date);
    put32(p + 14, f.crc);
    put32(p + 18, f.bytes.length);
    put32(p + 22, f.bytes.length);
    put16(p + 26, f.name.length);
    put16(p + 28, 0);
    out.set(f.name, p + 30);
    out.set(f.bytes, p + 30 + f.name.length);
    p += 30 + f.name.length + f.bytes.length;
  }
  const dirAt = p;
  files.forEach((f, i) => {
    put32(p, CENTRAL);
    put16(p + 4, 20);
    put16(p + 6, 20);
    put16(p + 8, UTF8_NAMES);
    put16(p + 10, 0);
    put16(p + 12, time);
    put16(p + 14, date);
    put32(p + 16, f.crc);
    put32(p + 20, f.bytes.length);
    put32(p + 24, f.bytes.length);
    put16(p + 28, f.name.length);
    put32(p + 42, offsets[i] ?? 0);
    out.set(f.name, p + 46);
    p += 46 + f.name.length;
  });
  put32(p, END);
  put16(p + 8, files.length);
  put16(p + 10, files.length);
  put32(p + 12, p - dirAt);
  put32(p + 16, dirAt);
  return out;
}
