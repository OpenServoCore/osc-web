import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { expect, test } from "vitest";
import { crc32, readZip, writeZip, type ZipEntry } from "./zip";

const bytes = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

test("crc32 gives the standard check value", () => {
  expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array(0))).toBe(0);
});

test("a written zip reads back the same files, byte for byte", async () => {
  const binary = new Uint8Array(256).map((_, i) => 255 - i);
  const files: ZipEntry[] = [
    { path: "20261127T040624Z/run.json", bytes: bytes('{"servo_uid": "x"}\n') },
    { path: "20261127T040624Z/captures/rest/02-raw.csv.gz", bytes: binary },
    { path: "20261127T040624Z/empty", bytes: new Uint8Array(0) },
  ];
  const zip = writeZip(files, new Date(Date.UTC(2026, 10, 27, 4, 6, 24)));
  expect(await readZip(zip)).toEqual(files);
});

test("the same files at the same time give the same zip", () => {
  const files = [{ path: "a/run.json", bytes: bytes("{}") }];
  const at = new Date(Date.UTC(2026, 10, 27));
  expect(writeZip(files, at)).toEqual(writeZip(files, at));
});

// A zip of a run folder as macOS Finder makes one (ditto -c -k --sequesterRsrc
// --keepParent): deflated entries, data descriptors, extra fields, folder
// entries and a __MACOSX side folder.
test("a Finder zip reads every file, deflated ones checked against their CRC", async () => {
  const zip = new Uint8Array(
    readFileSync(new URL("../../tests/fixtures/run-finder.zip", import.meta.url)),
  );
  const files = await readZip(zip);
  expect(files.map((f) => f.path)).toEqual([
    "20261127T040624Z/captures/rest/02-raw.csv.gz",
    "20261127T040624Z/results/rest.json",
    "20261127T040624Z/run.json",
    "__MACOSX/20261127T040624Z/._run.json",
  ]);
  const run = JSON.parse(new TextDecoder().decode(files[2]?.bytes)) as { servo_uid: string };
  expect(run.servo_uid).toBe("00000000ffffffff76e5bc220ef6abcd");
});

/** One deflated entry, built the way zip tools write it. */
function deflatedZip(path: string, content: Uint8Array, crc: number): Uint8Array<ArrayBuffer> {
  const name = bytes(path);
  const packed = deflateRawSync(content);
  const out = new Uint8Array(30 + name.length + packed.length + 46 + name.length + 22);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(8, 8, true);
  v.setUint32(14, crc, true);
  v.setUint32(18, packed.length, true);
  v.setUint32(22, content.length, true);
  v.setUint16(26, name.length, true);
  out.set(name, 30);
  out.set(packed, 30 + name.length);
  const dir = 30 + name.length + packed.length;
  v.setUint32(dir, 0x02014b50, true);
  v.setUint16(dir + 10, 8, true);
  v.setUint32(dir + 16, crc, true);
  v.setUint32(dir + 20, packed.length, true);
  v.setUint32(dir + 24, content.length, true);
  v.setUint16(dir + 28, name.length, true);
  out.set(name, dir + 46);
  const end = dir + 46 + name.length;
  v.setUint32(end, 0x06054b50, true);
  v.setUint16(end + 8, 1, true);
  v.setUint16(end + 10, 1, true);
  v.setUint32(end + 12, 46 + name.length, true);
  v.setUint32(end + 16, dir, true);
  return out;
}

test("a deflated file whose bytes do not match the CRC is refused", async () => {
  const content = bytes("tick,pos\n0,2041\n");
  await expect(readZip(deflatedZip("run.json", content, crc32(content)))).resolves.toEqual([
    { path: "run.json", bytes: content },
  ]);
  await expect(readZip(deflatedZip("run.json", content, crc32(content) ^ 1))).rejects.toThrow(
    "run.json does not match its checksum",
  );
});

test("bytes that are not a zip are refused", async () => {
  await expect(readZip(bytes('{"not": "a zip"}'))).rejects.toThrow("it is not a zip file");
});
