import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import {
  listSetups,
  policies,
  profiles,
  readSetup,
  refOf,
  writeSetup,
  type ServoProfile,
  type TuningPolicy,
} from "./library";
import { listFiles, readFile, writeFile } from "./opfs";
import { memoryOpfs } from "./opfs-fake";

const mg90: ServoProfile = {
  schema: "osc.servo-profile/1",
  key: "vorpal-mg90",
  revision: 0,
  model: { maker: "Vorpal Robotics", name: "MG90 Micro Servo", variant: "" },
  gear_class: "metal",
  gear_ratio: 308.0533,
  brushes: 2,
  rotor_segments: 3,
  travel_deg: 184.33,
  count_rises_ccw: true,
  operating_v: { min: 4.8, max: 6.6 },
  no_load: [{ at_v: 4.8, seconds: 0.1, per_deg: 60 }],
  stall: [{ at_v: 4.8, torque_kg_cm: 1.8 }],
  output_stopper: "plastic",
  thermal: null,
};

const armJoints: TuningPolicy = {
  schema: "osc.tuning-policy/1",
  key: "arm-joints",
  revision: 0,
  label: "Arm joints",
  motion: { move_speed: { share_of_ceiling: 0.5 }, speed_up: { s: 0.05 } },
};

const hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const json = (bytes: Uint8Array | null): unknown =>
  JSON.parse(new TextDecoder().decode(bytes ?? undefined));

test("a first save writes profiles/<key>.json at revision 1 with its hash", async () => {
  const root = memoryOpfs();
  const saved = await profiles(root).save(mg90);
  const bytes = await readFile(root, "profiles/vorpal-mg90.json");
  expect(bytes).toEqual(saved.bytes);
  expect(saved.sha256).toBe(hex(saved.bytes));
  expect(saved.value.revision).toBe(1);
  expect(json(bytes)).toEqual({ ...mg90, revision: 1 });
  expect(Object.keys(saved.value).slice(0, 3)).toEqual(["schema", "key", "revision"]);
});

test("a policy saves under policies/, apart from the profiles", async () => {
  const root = memoryOpfs();
  await profiles(root).save(mg90);
  await policies(root).save(armJoints);
  expect(await listFiles(root, "policies")).toEqual(["arm-joints.json"]);
  expect(await listFiles(root, "profiles")).toEqual(["vorpal-mg90.json"]);
  expect(await policies(root).get("vorpal-mg90")).toBeNull();
});

test("each save that changes the file bumps the revision; an unchanged save does not", async () => {
  const root = memoryOpfs();
  const shelf = profiles(root);
  const first = await shelf.save(mg90);
  const same = await shelf.save({ ...mg90, revision: first.value.revision });
  expect(same.value.revision).toBe(1);
  expect(same.sha256).toBe(first.sha256);
  const second = await shelf.save({ ...mg90, travel_deg: 184.5 });
  expect(second.value.revision).toBe(2);
  expect(second.value.travel_deg).toBe(184.5);
  const third = await shelf.save({ ...second.value, gear_ratio: 308.05 });
  expect(third.value.revision).toBe(3);
  expect((await shelf.get("vorpal-mg90"))?.value.revision).toBe(3);
});

test("the library owns the revision: a file's own revision is not kept", async () => {
  const root = memoryOpfs();
  const saved = await profiles(root).save({ ...mg90, revision: 7 });
  expect(saved.value.revision).toBe(1);
  expect((await profiles(root).save({ ...mg90, revision: 7, brushes: 4 })).value.revision).toBe(2);
});

test("list gives every stored file by key, and get a missing key null", async () => {
  const root = memoryOpfs();
  const shelf = profiles(root);
  expect(await shelf.list()).toEqual([]);
  await shelf.save({ ...mg90, key: "towerpro-sg90", gear_class: "plastic" });
  await shelf.save(mg90);
  await writeFile(root, "profiles/notes.txt", new TextEncoder().encode("not a profile"));
  const listed = await shelf.list();
  expect(listed.map((e) => e.value.key)).toEqual(["towerpro-sg90", "vorpal-mg90"]);
  expect(listed.map((e) => e.sha256)).toEqual(listed.map((e) => hex(e.bytes)));
  expect(listed[0]?.value.gear_class).toBe("plastic");
  expect(await shelf.get("feetech-sts3215")).toBeNull();
});

test("export gives exactly the stored bytes, even when they are not the library's layout", async () => {
  const root = memoryOpfs();
  const saved = await profiles(root).save(mg90);
  expect(await profiles(root).exportBytes("vorpal-mg90")).toEqual(saved.bytes);

  const own = new TextEncoder().encode(
    '{"revision":4,"key":"arm-joints","schema":"osc.tuning-policy/1","label":"Arm"}',
  );
  await writeFile(root, "policies/arm-joints.json", own);
  const exported = await policies(root).exportBytes("arm-joints");
  expect(exported).toEqual(own);
  expect(hex(exported ?? new Uint8Array())).toBe((await policies(root).get("arm-joints"))?.sha256);
  expect(await policies(root).exportBytes("default")).toBeNull();
});

test("a key that cannot name a file is refused and nothing is written", async () => {
  const root = memoryOpfs();
  for (const key of ["Vorpal-MG90", "vorpal mg90", "../setup", "", "a".repeat(41)]) {
    await expect(profiles(root).save({ ...mg90, key })).rejects.toThrow("cannot name a file");
  }
  expect(await listFiles(root, "profiles")).toEqual([]);
  expect((await profiles(root).save({ ...mg90, key: "a".repeat(40) })).value.revision).toBe(1);
});

test("a stored file under another key's name is refused on read", async () => {
  const root = memoryOpfs();
  const saved = await profiles(root).save(mg90);
  await writeFile(root, "profiles/towerpro-sg90.json", saved.bytes);
  await expect(profiles(root).get("towerpro-sg90")).rejects.toThrow(
    'profiles/towerpro-sg90.json holds the key "vorpal-mg90"',
  );
});

test("setup.json is kept per servo under its uid", async () => {
  const root = memoryOpfs();
  const uid1 = "00000000ffffffff1a2b3c4d5e6f7081";
  const uid2 = "00000000ffffffff0102030405060708";
  expect(await readSetup(root, uid1)).toBeNull();

  const profile = refOf(await profiles(root).save(mg90));
  const policy = refOf(await policies(root).save(armJoints));
  expect(profile).toEqual({
    key: "vorpal-mg90",
    revision: 1,
    sha256: hex((await readFile(root, "profiles/vorpal-mg90.json")) ?? new Uint8Array()),
  });

  await writeSetup(root, uid1, { profile, policy });
  await writeSetup(root, uid2, { profile, policy: null });
  expect(json(await readFile(root, `${uid1}/setup.json`))).toEqual({ profile, policy });
  expect(await readSetup(root, uid1)).toEqual({ profile, policy });
  expect(await readSetup(root, uid2)).toEqual({ profile, policy: null });

  const changed = refOf(await profiles(root).save({ ...mg90, travel_deg: 184.5 }));
  await writeSetup(root, uid2, { profile: changed, policy: null });
  expect((await readSetup(root, uid2))?.profile?.revision).toBe(2);
  expect((await readSetup(root, uid1))?.profile).toEqual(profile);
});

test("every servo's setup lists by uid, other folders left out", async () => {
  const root = memoryOpfs();
  const uid1 = "00000000ffffffff1a2b3c4d5e6f7081";
  const uid2 = "00000000ffffffff0102030405060708";
  const profile = refOf(await profiles(root).save(mg90));
  await writeSetup(root, uid1, { profile, policy: null });
  await writeSetup(root, uid2, { profile: null, policy: null });
  await writeFile(
    root,
    `00000000ffffffff0000000000000003/2026-11-27T00-00-00Z/report.json`,
    new Uint8Array([1]),
  );
  await writeFile(root, "notes/setup.json", new TextEncoder().encode("{}"));
  const setups = await listSetups(root);
  expect([...setups.keys()]).toEqual([uid2, uid1]);
  expect(setups.get(uid1)).toEqual({ profile, policy: null });
});

test("a uid of the wrong form is refused", async () => {
  const root = memoryOpfs();
  for (const uid of [
    "profiles",
    "ffffffff1a2b3c4d5e6f7081",
    "00000000FFFFFFFF1A2B3C4D5E6F7081",
    "00000000ffffffff1a2b3c4d5e6f708g",
  ]) {
    await expect(writeSetup(root, uid, { profile: null, policy: null })).rejects.toThrow(
      "32-character lowercase hex uid",
    );
    await expect(readSetup(root, uid)).rejects.toThrow("32-character lowercase hex uid");
  }
});

test("a setup.json that is not a setup is refused", async () => {
  const root = memoryOpfs();
  const uid = "00000000ffffffff1a2b3c4d5e6f7081";
  await writeFile(root, `${uid}/setup.json`, new TextEncoder().encode('{"profile":"vorpal-mg90"}'));
  await expect(readSetup(root, uid)).rejects.toThrow(`${uid}/setup.json is not a setup`);
  await writeFile(root, `${uid}/setup.json`, new TextEncoder().encode("{"));
  await expect(readSetup(root, uid)).rejects.toThrow(`${uid}/setup.json is not JSON`);
});
