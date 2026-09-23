// One scheduler owns the adapter. Pages declare what they need and this
// decides what goes on the wire and when; the client reference never leaves
// the private field below, so an overlapping call cannot be written.

import type { Field, OscClient, Value } from "@openservocore/client";
import type { ReadRegister } from "../units";
import {
  decodeValues,
  field,
  planSpans,
  readerOver,
  within,
  type Layout,
  type Span,
} from "./spans";
import {
  classify,
  StatsRecorder,
  type BusStats,
  type Exchange,
  type Kind,
  type Outcome,
} from "./stats";

export type { BusStats, Exchange, Quantiles } from "./stats";
export type { Layout, Span } from "./spans";

export type Rate = "fast" | "slow";

export interface Subscription {
  id: number;
  registers: readonly string[];
  rate: Rate;
}

export interface Snapshot {
  id: number;
  /** Exchange sequence number, monotonic per manager. */
  seq: number;
  /** clock.now() at the exchange's start, seconds. */
  t: number;
  /** Every field the read covered, decoded once. */
  values: ReadonlyMap<string, Value>;
  /** Numeric accessor over `values`; throws for a bytes field or a name outside the read. */
  read: ReadRegister;
  /** The last read of this span failed, or the servo is silent, or the client is detached. */
  stale: boolean;
  error?: string;
}

/** The slice of OscClient the scheduler drives; `gread` is optional. */
export interface BusClient {
  read(id: number, addr: number, count: number): Promise<Uint8Array>;
  write(id: number, addr: number, data: Uint8Array): Promise<void>;
  gread?(ids: number[], addr: number, count: number): Promise<(Uint8Array | undefined)[]>;
}

export interface Clock {
  /** Seconds. */
  now(): number;
  /** Runs `fn` once after `ms`; returns the cancel. */
  after(ms: number, fn: () => void): () => void;
}

export const systemClock: Clock = {
  now: () => performance.now() / 1000,
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

const FAST_MS = 100;
const SLOW_MS = 1000;
const TARGET = 0.6;
const FAST_CAP_MS = 1000;
const SLOW_CAP_MS = 4000;
/** Consecutive failures that drop a servo to the probe cadence. */
const PROBE_FAILURES = 3;
const PROBE_MS = 1000;
const PROBE: Span = { addr: 0, count: 4 };
/** Fault pacing after a timeout (protocol sec 8). */
const PACE_MS = 1;
const LAG_PROBE_MS = 500;
const STATS_MS = 500;

interface Sub {
  sub: Subscription;
  listener: (s: Snapshot) => void;
  fields: Field[] | undefined;
}

interface PlannedSpan extends Span {
  rate: Rate;
  /** clock time in milliseconds at which this span wants its next read. */
  due: number;
}

/** One register's last reading: the short-lived cache line a span leaves behind. */
interface Cached {
  value: Value;
  t: number;
  seq: number;
}

interface ServoState {
  spans: PlannedSpan[];
  probe: PlannedSpan;
  cache: Map<string, Cached>;
  failures: number;
  probing: boolean;
}

interface Settle<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface WriteItem {
  kind: "write";
  id: number;
  register: string;
  value: Value;
  settle: Settle<void>[];
  queuedAt: number;
}

interface CommandItem {
  kind: "command";
  fn: (client: OscClient) => Promise<unknown>;
  settle: Settle<unknown>;
  queuedAt: number;
}

type ControlItem = WriteItem | CommandItem;

interface ExclusiveItem {
  fn: (client: OscClient) => Promise<unknown>;
  settle: Settle<unknown>;
  queuedAt: number;
}

interface ReadResult {
  values: Map<string, Value>;
  seq: number;
  t: number;
  error?: string;
}

interface RefreshItem {
  id: number;
  addr: number;
  count: number;
  queuedAt: number;
  done?: (result: ReadResult) => void;
}

interface ReadTarget {
  id: number;
  span: PlannedSpan | undefined;
}

interface ReadJob {
  targets: ReadTarget[];
  addr: number;
  count: number;
  queuedAt: number;
  done?: (result: ReadResult) => void;
}

type Job =
  | { lane: "exclusive"; item: ExclusiveItem }
  | { lane: "control"; item: ControlItem }
  | { lane: "refresh" | "live"; read: ReadJob };

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class BusManager {
  private readonly clock: Clock;
  private readonly fastMs: number;
  private readonly slowMs: number;
  private readonly target: number;

  private client: (OscClient & BusClient) | undefined;
  private layoutOf: ((id: number) => Layout | undefined) | undefined;
  private rosterIds: ReadonlySet<number> | undefined;

  private readonly subs = new Set<Sub>();
  private readonly fresh: Sub[] = [];
  private readonly servos = new Map<number, ServoState>();
  private readonly control: ControlItem[] = [];
  private readonly refresh: RefreshItem[] = [];
  private readonly exclusives: ExclusiveItem[] = [];

  private readonly recorder = new StatsRecorder();
  private readonly statsListeners = new Set<() => void>();
  private stopTimer: (() => void) | undefined;
  private stopProbe: (() => void) | undefined;
  private stopStats: (() => void) | undefined;

  private inFlight = false;
  private dispatching = false;
  private seq = 0;
  private utilisation = 0;
  private under = 0;
  private effective: { fast: number; slow: number };

  constructor(clock: Clock, options: { fastMs?: number; slowMs?: number; target?: number } = {}) {
    this.clock = clock;
    this.fastMs = options.fastMs ?? FAST_MS;
    this.slowMs = options.slowMs ?? SLOW_MS;
    this.target = options.target ?? TARGET;
    this.effective = { fast: this.fastMs, slow: this.slowMs };
  }

  // Connection

  attach(client: OscClient & BusClient, layout: (id: number) => Layout | undefined): void {
    this.client = client;
    this.layoutOf = layout;
    const now = this.nowMs();
    for (const id of this.servos.keys()) {
      const state = this.state(id);
      state.failures = 0;
      state.probing = false;
      // A new client knows nothing: the old readings must not be served as fresh.
      state.cache.clear();
      this.replan(id);
      for (const span of state.spans) span.due = now;
    }
    this.startLagProbe();
    this.schedulePump();
  }

  detach(reason: string): void {
    this.client = undefined;
    this.layoutOf = undefined;
    this.arm(undefined);
    this.stopProbe?.();
    this.stopProbe = undefined;
    const pending = this.control.splice(0);
    const refresh = this.refresh.splice(0);
    const exclusives = this.exclusives.splice(0);
    for (const item of pending) this.rejectControl(item, new Error("not connected"));
    for (const item of refresh)
      item.done?.({ values: new Map(), seq: this.seq, t: 0, error: reason });
    for (const item of exclusives) item.settle.reject(new Error("not connected"));
    for (const entry of this.subs) entry.listener(this.fromCache(entry, true, reason));
  }

  layoutChanged(id: number): void {
    this.replan(id);
    this.schedulePump();
  }

  /** After a scan: subscriptions on ids not listed stop scheduling and report `stale`. */
  roster(ids: readonly number[]): void {
    this.rosterIds = new Set(ids);
    for (const id of this.servos.keys()) this.replan(id);
    for (const entry of this.subs) {
      if (this.scheduled(entry.sub.id)) continue;
      entry.listener(this.fromCache(entry, true, "not on the bus"));
    }
    this.schedulePump();
  }

  // Declarations

  subscribe(sub: Subscription, listener: (s: Snapshot) => void): () => void {
    const entry: Sub = { sub, listener, fields: undefined };
    this.subs.add(entry);
    this.fresh.push(entry);
    this.replan(sub.id);
    this.schedulePump();
    return () => {
      this.subs.delete(entry);
      this.replan(sub.id);
    };
  }

  readOnce(id: number, registers: readonly string[]): Promise<Snapshot> {
    const layout = this.layoutOf?.(id);
    if (layout === undefined) return Promise.reject(new Error(`no layout for ID ${id}`));
    let spans: Span[];
    try {
      spans = planSpans(layout.fields, registers);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(message(e)));
    }
    const now = this.nowMs();
    return new Promise<Snapshot>((resolve, reject) => {
      const values = new Map<string, Value>();
      let left = spans.length;
      let failed = false;
      let seq = this.seq;
      let t = this.clock.now();
      if (left === 0) {
        resolve({ id, seq, t, values, read: readerOver(values), stale: false });
        return;
      }
      for (const s of spans) {
        this.refresh.push({
          id,
          addr: s.addr,
          count: s.count,
          queuedAt: now,
          done: (result) => {
            if (failed) return;
            if (result.error !== undefined) {
              failed = true;
              reject(new Error(result.error));
              return;
            }
            for (const [name, value] of result.values) values.set(name, value);
            seq = result.seq;
            t = result.t;
            if (--left > 0) return;
            resolve({ id, seq, t, values, read: readerOver(values), stale: false });
          },
        });
      }
      this.pump();
    });
  }

  write(id: number, register: string, value: Value): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.client === undefined) {
        reject(new Error("not connected"));
        return;
      }
      const pending = this.control.find(
        (i): i is WriteItem => i.kind === "write" && i.id === id && i.register === register,
      );
      if (pending !== undefined) {
        pending.value = value;
        pending.settle.push({ resolve, reject });
        this.recorder.coalesce();
        return;
      }
      this.control.push({
        kind: "write",
        id,
        register,
        value,
        settle: [{ resolve, reject }],
        queuedAt: this.nowMs(),
      });
      this.pump();
    });
  }

  command<T>(fn: (client: OscClient) => Promise<T>): Promise<T> {
    return this.enqueue(fn, (item) => {
      this.control.push({ kind: "command", ...item });
    });
  }

  exclusive<T>(fn: (client: OscClient) => Promise<T>): Promise<T> {
    return this.enqueue(fn, (item) => {
      this.exclusives.push(item);
    });
  }

  private enqueue<T>(
    fn: (client: OscClient) => Promise<T>,
    push: (item: ExclusiveItem) => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.client === undefined) {
        reject(new Error("not connected"));
        return;
      }
      push({
        fn,
        settle: {
          resolve: (value) => {
            resolve(value as T);
          },
          reject,
        },
        queuedAt: this.nowMs(),
      });
      this.pump();
    });
  }

  // Statistics

  stats(): BusStats {
    const perServo = new Map<number, { consecutiveFailures: number; probing: boolean }>();
    for (const [id, state] of this.servos) {
      perServo.set(id, { consecutiveFailures: state.failures, probing: state.probing });
    }
    return this.recorder.build({
      utilisation: this.utilisation,
      effectivePeriodMs: { ...this.effective },
      perServo,
    });
  }

  onStats(listener: () => void): () => void {
    this.statsListeners.add(listener);
    if (this.statsListeners.size === 1) this.tickStats();
    return () => {
      this.statsListeners.delete(listener);
      if (this.statsListeners.size > 0) return;
      this.stopStats?.();
      this.stopStats = undefined;
    };
  }

  private tickStats(): void {
    this.stopStats = this.clock.after(STATS_MS, () => {
      for (const listener of this.statsListeners) listener();
      if (this.statsListeners.size > 0) this.tickStats();
    });
  }

  private startLagProbe(): void {
    this.stopProbe?.();
    const tick = (): void => {
      const at = this.clock.now();
      this.clock.after(0, () => {
        this.recorder.lag((this.clock.now() - at) * 1000);
      });
      this.stopProbe = this.clock.after(LAG_PROBE_MS, tick);
    };
    tick();
  }

  // Planning

  private nowMs(): number {
    return this.clock.now() * 1000;
  }

  private period(rate: Rate): number {
    return rate === "fast" ? this.effective.fast : this.effective.slow;
  }

  private scheduled(id: number): boolean {
    return this.rosterIds === undefined || this.rosterIds.has(id);
  }

  private state(id: number): ServoState {
    let state = this.servos.get(id);
    if (state === undefined) {
      state = {
        spans: [],
        probe: { ...PROBE, rate: "slow", due: this.nowMs() },
        cache: new Map(),
        failures: 0,
        probing: false,
      };
      this.servos.set(id, state);
    }
    return state;
  }

  private spansOf(state: ServoState): PlannedSpan[] {
    return state.probing ? [state.probe] : state.spans;
  }

  /** The servo's spans, merged per rate class; a slow field inside a fast span gets none. */
  private replan(id: number): void {
    const state = this.state(id);
    const layout = this.layoutOf?.(id);
    const mine = [...this.subs].filter((e) => e.sub.id === id);
    if (mine.length === 0 || layout === undefined) {
      state.spans = [];
      return;
    }
    const names = (rate: Rate) =>
      mine.filter((e) => e.sub.rate === rate).flatMap((e) => e.sub.registers);
    const fast = planSpans(layout.fields, names("fast"));
    const slow = planSpans(layout.fields, names("slow"), fast);
    const now = this.nowMs();
    const keep = (s: Span, rate: Rate): PlannedSpan => {
      const prior = state.spans.find(
        (p) => p.addr === s.addr && p.count === s.count && p.rate === rate,
      );
      return { ...s, rate, due: prior?.due ?? now };
    };
    state.spans = [...fast.map((s) => keep(s, "fast")), ...slow.map((s) => keep(s, "slow"))];
    for (const entry of mine)
      entry.fields = [...new Set(entry.sub.registers)].map((n) => field(layout.fields, n));
    this.restretch();
  }

  /** Effective periods follow the utilisation the subscriptions ask for (sec 3.6). */
  private restretch(): void {
    let u = 0;
    for (const [id, state] of this.servos) {
      if (!this.scheduled(id)) continue;
      for (const s of this.spansOf(state)) {
        u += this.recorder.estimate(s.count) / (s.rate === "fast" ? this.fastMs : this.slowMs);
      }
    }
    this.utilisation = u;
    if (u > this.target) {
      this.under = 0;
      const fast = Math.min((this.fastMs * u) / this.target, FAST_CAP_MS);
      this.effective = {
        fast,
        slow:
          fast >= FAST_CAP_MS
            ? Math.min((this.slowMs * u) / this.target, SLOW_CAP_MS)
            : this.slowMs,
      };
      return;
    }
    if (++this.under >= 2) this.effective = { fast: this.fastMs, slow: this.slowMs };
  }

  // Dispatch

  /**
   * Plans settle before the wire does: subscriptions mounted in one tick
   * merge into one span instead of each firing a read of its own.
   */
  private schedulePump(): void {
    this.arm(
      this.clock.after(0, () => {
        this.stopTimer = undefined;
        this.pump();
      }),
    );
  }

  private pump(): void {
    this.serveFresh();
    if (this.inFlight || this.client === undefined) return;
    const job = this.pick();
    if (job === undefined) {
      this.armNext();
      return;
    }
    this.arm(undefined);
    this.inFlight = true;
    void this.execute(job);
  }

  private pick(): Job | undefined {
    const exclusive = this.exclusives.shift();
    if (exclusive !== undefined) return { lane: "exclusive", item: exclusive };
    const control = this.control.shift();
    if (control !== undefined) return { lane: "control", item: control };
    const now = this.nowMs();
    const item = this.refresh[0];
    if (item !== undefined) {
      this.refresh.shift();
      const live = this.liveCovering(item, now);
      if (live !== undefined) {
        live.due = now + this.period(live.rate);
        return {
          lane: "live",
          read: {
            targets: [{ id: item.id, span: live }],
            addr: live.addr,
            count: live.count,
            queuedAt: item.queuedAt,
            done: item.done,
          },
        };
      }
      return {
        lane: "refresh",
        read: {
          targets: [{ id: item.id, span: undefined }],
          addr: item.addr,
          count: item.count,
          queuedAt: item.queuedAt,
          done: item.done,
        },
      };
    }
    return this.pickLive(now);
  }

  /** Rule 4: a live span that already covers the dirty field and is due soon serves both. */
  private liveCovering(item: RefreshItem, now: number): PlannedSpan | undefined {
    const state = this.servos.get(item.id);
    if (state === undefined || !this.scheduled(item.id)) return undefined;
    return this.spansOf(state).find(
      (s) =>
        s.addr <= item.addr &&
        s.addr + s.count >= item.addr + item.count &&
        s.due <= now + this.effective.fast,
    );
  }

  private pickLive(now: number): Job | undefined {
    let best: { id: number; span: PlannedSpan } | undefined;
    for (const [id, state] of this.servos) {
      if (!this.scheduled(id)) continue;
      for (const span of this.spansOf(state)) {
        if (span.due > now) continue;
        if (best === undefined || span.due < best.span.due) best = { id, span };
      }
    }
    if (best === undefined) return undefined;
    const chosen = best;
    const targets: ReadTarget[] = [{ id: chosen.id, span: chosen.span }];
    if (this.client?.gread !== undefined) {
      for (const [id, state] of this.servos) {
        if (id === chosen.id || !this.scheduled(id)) continue;
        const span = this.spansOf(state).find(
          (s) =>
            s.addr === chosen.span.addr &&
            s.count === chosen.span.count &&
            s.due <= now + this.period(s.rate),
        );
        if (span !== undefined) targets.push({ id, span });
      }
    }
    for (const t of targets) {
      if (t.span !== undefined) t.span.due = now + this.period(t.span.rate);
    }
    return {
      lane: "live",
      read: { targets, addr: chosen.span.addr, count: chosen.span.count, queuedAt: now },
    };
  }

  private async execute(job: Job): Promise<void> {
    const client = this.client;
    if (client === undefined) {
      this.inFlight = false;
      return;
    }
    // Development assertion: two client calls can never overlap (sec 4).
    if (this.dispatching) throw new Error("bus dispatch re-entered");
    this.dispatching = true;
    const seq = ++this.seq;
    const startedAt = this.nowMs();
    const t = this.clock.now();
    let outcome: Outcome = "ok";
    let kind: Kind = "command";
    let bytes = 0;
    let id: number | undefined;
    let addr: number | undefined;
    let queuedAt = startedAt;
    try {
      switch (job.lane) {
        case "exclusive": {
          queuedAt = job.item.queuedAt;
          try {
            job.item.settle.resolve(await job.item.fn(client));
          } catch (e) {
            outcome = classify(e);
            job.item.settle.reject(e);
          }
          this.restart();
          break;
        }
        case "control": {
          queuedAt = job.item.queuedAt;
          if (job.item.kind === "command") {
            try {
              job.item.settle.resolve(await job.item.fn(client));
            } catch (e) {
              outcome = classify(e);
              job.item.settle.reject(e);
            }
            break;
          }
          kind = "write";
          id = job.item.id;
          const item = job.item;
          let f: Field;
          let data: Uint8Array;
          try {
            const layout = this.layoutOf?.(item.id);
            if (layout === undefined) throw new Error(`no layout for ID ${item.id}`);
            f = field(layout.fields, item.register);
            data = layout.encode(item.register, item.value);
          } catch (e) {
            outcome = "error";
            this.rejectControl(item, e);
            break;
          }
          addr = f.addr;
          bytes = data.length;
          try {
            await client.write(item.id, f.addr, data);
            for (const s of item.settle) s.resolve();
            this.markDirty(item.id, f);
          } catch (e) {
            outcome = classify(e);
            this.rejectControl(item, e);
          }
          break;
        }
        case "refresh":
        case "live": {
          const { read } = job;
          queuedAt = read.queuedAt;
          kind = read.targets.length > 1 ? "gread" : "read";
          addr = read.addr;
          id = read.targets.length === 1 ? read.targets[0]?.id : undefined;
          bytes = read.count * read.targets.length;
          outcome = await this.runRead(client, read, seq, t);
          break;
        }
      }
    } finally {
      this.dispatching = false;
    }
    const settledAt = this.nowMs();
    const exchange: Exchange = {
      seq,
      lane: job.lane,
      kind,
      id,
      addr,
      bytes,
      queuedAt,
      startedAt,
      settledAt,
      outcome,
    };
    this.recorder.record(exchange);
    this.restretch();
    this.inFlight = false;
    if (outcome === "timeout") {
      this.clock.after(PACE_MS, () => {
        this.pump();
      });
      return;
    }
    this.pump();
  }

  private async runRead(
    client: OscClient & BusClient,
    read: ReadJob,
    seq: number,
    t: number,
  ): Promise<Outcome> {
    const gread = client.gread?.bind(client);
    if (read.targets.length > 1 && gread !== undefined) {
      this.recorder.group();
      let parts: (Uint8Array | undefined)[];
      try {
        parts = await gread(
          read.targets.map((x) => x.id),
          read.addr,
          read.count,
        );
      } catch (e) {
        for (const target of read.targets)
          this.fail(target.id, read, seq, t, message(e), read.done);
        return classify(e);
      }
      let outcome: Outcome = "ok";
      read.targets.forEach((target, i) => {
        const bytes = parts[i];
        if (bytes === undefined) {
          outcome = "timeout";
          this.fail(target.id, read, seq, t, "silent", read.done);
          return;
        }
        this.deliver(target.id, read, bytes, seq, t, read.done);
      });
      return outcome;
    }
    const target = read.targets[0];
    if (target === undefined) return "ok";
    try {
      const bytes = await client.read(target.id, read.addr, read.count);
      this.deliver(target.id, read, bytes, seq, t, read.done);
      return "ok";
    } catch (e) {
      this.fail(target.id, read, seq, t, message(e), read.done);
      return classify(e);
    }
  }

  // Fan-out

  private deliver(
    id: number,
    span: Span,
    bytes: Uint8Array,
    seq: number,
    t: number,
    done: ((r: ReadResult) => void) | undefined,
  ): void {
    const layout = this.layoutOf?.(id);
    if (layout === undefined) return;
    const values = decodeValues(layout, span, bytes);
    const state = this.state(id);
    for (const [name, value] of values) state.cache.set(name, { value, t, seq });
    if (state.probing || state.failures > 0) {
      state.probing = false;
      state.failures = 0;
      this.replan(id);
    }
    const snapshot: Snapshot = { id, seq, t, values, read: readerOver(values), stale: false };
    this.fanOut(id, span, snapshot);
    done?.({ values, seq, t });
  }

  private fail(
    id: number,
    span: Span,
    seq: number,
    t: number,
    error: string,
    done: ((r: ReadResult) => void) | undefined,
  ): void {
    const state = this.state(id);
    state.failures++;
    if (state.failures >= PROBE_FAILURES && !state.probing) {
      state.probing = true;
      state.probe.due = this.nowMs() + PROBE_MS;
    }
    // Every subscriber with a field in the failed span hears, straddlers too;
    // what the cache still holds of their own registers rides along.
    for (const entry of this.subs) {
      if (entry.sub.id !== id || entry.fields === undefined) continue;
      if (!entry.fields.some((f) => within(span, f))) continue;
      entry.listener(this.fromCache(entry, true, error));
    }
    done?.({ values: new Map(), seq, t, error });
  }

  /**
   * Every subscriber the read covers gets the same Snapshot object. One whose
   * registers straddle two spans gets them assembled from the servo's cache,
   * once every one of them has landed.
   */
  private fanOut(id: number, span: Span, snapshot: Snapshot): void {
    for (const entry of this.subs) {
      if (entry.sub.id !== id || entry.fields === undefined) continue;
      if (entry.fields.every((f) => within(span, f))) {
        entry.listener(snapshot);
        continue;
      }
      if (!entry.fields.some((f) => within(span, f))) continue;
      const assembled = this.fromCache(entry, false);
      if (assembled.values.size === entry.fields.length) entry.listener(assembled);
    }
  }

  /**
   * The subscription's own registers out of the servo's cache, dated by the
   * oldest of them: a snapshot served this way is never fresher than its
   * stalest member.
   */
  private fromCache(entry: Sub, stale: boolean, error?: string): Snapshot {
    const cache = this.servos.get(entry.sub.id)?.cache;
    const values = new Map<string, Value>();
    let t = this.clock.now();
    let seq = this.seq;
    for (const name of entry.fields?.map((f) => f.name) ?? entry.sub.registers) {
      const hit = cache?.get(name);
      if (hit === undefined) continue;
      values.set(name, hit.value);
      t = Math.min(t, hit.t);
      seq = Math.min(seq, hit.seq);
    }
    return {
      id: entry.sub.id,
      seq,
      t,
      values,
      read: readerOver(values),
      stale,
      error,
    };
  }

  /** A subscriber that mounts mid-period sees the cache at once, not the next read. */
  private serveFresh(): void {
    for (const entry of this.fresh.splice(0)) {
      if (!this.subs.has(entry) || entry.fields === undefined) continue;
      const snapshot = this.fromCache(entry, this.unsure(entry.sub.id));
      if (snapshot.values.size !== entry.fields.length) continue;
      entry.listener(snapshot);
    }
  }

  /** The servo is not being read on its spans right now. */
  private unsure(id: number): boolean {
    if (this.client === undefined || !this.scheduled(id)) return true;
    const state = this.servos.get(id);
    return state !== undefined && (state.probing || state.failures > 0);
  }

  // Bookkeeping

  private rejectControl(item: ControlItem, error: unknown): void {
    if (item.kind === "write") for (const s of item.settle) s.reject(error);
    else item.settle.reject(error);
  }

  /** A write acks: re-read the smallest subscribed span covering it, else the field alone. */
  private markDirty(id: number, f: Field): void {
    const state = this.servos.get(id);
    const covering = state?.spans
      .filter((s) => within(s, f))
      .reduce<Span | undefined>(
        (best, s) => (best === undefined || s.count < best.count ? s : best),
        undefined,
      );
    const span = covering ?? { addr: f.addr, count: f.width };
    const already = this.refresh.some(
      (r) => r.id === id && r.addr === span.addr && r.count === span.count && r.done === undefined,
    );
    if (already) return;
    this.refresh.push({ id, addr: span.addr, count: span.count, queuedAt: this.nowMs() });
  }

  /** After an exclusive turn every span restarts its period, so no burst follows. */
  private restart(): void {
    const now = this.nowMs();
    for (const state of this.servos.values()) {
      for (const span of [...state.spans, state.probe]) span.due = now + this.period(span.rate);
    }
  }

  private arm(cancel: (() => void) | undefined): void {
    this.stopTimer?.();
    this.stopTimer = cancel;
  }

  private armNext(): void {
    let earliest: number | undefined;
    for (const [id, state] of this.servos) {
      if (!this.scheduled(id)) continue;
      for (const span of this.spansOf(state)) {
        if (earliest === undefined || span.due < earliest) earliest = span.due;
      }
    }
    if (earliest === undefined) {
      this.arm(undefined);
      return;
    }
    const wait = Math.max(0, earliest - this.nowMs());
    this.arm(
      this.clock.after(wait, () => {
        this.stopTimer = undefined;
        this.pump();
      }),
    );
  }
}
