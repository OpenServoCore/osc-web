// Every exchange is timed at three points; these are the numbers the ?debug
// panel reads and the hardware procedure records.

export type Lane = "control" | "refresh" | "live" | "exclusive";
export type Kind = "read" | "gread" | "write" | "command";
export type Outcome = "ok" | "timeout" | "stalled" | "error";

export interface Exchange {
  seq: number;
  lane: Lane;
  kind: Kind;
  id: number | undefined;
  addr: number | undefined;
  bytes: number;
  queuedAt: number;
  startedAt: number;
  settledAt: number;
  outcome: Outcome;
}

export interface Quantiles {
  p50: number;
  p95: number;
}

export interface BusStats {
  exchanges: number;
  perSecond: number;
  bytesPerSecond: number;
  /** Milliseconds; p50 and p95 over the last 256 exchanges. */
  wait: Quantiles;
  run: { small: Quantiles; medium: Quantiles; large: Quantiles };
  /** setTimeout(0) drift sampled twice a second: the event-loop lag probe. */
  lag: Quantiles;
  timeouts: number;
  stalled: number;
  errors: number;
  coalesced: number;
  grouped: number;
  utilisation: number;
  effectivePeriodMs: { fast: number; slow: number };
  perServo: ReadonlyMap<number, { consecutiveFailures: number; probing: boolean }>;
  recent: readonly Exchange[];
}

export type SizeClass = "small" | "medium" | "large";

const SMALL_MAX = 32;
const MEDIUM_MAX = 128;
/** Exchanges kept for the quantiles. */
const WINDOW = 256;
/** Lag samples kept, about two minutes at the probe's cadence. */
const LAG_WINDOW = 256;
/** Weight of the newest run in the per-class mean. */
const EWMA_ALPHA = 0.2;

export function sizeClass(bytes: number): SizeClass {
  if (bytes < SMALL_MAX) return "small";
  if (bytes < MEDIUM_MAX) return "medium";
  return "large";
}

const ZERO: Quantiles = { p50: 0, p95: 0 };

function quantiles(values: number[]): Quantiles {
  if (values.length === 0) return ZERO;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { p50: at(0.5), p95: at(0.95) };
}

export interface StatsExtra {
  utilisation: number;
  effectivePeriodMs: { fast: number; slow: number };
  perServo: ReadonlyMap<number, { consecutiveFailures: number; probing: boolean }>;
}

/** The exchange log and the counters over it. */
export class StatsRecorder {
  private readonly ring: Exchange[] = [];
  private readonly lags: number[] = [];
  private readonly mean: Record<SizeClass, number> = { small: 0, medium: 0, large: 0 };
  private exchanges = 0;
  private timeouts = 0;
  private stalled = 0;
  private errors = 0;
  private coalesced = 0;
  private grouped = 0;

  record(e: Exchange): void {
    this.exchanges++;
    this.ring.push(e);
    if (this.ring.length > WINDOW) this.ring.shift();
    switch (e.outcome) {
      case "timeout":
        this.timeouts++;
        break;
      case "stalled":
        this.stalled++;
        break;
      case "error":
        this.errors++;
        break;
      case "ok":
        break;
    }
    if (e.kind !== "read" && e.kind !== "gread") return;
    const c = sizeClass(e.bytes);
    const run = e.settledAt - e.startedAt;
    this.mean[c] = this.mean[c] === 0 ? run : this.mean[c] * (1 - EWMA_ALPHA) + run * EWMA_ALPHA;
  }

  coalesce(): void {
    this.coalesced++;
  }

  group(): void {
    this.grouped++;
  }

  lag(ms: number): void {
    this.lags.push(ms);
    if (this.lags.length > LAG_WINDOW) this.lags.shift();
  }

  /** Milliseconds one read of `bytes` is expected to take. */
  estimate(bytes: number): number {
    return this.mean[sizeClass(bytes)];
  }

  build(extra: StatsExtra): BusStats {
    const first = this.ring[0];
    const last = this.ring.at(-1);
    const seconds =
      first === undefined || last === undefined ? 0 : (last.settledAt - first.startedAt) / 1000;
    const bytes = this.ring.reduce((sum, e) => sum + e.bytes, 0);
    const runs = (c: SizeClass) =>
      quantiles(
        this.ring
          .filter((e) => (e.kind === "read" || e.kind === "gread") && sizeClass(e.bytes) === c)
          .map((e) => e.settledAt - e.startedAt),
      );
    return {
      exchanges: this.exchanges,
      perSecond: seconds > 0 ? this.ring.length / seconds : 0,
      bytesPerSecond: seconds > 0 ? bytes / seconds : 0,
      wait: quantiles(this.ring.map((e) => e.startedAt - e.queuedAt)),
      run: { small: runs("small"), medium: runs("medium"), large: runs("large") },
      lag: quantiles(this.lags),
      timeouts: this.timeouts,
      stalled: this.stalled,
      errors: this.errors,
      coalesced: this.coalesced,
      grouped: this.grouped,
      utilisation: extra.utilisation,
      effectivePeriodMs: extra.effectivePeriodMs,
      perServo: extra.perServo,
      recent: this.ring.slice(),
    };
  }
}

/** A link or servo failure, told apart by the message the client rejected with. */
export function classify(error: unknown): Exclude<Outcome, "ok"> {
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (text.includes("guard") || text.includes("stall")) return "stalled";
  if (text.includes("timeout") || text.includes("timed out") || text.includes("silent")) {
    return "timeout";
  }
  return "error";
}

/** What WebUSB rejects a transfer with once the adapter is gone. */
export const DISCONNECTED = "The device was disconnected.";

// WebUSB words it "The device was disconnected."; the pipe wraps that text and
// the sim reuses it, so the class is read off the message either way.
const GONE = /device (?:was |is |has been )?disconnected|pipe (?:is )?gone/;

/** The adapter itself is gone: the session ends, no retry can reach it. */
export function isDisconnect(error: unknown): boolean {
  return GONE.test((error instanceof Error ? error.message : String(error)).toLowerCase());
}
