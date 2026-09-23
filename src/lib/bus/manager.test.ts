import type { Field, OscClient, Value } from "@openservocore/client";
import { expect, test } from "vitest";
import { BusManager, type BusClient, type Clock, type Layout, type Snapshot } from "./manager";

// A small control table: goal and torque at the front, the live sensors at
// 10, one far register that cannot share a 252-byte read with the rest.
const FIELDS: Field[] = [
  { name: "goal", addr: 0, width: 2, access: "rw", kind: "int", variants: [] },
  { name: "torque", addr: 2, width: 1, access: "rw", kind: "bool", variants: [] },
  { name: "mode", addr: 3, width: 1, access: "rw", kind: "enum", variants: [] },
  { name: "pos", addr: 10, width: 2, access: "ro", kind: "uint", variants: [] },
  { name: "current", addr: 12, width: 2, access: "ro", kind: "uint", variants: [] },
  { name: "temp", addr: 200, width: 2, access: "ro", kind: "uint", variants: [] },
  { name: "far", addr: 400, width: 2, access: "ro", kind: "uint", variants: [] },
];

const TABLE_SIZE = 512;
/** The manager samples event-loop lag twice a second. */
const LAG_PROBE_MS = 500;

function fieldOf(name: string): Field {
  const f = FIELDS.find((f) => f.name === name);
  if (f === undefined) throw new Error(`no field ${name}`);
  return f;
}

function decodeValue(name: string, bytes: Uint8Array): Value {
  const f = fieldOf(name);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const raw = f.width === 1 ? view.getUint8(0) : view.getUint16(0, true);
  switch (f.kind) {
    case "int":
      return { kind: "int", value: f.width === 1 ? view.getInt8(0) : view.getInt16(0, true) };
    case "bool":
      return { kind: "bool", value: raw !== 0 };
    case "enum":
      return { kind: "enum", value: raw };
    case "bytes":
      return { kind: "bytes", value: bytes.slice() };
    case "uint":
      return { kind: "uint", value: raw };
  }
}

function encodeValue(name: string, value: Value): Uint8Array {
  const f = fieldOf(name);
  if (value.kind === "bytes") return value.value;
  const n = typeof value.value === "boolean" ? Number(value.value) : value.value;
  if (f.width === 1) return new Uint8Array([n & 0xff]);
  const out = new Uint8Array(2);
  new DataView(out.buffer).setInt16(0, n, true);
  return out;
}

interface TestLayout extends Layout {
  decodes: string[];
}

function makeLayout(): TestLayout {
  const decodes: string[] = [];
  return {
    fields: FIELDS,
    decodes,
    decode: (name, bytes) => {
      decodes.push(name);
      return decodeValue(name, bytes);
    },
    encode: encodeValue,
  };
}

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

/** Milliseconds, advanced by hand. */
class FakeClock implements Clock {
  t = 0;
  private timers: Timer[] = [];
  private nextId = 0;

  now(): number {
    return this.t / 1000;
  }

  after(ms: number, fn: () => void): () => void {
    const id = ++this.nextId;
    this.timers.push({ id, at: this.t + ms, fn });
    return () => {
      this.timers = this.timers.filter((x) => x.id !== id);
    };
  }

  get armed(): number[] {
    return this.timers.map((x) => x.at).sort((a, b) => a - b);
  }

  /** Moves the clock without firing anything: the bus was starved. */
  stall(ms: number): void {
    this.t += ms;
  }

  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    await flush();
    for (;;) {
      const due = this.timers
        .filter((x) => x.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = Math.max(this.t, due.at);
      due.fn();
      await flush();
    }
    this.t = target;
    await flush();
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

interface Call {
  kind: "read" | "gread" | "write";
  ids: number[];
  addr: number;
  count: number;
  at: number;
  data?: number[];
}

class FakeClient {
  readonly log: Call[] = [];
  latency = 0;
  overlaps = 0;
  /** "read:1", "read:1:10" or "write:1" to the message that call answers with. */
  readonly failures = new Map<string, string>();
  /** Slots that answer nothing on a group read. */
  readonly silent = new Set<number>();
  gread?: (ids: number[], addr: number, count: number) => Promise<(Uint8Array | undefined)[]>;
  private busy = false;
  private readonly tables = new Map<number, Uint8Array>();

  constructor(
    private readonly clock: FakeClock,
    grouped = false,
  ) {
    if (!grouped) return;
    this.gread = (ids, addr, count) =>
      this.settle({ kind: "gread", ids, addr, count, at: clock.t }, `read:${ids[0] ?? 0}`, () =>
        ids.map((id) => (this.silent.has(id) ? undefined : this.slice(id, addr, count))),
      );
  }

  table(id: number): Uint8Array {
    let t = this.tables.get(id);
    if (t === undefined) {
      t = new Uint8Array(TABLE_SIZE);
      for (let i = 0; i < TABLE_SIZE; i++) t[i] = (id * 16 + i) & 0xff;
      this.tables.set(id, t);
    }
    return t;
  }

  private slice(id: number, addr: number, count: number): Uint8Array {
    return this.table(id).slice(addr, addr + count);
  }

  read(id: number, addr: number, count: number): Promise<Uint8Array> {
    return this.settle(
      { kind: "read", ids: [id], addr, count, at: this.clock.t },
      `read:${id}`,
      () => this.slice(id, addr, count),
    );
  }

  write(id: number, addr: number, data: Uint8Array): Promise<void> {
    return this.settle(
      { kind: "write", ids: [id], addr, count: data.length, at: this.clock.t, data: [...data] },
      `write:${id}`,
      () => {
        this.table(id).set(data, addr);
      },
    );
  }

  private settle<T>(call: Call, key: string, action: () => T): Promise<T> {
    if (this.busy) {
      this.overlaps++;
      return Promise.reject(new Error("busy"));
    }
    this.busy = true;
    this.log.push(call);
    const fail = this.failures.get(`${key}:${call.addr}`) ?? this.failures.get(key);
    const finish = (): T => {
      this.busy = false;
      if (fail !== undefined) throw new Error(fail);
      return action();
    };
    if (this.latency === 0) return Promise.resolve().then(finish);
    return new Promise<T>((resolve, reject) => {
      this.clock.after(this.latency, () => {
        try {
          resolve(finish());
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
  }

  reads(): [number, number, number][] {
    return this.log
      .filter((c) => c.kind === "read" || c.kind === "gread")
      .map((c) => [c.ids[0] ?? 0, c.addr, c.count]);
  }
}

interface Bus {
  clock: FakeClock;
  client: FakeClient;
  manager: BusManager;
  layout: TestLayout;
}

function makeBus(
  options: { gread?: boolean; layoutFrom?: number } & ConstructorParameters<
    typeof BusManager
  >[1] = {},
): Bus {
  const { gread = false, layoutFrom, ...rest } = options;
  const clock = new FakeClock();
  const client = new FakeClient(clock, gread);
  const layout = makeLayout();
  const manager = new BusManager(clock, rest);
  manager.attach(client as unknown as OscClient & BusClient, () =>
    layoutFrom === undefined ? layout : undefined,
  );
  return { clock, client, manager, layout };
}

function collect(): { seen: Snapshot[]; listener: (s: Snapshot) => void } {
  const seen: Snapshot[] = [];
  return { seen, listener: (s) => seen.push(s) };
}

test("three servos, fast and slow subscriptions, writes and commands interleaved: the client never sees an overlap", async () => {
  const { clock, client, manager } = makeBus();
  client.latency = 7;
  for (const id of [1, 2, 3]) {
    manager.subscribe({ id, registers: ["pos", "current"], rate: "fast" }, () => undefined);
    manager.subscribe({ id, registers: ["temp"], rate: "slow" }, () => undefined);
  }
  const promises: Promise<unknown>[] = [];
  for (let i = 0; i < 6; i++) {
    promises.push(manager.write(1 + (i % 3), "goal", { kind: "int", value: i }));
    promises.push(manager.command((c) => c.read(2, 10, 2)));
    await clock.advance(23);
  }
  await clock.advance(500);
  await Promise.all(promises);
  expect(client.overlaps).toBe(0);
  expect(client.log.length).toBeGreaterThan(12);
});

test("a write submitted mid-read starts when that read settles, ahead of every due read", async () => {
  const { clock, client, manager } = makeBus();
  client.latency = 50;
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, () => undefined);
  manager.subscribe({ id: 2, registers: ["pos"], rate: "fast" }, () => undefined);
  await clock.advance(0);
  expect(client.log).toHaveLength(1);
  const write = manager.write(1, "goal", { kind: "int", value: 42 });
  await clock.advance(200);
  await write;
  expect(client.log[1]?.kind).toBe("write");
});

test("writes to one register while one is in flight collapse to the newest; both promises settle together", async () => {
  const { clock, client, manager } = makeBus();
  client.latency = 20;
  const first = manager.write(1, "goal", { kind: "int", value: 1 });
  await flush();
  const second = manager.write(1, "goal", { kind: "int", value: 2 });
  const third = manager.write(1, "goal", { kind: "int", value: 3 });
  await clock.advance(20);
  await first;
  const order: string[] = [];
  void second.then(() => order.push("second"));
  void third.then(() => order.push("third"));
  await clock.advance(20);
  await Promise.all([second, third]);
  expect(order).toEqual(["second", "third"]);
  const writes = client.log.filter((c) => c.kind === "write");
  expect(writes).toHaveLength(2);
  expect(writes[1]?.data).toEqual([3, 0]);
  expect(manager.stats().coalesced).toBe(1);
});

test("writes to different registers of one servo keep submission order", async () => {
  const { clock, client, manager } = makeBus();
  client.latency = 5;
  const first = manager.write(1, "goal", { kind: "int", value: 1 });
  await flush();
  const rest = Promise.all([
    manager.write(1, "torque", { kind: "bool", value: false }),
    manager.write(1, "mode", { kind: "enum", value: 2 }),
    manager.write(1, "goal", { kind: "int", value: 2 }),
  ]);
  await clock.advance(200);
  await Promise.all([first, rest]);
  const writes = client.log.filter((c) => c.kind === "write").map((c) => c.addr);
  expect(writes).toEqual([0, 2, 3, 0]);
});

test("a command is never coalesced with a write or reordered past one", async () => {
  const { clock, client, manager } = makeBus();
  client.latency = 5;
  const first = manager.write(1, "goal", { kind: "int", value: 1 });
  await flush();
  const rest = Promise.all([
    manager.write(1, "goal", { kind: "int", value: 2 }),
    manager.command((c) => c.read(1, 200, 2)),
    manager.write(1, "goal", { kind: "int", value: 3 }),
  ]);
  await clock.advance(200);
  await Promise.all([first, rest]);
  const seen = client.log.map((c) => `${c.kind}:${c.addr}`);
  expect(seen.slice(0, 3)).toEqual(["write:0", "write:0", "read:200"]);
  expect(client.log[1]?.data).toEqual([3, 0]);
});

test("a write dirties its field; the refresh read runs before the next live read and reaches every subscriber covering the field", async () => {
  const { clock, client, manager } = makeBus();
  const live = collect();
  const dirty = collect();
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, live.listener);
  manager.subscribe({ id: 1, registers: ["goal"], rate: "slow" }, dirty.listener);
  await clock.advance(1);
  const before = client.reads().length;
  await manager.write(1, "goal", { kind: "int", value: 77 });
  await flush();
  const after = client.reads().slice(before);
  expect(after[0]).toEqual([1, 0, 2]);
  expect(dirty.seen.at(-1)?.read("goal")).toBe(77);
});

test("a dirty field inside a live span due within a fast period is served by that live read: one exchange", async () => {
  const { clock, client, manager } = makeBus();
  manager.subscribe({ id: 1, registers: ["goal", "pos"], rate: "fast" }, () => undefined);
  await clock.advance(1);
  const before = client.reads().length;
  await manager.write(1, "goal", { kind: "int", value: 5 });
  await flush();
  expect(client.reads().slice(before)).toEqual([[1, 0, 12]]);
});

test("registers of one servo and rate merge into the fewest spans under 252 bytes, gaps read through", async () => {
  const { clock, client, manager } = makeBus();
  manager.subscribe(
    { id: 1, registers: ["goal", "pos", "temp", "far"], rate: "fast" },
    () => undefined,
  );
  await clock.advance(1);
  expect(client.reads()).toEqual([
    [1, 0, 202],
    [1, 400, 2],
  ]);
});

test("a slow field inside a fast span costs no exchange of its own", async () => {
  const { clock, client, manager } = makeBus();
  manager.subscribe({ id: 1, registers: ["goal", "temp"], rate: "fast" }, () => undefined);
  manager.subscribe({ id: 1, registers: ["pos"], rate: "slow" }, () => undefined);
  await clock.advance(1000);
  expect(new Set(client.reads().map(([, addr]) => addr))).toEqual(new Set([0]));
});

test("subscribers on one span receive the same Snapshot object; values are decoded once", async () => {
  const { clock, client, manager, layout } = makeBus();
  const a = collect();
  const b = collect();
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, a.listener);
  manager.subscribe({ id: 1, registers: ["pos", "current"], rate: "fast" }, b.listener);
  await clock.advance(1);
  expect(client.reads()).toEqual([[1, 10, 4]]);
  expect(a.seen).toHaveLength(1);
  expect(a.seen[0]).toBe(b.seen[0]);
  expect(layout.decodes.filter((n) => n === "pos")).toHaveLength(1);
});

test("a 1 s stall of the bus is followed by one read per span, not ten", async () => {
  const { clock, client, manager } = makeBus();
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, () => undefined);
  manager.subscribe({ id: 1, registers: ["far"], rate: "fast" }, () => undefined);
  await clock.advance(1);
  const before = client.reads().length;
  clock.stall(1000);
  await clock.advance(0);
  expect(client.reads().length - before).toBe(2);
});

test("with latency above the fast period the slow class still gets its turn (earliest due first)", async () => {
  const { clock, client, manager } = makeBus();
  client.latency = 150;
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, () => undefined);
  manager.subscribe({ id: 1, registers: ["far"], rate: "slow" }, () => undefined);
  await clock.advance(3000);
  const addrs = client.reads().map(([, addr]) => addr);
  expect(addrs.filter((a) => a === 400).length).toBeGreaterThan(0);
  expect(addrs.filter((a) => a === 10).length).toBeGreaterThan(1);
});

test("utilisation over target lengthens the fast period; two cycles under target shorten it back", async () => {
  const { clock, client, manager } = makeBus({ fastMs: 100, target: 0.6 });
  client.latency = 70;
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, () => undefined);
  await clock.advance(100);
  expect(manager.stats().utilisation).toBeCloseTo(0.7, 3);
  expect(manager.stats().effectivePeriodMs.fast).toBeCloseTo(100 * (0.7 / 0.6), 3);
  client.latency = 0;
  await clock.advance(1000);
  expect(manager.stats().effectivePeriodMs.fast).toBe(100);
});

test("nothing due: the clock is armed for the earliest due and no read is issued meanwhile", async () => {
  const { clock, client, manager } = makeBus();
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, () => undefined);
  await clock.advance(0);
  expect(client.reads()).toHaveLength(1);
  expect(clock.armed).toContain(100);
  await clock.advance(99);
  expect(client.reads()).toHaveLength(1);
  await clock.advance(1);
  expect(client.reads()).toHaveLength(2);
});

test("the same span on three servos goes out as one gread; a silent slot marks only its servo stale", async () => {
  const { clock, client, manager } = makeBus({ gread: true });
  client.silent.add(2);
  const seen = new Map<number, Snapshot>();
  for (const id of [1, 2, 3]) {
    manager.subscribe({ id, registers: ["pos"], rate: "fast" }, (s) => seen.set(id, s));
  }
  await clock.advance(1);
  expect(client.log.filter((c) => c.kind === "gread")).toHaveLength(1);
  expect(client.log[0]?.ids).toEqual([1, 2, 3]);
  expect(seen.get(1)?.stale).toBe(false);
  expect(seen.get(2)?.stale).toBe(true);
  expect(seen.get(3)?.stale).toBe(false);
  expect(manager.stats().grouped).toBe(1);
});

test("without `gread` the same subscriptions produce per-servo reads and identical snapshots", async () => {
  const grouped = makeBus({ gread: true });
  const single = makeBus();
  const from = async (bus: Bus): Promise<[number, number][]> => {
    const out: [number, number][] = [];
    for (const id of [1, 2, 3]) {
      bus.manager.subscribe({ id, registers: ["pos"], rate: "fast" }, (s) => {
        out.push([id, s.read("pos")]);
      });
    }
    await bus.clock.advance(1);
    return out.sort((a, b) => a[0] - b[0]);
  };
  const a = await from(grouped);
  const b = await from(single);
  expect(single.client.log.filter((c) => c.kind === "read")).toHaveLength(3);
  expect(grouped.client.log.filter((c) => c.kind === "gread")).toHaveLength(1);
  expect(b).toEqual(a);
});

test("a failed read marks the snapshot stale, keeps the subscription, three failures switch the servo to the probe cadence, one success restores it", async () => {
  const { clock, client, manager } = makeBus();
  const seen = collect();
  const straddle = collect();
  client.failures.set("read:1", "no reply");
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, seen.listener);
  // pos and far cannot share a 252-byte read, so this one straddles two spans.
  manager.subscribe({ id: 1, registers: ["pos", "far"], rate: "fast" }, straddle.listener);
  await clock.advance(250);
  expect(seen.seen.at(-1)?.stale).toBe(true);
  expect(seen.seen.at(-1)?.error).toBe("no reply");
  expect(straddle.seen.at(-1)?.stale).toBe(true);
  expect(straddle.seen.at(-1)?.error).toBe("no reply");
  expect(manager.stats().perServo.get(1)?.consecutiveFailures).toBeGreaterThanOrEqual(3);
  expect(manager.stats().perServo.get(1)?.probing).toBe(true);
  client.failures.clear();
  const before = client.reads().length;
  await clock.advance(1000);
  expect(client.reads()[before]).toEqual([1, 0, 4]);
  expect(manager.stats().perServo.get(1)?.probing).toBe(false);
  await clock.advance(200);
  expect(client.reads().slice(before + 1)).toContainEqual([1, 10, 2]);
  expect(seen.seen.at(-1)?.stale).toBe(false);
  expect(straddle.seen.at(-1)?.stale).toBe(false);
});

test("a subscriber mounting after a span's read is served from the cache without an exchange; the next read arrives on the span's own due", async () => {
  const { clock, client, manager } = makeBus();
  manager.subscribe({ id: 1, registers: ["pos", "current"], rate: "slow" }, () => undefined);
  await clock.advance(0);
  expect(client.reads()).toEqual([[1, 10, 4]]);
  await clock.advance(400);
  const late = collect();
  manager.subscribe({ id: 1, registers: ["pos"], rate: "slow" }, late.listener);
  await clock.advance(0);
  const table = client.table(1);
  expect(late.seen).toHaveLength(1);
  expect(late.seen[0]?.read("pos")).toBe((table[10] ?? 0) | ((table[11] ?? 0) << 8));
  expect(late.seen[0]?.stale).toBe(false);
  // Dated by the read it came from, not by the moment it was served.
  expect(late.seen[0]?.seq).toBe(1);
  expect(client.reads()).toHaveLength(1);
  await clock.advance(700);
  expect(client.reads()).toHaveLength(2);
  expect(late.seen).toHaveLength(2);
});

test("a timeout inserts the pacing pause before the next exchange", async () => {
  const { clock, client, manager } = makeBus();
  client.failures.set("read:1", "read timeout");
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, () => undefined);
  manager.subscribe({ id: 2, registers: ["pos"], rate: "fast" }, () => undefined);
  await clock.advance(0);
  expect(client.reads()).toHaveLength(1);
  await clock.advance(1);
  expect(client.reads()).toHaveLength(2);
  expect(manager.stats().timeouts).toBe(1);
});

test("unsubscribe during an in-flight read: the cache updates, no listener fires", async () => {
  const { clock, client, manager } = makeBus();
  client.latency = 30;
  const seen = collect();
  const stop = manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, seen.listener);
  await clock.advance(0);
  stop();
  await clock.advance(30);
  expect(seen.seen).toHaveLength(0);
  const after = collect();
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, after.listener);
  manager.detach("unplugged");
  expect(after.seen.at(-1)?.stale).toBe(true);
  const table = client.table(1);
  expect(after.seen.at(-1)?.read("pos")).toBe((table[10] ?? 0) | ((table[11] ?? 0) << 8));
});

test('detach rejects pending writes with "not connected", lets the in-flight settle, marks snapshots stale; attach resumes the same subscriptions', async () => {
  const { clock, client, manager } = makeBus();
  client.latency = 25;
  const seen = collect();
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, seen.listener);
  await clock.advance(0);
  const pending = manager.write(1, "goal", { kind: "int", value: 9 });
  manager.detach("unplugged");
  await expect(pending).rejects.toThrow("not connected");
  expect(seen.seen.at(-1)?.stale).toBe(true);
  await clock.advance(30);
  const before = client.log.length;
  manager.attach(client as unknown as OscClient & BusClient, () => makeLayout());
  await clock.advance(30);
  expect(client.log.length).toBeGreaterThan(before);
  expect(seen.seen.at(-1)?.stale).toBe(false);
});

test("exclusive runs after the in-flight exchange, freezes the lanes, and due times restart without a burst", async () => {
  const { clock, client, manager } = makeBus();
  client.latency = 40;
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, () => undefined);
  manager.subscribe({ id: 2, registers: ["pos"], rate: "fast" }, () => undefined);
  await clock.advance(0);
  const during: number[] = [];
  const job = manager.exclusive(async (c) => {
    during.push(client.log.length);
    await c.read(3, 0, 2);
    during.push(client.log.length);
    return "done";
  });
  await clock.advance(40);
  await clock.advance(40);
  expect(await job).toBe("done");
  // The scan's own read is the only exchange the turn allowed.
  expect(during[1]).toBe((during[0] ?? 0) + 1);
  const after = client.reads().length;
  await clock.advance(99);
  expect(client.reads()).toHaveLength(after);
  await clock.advance(400);
  expect(client.reads().length).toBeGreaterThan(after);
});

test("roster drops a vanished id from scheduling; its subscriber sees stale", async () => {
  const { clock, client, manager } = makeBus();
  const gone = collect();
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, () => undefined);
  manager.subscribe({ id: 2, registers: ["pos"], rate: "fast" }, gone.listener);
  await clock.advance(1);
  manager.roster([1]);
  expect(gone.seen.at(-1)?.stale).toBe(true);
  const before = client.reads().filter(([id]) => id === 2).length;
  await clock.advance(1000);
  expect(client.reads().filter(([id]) => id === 2)).toHaveLength(before);
});

test("a validation rejection rejects the write and dirties nothing", async () => {
  const { clock, client, manager } = makeBus();
  client.failures.set("write:1", "validation");
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, () => undefined);
  await clock.advance(1);
  const before = client.reads().length;
  await expect(manager.write(1, "goal", { kind: "int", value: 1 })).rejects.toThrow("validation");
  await flush();
  expect(client.reads()).toHaveLength(before);
});

test("stats record wait, run, lag, stalled, coalesced and grouped counts and the effective periods", async () => {
  const { clock, client, manager } = makeBus({ gread: true });
  client.latency = 12;
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, () => undefined);
  manager.subscribe({ id: 2, registers: ["pos"], rate: "fast" }, () => undefined);
  // The lag probe measures setTimeout(0) drift: stalling the clock in the
  // instant the probe arms makes the drift exactly the stall.
  clock.after(LAG_PROBE_MS, () => {
    clock.stall(40);
  });
  await clock.advance(0);
  void manager.write(1, "goal", { kind: "int", value: 1 });
  void manager.write(1, "goal", { kind: "int", value: 2 });
  await clock.advance(60);
  const busy = manager.stats();
  expect(busy.wait.p95).toBeGreaterThan(0);
  expect(busy.run.small.p50).toBeGreaterThan(0);
  expect(busy.coalesced).toBe(1);
  expect(busy.grouped).toBeGreaterThan(0);
  client.failures.set("read:1", "recv guard expired");
  await clock.advance(2000);
  const stats = manager.stats();
  expect(stats.exchanges).toBeGreaterThan(busy.exchanges);
  expect(stats.lag.p95).toBeGreaterThanOrEqual(40);
  expect(stats.stalled).toBeGreaterThan(0);
  expect(stats.effectivePeriodMs.slow).toBe(1000);
  expect(stats.recent.length).toBe(Math.min(256, stats.exchanges));
});

test("a subscription before its layout loads is planned on `layoutChanged`", async () => {
  const clock = new FakeClock();
  const client = new FakeClient(clock);
  const manager = new BusManager(clock);
  const held: { layout: Layout | undefined } = { layout: undefined };
  manager.attach(client as unknown as OscClient & BusClient, () => held.layout);
  const seen = collect();
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, seen.listener);
  await clock.advance(500);
  expect(client.log).toHaveLength(0);
  await expect(manager.readOnce(1, ["pos"])).rejects.toThrow("no layout for ID 1");
  held.layout = makeLayout();
  manager.layoutChanged(1);
  await clock.advance(1);
  expect(client.reads()).toEqual([[1, 10, 2]]);
  expect(seen.seen).toHaveLength(1);
});

test("a disconnect-class failure reports lost once and no probe follows the session's detach", async () => {
  const clock = new FakeClock();
  const client = new FakeClient(clock);
  const layout = makeLayout();
  const manager = new BusManager(clock);
  const lost: string[] = [];
  manager.attach(
    client as unknown as OscClient & BusClient,
    () => layout,
    (error) => {
      lost.push(error);
      manager.detach(error);
    },
  );
  const seen = collect();
  manager.subscribe({ id: 1, registers: ["pos"], rate: "fast" }, seen.listener);
  manager.subscribe({ id: 2, registers: ["pos"], rate: "fast" }, () => undefined);
  client.failures.set(
    "read:1",
    "pipe: NotFoundError: Failed to execute 'transferOut' on 'USBDevice': The device was disconnected.",
  );
  await clock.advance(0);
  expect(lost).toHaveLength(1);
  expect(seen.seen.at(-1)?.stale).toBe(true);
  const reads = client.reads().length;
  await clock.advance(5000);
  expect(client.reads()).toHaveLength(reads);
  expect(lost).toHaveLength(1);
  expect(manager.stats().perServo.get(1)?.probing).toBe(false);
});
