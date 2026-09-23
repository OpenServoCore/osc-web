# Bus manager

One scheduler owns the adapter. Pages declare what they need (registers at a rate, a value to write, a command to run) and the manager decides what goes on the wire and when. Nothing else holds the client.

## 1. Goals and non-goals

Goals

- One owner of the adapter: the `OscClient` instance is reachable only from inside the manager. Components never see it, so an overlapping call ("busy") cannot be written.
- User actions first: a write or a management command waits for at most the exchange already in flight, never for a queue of reads.
- No wasted exchanges: registers wanted by several components are read once per period and decoded once; a write is followed by one read of the span it dirtied, not one read-back per component; the same span on several servos is one group read (protocol sec 6).
- Nothing backlogged: a subscription read that missed its period is served once when the bus frees, never once per miss. Writes to one register collapse to the newest value while one is in flight.
- Identical behaviour on the simulated fleet and on hardware apart from timing: the scheduler depends on an injected clock and an injected client and on nothing else, so the sim (every command resolves within the same task) and the adapter (milliseconds per exchange) run the same decision rule.
- Measurements first-class: every exchange is timed at three points, the statistics are a public value, and a `?debug` readout renders them. The design does not assume which of the two open hypotheses (2 s guard, main-thread starvation) is true; the readout tells them apart.

Non-goals

- Cancelling an exchange in flight: a USB transfer cannot be recalled, so the manager never tries.
- Staged or batched writes: every Save writes immediately (layout-spec, Decisions).
- Changing the protocol, the adapter firmware or the servo firmware. Two small binding additions are asked for in sec 7 and the design works without them.
- Any web worker: WebUSB transfers settle on the main thread either way, so a worker would move the decode, not the latency.

## 2. Cost model

One exchange is one SUBMIT record out over USB, the frames on the bus, and one or more records back. The client (`../open-servo-core/client/src/client.rs`, `collect`) awaits the TERMINAL record before it resolves, so a JS-side call spans all three.

Wire time. A frame is `break + ID + LEN + INST + payload + CRC` = 6 characters plus the payload (protocol sec 3.1), 10 bits per character. Turnaround (instruction wire end to status break) is measured at 34 us at 1 M and 44 us at 3 M (protocol sec 7).

| term                      | formula                          | 1 M         | 3 M         |
| ------------------------- | -------------------------------- | ----------- | ----------- |
| character                 | 10 / baud                        | 10.0 us     | 3.33 us     |
| READ instruction          | (6 + 4) chars                    | 100 us      | 33 us       |
| turnaround                | measured                         | 34 us       | 44 us       |
| READ status, 210 B        | (6 + 210) chars                  | 2160 us     | 720 us      |
| 210 B read, bus total     | sum                              | 2.29 ms     | 0.80 ms     |
| 12 B read (health), total | 100/33 + turn + 18 chars         | 0.31 ms     | 0.14 ms     |
| 2 B write + ack, total    | 12 chars + turn + 6 chars        | 0.21 ms     | 0.10 ms     |
| silent servo (timeout)    | 60 us + reply footprint + margin | about 1 read | about 1 read |

The response deadline (`response_deadline_us`, default 60 us, protocol sec 7) is a break-lead window, not a reply-time budget: the adapter's await window for a read is deadline + the expected reply's wire time + a margin (`firmware/lib/host/src/engine/mod.rs`, `window_for`), so a servo that never answers costs about the same as one that does. Timeouts are cheap; nothing in this design fears them.

Group read. A uniform GREAD over N servos is one instruction of (6 + 4 + N) characters and N status frames that sequence themselves on the wire (slot k starts after slot k-1's end, protocol sec 6), all inside one USB round trip:

    t_gread(N, c) = (10 + N) * t_char + N * (turnaround + (6 + c) * t_char)
    t_single(N, c) = N * (t_usb + 10 * t_char + turnaround + (6 + c) * t_char)

For N = 3 and c = 32 the wire saving is 11% at either baud; the saving that matters is (N - 1) USB round trips. Group reads are worth it exactly when t_usb dominates, which on WebUSB it does.

USB and the browser. The adapter is USB high speed (`firmware/host-ch32/src/hal/usbhs.rs`), so a 258-byte record is one packet and the packet time is under 10 us. What costs is the browser: `transferOut` and each `transferIn` are an IPC hop to the browser process and back, and the continuation runs only when the main thread is free. Per exchange:

    t_exchange = t_ipc_out + t_bus + k * t_ipc_in + t_mainthread

k is 1 if the adapter flushes STATUS and TERMINAL in one USB write and 2 if not; records are length-prefixed and transfer boundaries carry no meaning (`firmware/lib/host/src/link/record.rs`), so k is a property of the adapter's flush, not the format. The native CLI does a 210-byte read in a few milliseconds including process start, so t_ipc on a native stack is well under a millisecond; Chrome's number is unknown.

What dominates on WebUSB: at 3 M the wire is 0.8 ms of a 210-byte read, and t_ipc alone is likely 1 ms or more, so the USB term dominates and any main-thread wait dwarfs both. At 1 M the wire and USB terms are comparable. Consequence: exchanges, not bytes, are the currency. Reading 200 bytes costs about the same as reading 20, so spans merge across gaps freely (sec 3.2) and group reads replace per-servo reads (sec 3.7).

Unknowns and how the manager exposes them (sec 3.9, `BusStats`):

| unknown                          | measure                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| t_ipc (intercept)                | `run` p50 of the 12 B span vs the 210 B span at one baud: intercept of the line          |
| t_char check (slope)             | the same line's slope per byte; expect 10 us at 1 M, 3.3 us at 3 M                        |
| k (transfers per exchange)       | `transfersIn` counter divided by `exchanges` (needs the pipe counter, sec 7 Q2)           |
| t_mainthread                     | `lag` p95 (event-loop lag probe) and the intercept's change between Dashboard and Live    |
| guard hits                       | `stalled` count; a hit shows as `run` near 2000 ms                                        |

## 3. Architecture

Files: `src/lib/bus/manager.ts` (scheduler), `src/lib/bus/spans.ts` (register to span planning and decode, absorbs `card-poll.ts` and `telemetry-poll.ts` helpers), `src/lib/bus/stats.ts`, `src/lib/bus/store.ts` (React binding), `src/lib/bus/hooks.ts`. The manager imports React nowhere.

### 3.1 Lanes and their ordering rule

| lane      | carries                                                                | order inside the lane                         |
| --------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| control   | register writes, management commands (save, reboot, factory, assign, clear counters, rails, tel burst) | submission order per servo; writes coalesced per (servo, register) |
| refresh   | dirty spans after a write; one-shot reads (`readOnce`)                 | oldest first                                  |
| live      | subscription spans, rate class fast (100 ms) or slow (1000 ms)         | earliest due first                            |
| exclusive | scan, bus baud migration: the lanes freeze while it runs               | one at a time                                 |

Decision rule, run every time the bus frees and every time an item arrives while the bus is idle:

1. If an exchange is in flight, do nothing; step 2 runs when it settles.
2. If an exclusive item is waiting, run it. Subscriptions do not schedule until it finishes; when it does, every subscription's next due is `now + period` (no burst).
3. Else take the oldest control item. A write whose (servo, register) has a newer pending value was already replaced (sec 3.4), so this is always the newest value.
4. Else take the oldest refresh item. If a live span on the same servo covers it and is due within one fast period, take that live span instead: one read serves both.
5. Else take the live span with the earliest due time among those due (`due <= now`). A span's next due is `start + period` where `start` is when its read started, so a span that waited is not owed extra reads.
6. If the chosen span's (addr, count) is subscribed on other servos whose due times fall within one period of now and the client has `gread`, issue one group read over all of them (sec 3.7).
7. If nothing is due, arm the clock for the earliest due and return. The manager never spins.

A control item therefore waits for at most one exchange: the one in flight when it arrived.

### 3.2 Subscriptions and spans

A subscription names a servo, a list of register names and a rate class. The manager resolves names through the servo's descriptor layout (`Field.addr`, `Field.width`, injected as `layout(id)`), and per (servo, rate class) merges every subscribed field into the fewest spans of at most 252 bytes (`READ_MAX`, protocol sec 5.1): fields sorted by address, each joined to the current span unless that would pass 252. Gaps are read through; per sec 2 a byte costs 3 to 10 us and a second exchange costs a millisecond or more.

A slow-class field that lies inside a fast-class span on the same servo is served by the fast reads and gets no span of its own. A subscription whose layout is not loaded yet is held and planned when `layoutChanged(id)` is called.

### 3.3 Decode once, fan out

When a read settles, the manager decodes the bytes once through the descriptor into `values: Map<name, Value>` for every field the span covers (subscribed or not), builds one immutable `Snapshot`, stores it in the servo's register cache (`name -> {value, t, seq}`), and hands the same object to every subscriber whose registers all lie in the read. Unit conversion stays in the pure helpers (`units.ts`, `control.ts`, `health.ts`), called by the consumer.

### 3.4 Coalescing writes and commands

`write(id, register, value)` is a control item. If an item for the same (id, register) is pending and not yet started, its value is replaced and both promises settle with the outcome of the one exchange that goes out. Distinct registers of one servo keep submission order, so "goal, goal, goal, torque off" becomes "goal(newest), torque off". A slider drag produces writes only as fast as the bus takes them: one in flight, at most one pending. `LatestWins` and its 200 ms gap are deleted.

`command(fn)` is a control item that is never coalesced and never reordered: management verbs, rails, tel bursts, and `identity`. The manager calls `fn` with the client on its turn.

### 3.5 Dirty spans replace read-after-write

When a write acks, the manager marks `[addr, addr + width)` on that servo dirty and enqueues a refresh item for the smallest subscribed span covering it, or the field alone when nothing subscribes to it. The refresh read fans out like any read, so the control cluster, a table row and a dashboard card all see the servo's value from one exchange. A component that wants the acknowledged value awaits `write()` for the ack and reads it from its subscription; it never reads back itself.

### 3.6 Adaptive rate stretching

The manager keeps an exponentially weighted mean of `run` per size class (under 32 B, under 128 B, over) and computes the utilisation the subscriptions ask for:

    U = sum over live spans of run_estimate(span.count) / span.period

When U exceeds the target (0.6, leaving room for control and refresh items), the fast class's effective period becomes `100 ms * U / 0.6`, capped at 1000 ms; the slow class stretches only after the fast class reaches its cap, capped at 4 s. When U falls back under the target for two consecutive cycles the periods shrink toward nominal. Effective periods are part of `BusStats`. Stretching is not what keeps control items prompt (rule 3 does); it keeps the live reads from occupying every free slot so refresh reads and the render loop get theirs.

### 3.7 Group reads

Rule 6 above. The manager plans group reads by (addr, count) across servos, not by register list, so it needs the same span on each servo, which the merge in sec 3.2 produces whenever the same descriptor layout is in use. One silent slot marks only that servo's snapshot stale (`timeout_slot`, `predecessor-silent` per protocol sec 6); the others fan out normally. The wasm bindings expose no `gread` today (`osc_client_web.d.ts`); the manager feature-detects `client.gread` and issues per-servo reads otherwise, with identical fan-out. Group writes are not used: the GUI writes one servo at a time.

### 3.8 Cancellation and stop

- `unsubscribe()` removes the subscription and re-plans the servo's spans. A read already in flight for a span nobody wants settles into the cache and notifies nobody.
- Pending writes are user intent and are never dropped by a re-plan. They are rejected only by `detach` ("not connected").
- `detach(reason)` rejects every pending control and refresh item, lets the exchange in flight settle (its result is discarded), marks every snapshot stale, keeps every subscription. `attach(client, layout)` resumes them with fresh due times. A component therefore subscribes once on mount and survives disconnect, reconnect and rescan.
- `exclusive(fn)` runs `fn` with the client after the in-flight exchange; the lanes are frozen meanwhile. The session's scan and baud migration use it.

### 3.9 Public API

```ts
export type Rate = "fast" | "slow";
export interface Subscription { id: number; registers: readonly string[]; rate: Rate }

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

/** The slice of OscClient the scheduler drives; `gread` is optional (sec 3.7). */
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

export interface Layout { encode: Descriptor["encode"]; decode: Descriptor["decode"]; fields: readonly Field[] }

export class BusManager {
  constructor(clock: Clock, options?: { fastMs?: number; slowMs?: number; target?: number });
  attach(client: OscClient & BusClient, layout: (id: number) => Layout | undefined): void;
  detach(reason: string): void;
  layoutChanged(id: number): void;
  /** After a scan: subscriptions on ids not listed stop scheduling and report `stale`. */
  roster(ids: readonly number[]): void;
  subscribe(sub: Subscription, listener: (s: Snapshot) => void): () => void;
  readOnce(id: number, registers: readonly string[]): Promise<Snapshot>;
  write(id: number, register: string, value: Value): Promise<void>;
  command<T>(fn: (client: OscClient) => Promise<T>): Promise<T>;
  exclusive<T>(fn: (client: OscClient) => Promise<T>): Promise<T>;
  stats(): BusStats;
  onStats(listener: () => void): () => void;
}

export interface Exchange {
  seq: number; lane: "control" | "refresh" | "live" | "exclusive";
  kind: "read" | "gread" | "write" | "command";
  id: number | undefined; addr: number | undefined; bytes: number;
  queuedAt: number; startedAt: number; settledAt: number;
  outcome: "ok" | "timeout" | "stalled" | "error";
}

export interface BusStats {
  exchanges: number; perSecond: number; bytesPerSecond: number;
  /** Milliseconds; p50 and p95 over the last 256 exchanges. */
  wait: { p50: number; p95: number };
  run: { small: Quantiles; medium: Quantiles; large: Quantiles };
  /** setTimeout(0) drift sampled twice a second: the event-loop lag probe. */
  lag: Quantiles;
  timeouts: number; stalled: number; errors: number; coalesced: number; grouped: number;
  utilisation: number;
  effectivePeriodMs: { fast: number; slow: number };
  perServo: ReadonlyMap<number, { consecutiveFailures: number; probing: boolean }>;
  recent: readonly Exchange[];
}
```

Errors: a rejected write or command rejects its promise with the client's error; a failed subscription read sets `stale` and `error` on the snapshot it delivers (sec 4).

### 3.10 React side

`src/lib/bus/store.ts` wraps one manager for `useSyncExternalStore`. Each hook owns a cell; the manager's listener writes `cell.next` and schedules one `requestAnimationFrame` flush for the whole store; the flush publishes `cell.current = cell.next` and notifies only the cells that changed. However many reads settle inside a frame, React renders once per frame, and only the components whose registers moved.

| hook                                                    | returns                                                                       | re-renders when                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| `useRegisters(id, registers, rate)`                     | `Snapshot \| undefined`                                                       | a read covering the registers settled              |
| `useRing(id, registers, rate, windowS)`                 | `readonly Snapshot[]`, fresh array per frame, trimmed to the window            | once per frame while samples land                  |
| `useReadOnce(id, registers, deps)`                      | `{ snapshot, error, reload }`                                                  | the read settled or `reload` was called            |
| `useBus()`                                              | `{ write, command, exclusive }` (stable identities)                            | never                                              |
| `useBusStats()`                                         | `BusStats`                                                                    | twice a second while `?debug` is set               |

The telemetry ring moves out of the Live page into the store (`useRing`); `SampleRing` is deleted. The chart converts rows in a `useMemo` keyed on the ring array and calls `uPlot.setData` once per render, so chart work is bounded to one pass per frame regardless of bus rate.

The session keeps owning connection state and the roster and becomes the manager's host: `connect` creates the client, calls `attach`, runs `exclusive(scan)`, then `roster(ids)`. It no longer exposes `client` or `run`; it exposes `linkInfo` (a value) and `bus` (the manager) through context. The 1 Hz card poll becomes, per servo in the roster, a slow subscription over `LIVE_REGISTERS` plus the health fields and a `readOnce` over `CONSTANT_REGISTERS` (re-run when a calibration write dirties them); `values` is derived from those snapshots, so the sidebar badges and dashboard cards keep working on every page.

## 4. Failure and edge behaviour

| situation                          | behaviour                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "busy" from the wasm client        | Impossible by construction: the client reference lives in one private field of the manager, every call to it is made from one `dispatch` loop that `await`s each call before choosing the next item, and `command`/`exclusive` callbacks receive the client only for the duration of their turn. A development assertion throws if `dispatch` is re-entered. The unit suite runs against a fake client with the same `RefCell` gate. |
| failed exchange (servo error, link error) | A write or command rejects its promise. A subscription read delivers a snapshot with `stale: true` and the message, keeps the subscription, and counts a failure for that servo. After three consecutive failures the servo drops to a probe cadence: one 4-byte read per second in place of all its spans; the first success restores every span. A timeout is followed by a 1 ms pause before the next exchange (protocol sec 8, fault pacing). |
| unplug mid-read                    | The transfer rejects; the item in flight fails as above; the session sees the pipe error, calls `detach("unplugged")`, releases the client. Pending writes reject "not connected"; every snapshot goes stale; subscriptions stay. Reconnect calls `attach` and they resume. |
| rescan while subscriptions exist   | `exclusive(scan)` freezes the lanes; after it `roster(ids)` stops scheduling ids that vanished and re-plans ids whose layout changed. Components keyed on id remount on their own. Due times restart, so no burst follows the scan.                 |
| servo disappears                   | Its reads time out at about the cost of one read each (sec 2); the probe cadence caps the cost at one small exchange per second; its snapshots carry `stale` and the sidebar derives "not answering" from `perServo.probing`.                     |
| write whose read-back disagrees    | The servo is the truth: the refresh snapshot carries what it holds (a clamped goal, a rejected enum). The manager keeps no expected value. The control cluster clears its draft when the refresh snapshot lands, so the slider snaps to the servo's value. A `validation` result rejects the write itself and dirties nothing. |
| the 2 s guard                      | `recv_guarded` (`client.rs`) is a watchdog on the pipe, orders of magnitude above every protocol window; a hit means the adapter delivered nothing for 2 s. The manager counts it as `stalled`, treats it as a failure (probe cadence after three), and shows it in `run` as a value near 2000 ms. It cannot be shortened from TS today (sec 7 Q2). |
| slow main thread                   | `run` already includes the wait for the continuation, so stretching (sec 3.6) responds automatically; the `lag` probe distinguishes it from a slow adapter. Rendering is bounded to one pass per frame (sec 3.10). Control items still go first, so a goal write waits one exchange, not a queue. |
| descriptor not loaded              | Subscriptions naming registers wait for `layoutChanged`; `readOnce` rejects with "no layout for ID n".                                                                                                                                            |
| more than 252 B requested at once  | `readOnce` splits into several spans and merges the maps into one snapshot; a subscription does the same per rate class.                                                                                                                          |

## 5. Migration plan

Three PRs; every existing browser spec stays green at each boundary because components are moved one at a time and the sim resolves every exchange within the same task.

PR 1: manager, store, hooks, stats, session hosting. The session creates the manager, moves its own traffic onto it (scan and baud via `exclusive`, rails via `command`, the card poll as slow subscriptions plus constants `readOnce`), and re-exports `run` as `bus.command` so untouched components keep working with no overlap possible. `?debug` renders `useBusStats()` in a fixed corner panel. Deletes `src/lib/command-queue.ts` and its test (the uncommitted trace in it becomes `stats.ts`); `card-poll.ts` keeps `plan`, `span`, `decodeSpan`, `constantsFrom`, `liveFrom`, `faultText` under `bus/spans.ts` and loses `readCard`, `POLL_MS`. Unit suite for the manager lands here (sec 6).

PR 2: Live page. `Telemetry` subscribes fast to `SAMPLE_REGISTERS` through `useRing` and once to `CONFIG_REGISTERS` and `BIAS_REGISTERS` through `useReadOnce`; `Controls` subscribes fast to `CONTROL_REGISTERS` (they lie inside the sample span, so it costs no exchange) and once to `LIMIT_REGISTERS`; the slider calls `bus.write` per change and the draft clears on the next snapshot whose `seq` is past the write; mode and torque are plain `bus.write`. `StreamTab` reads its config once and arms the burst via `bus.command`. Deletes `startTelemetry`, `SampleRing`, `TelemetryOptions` from `telemetry-poll.ts` (the file becomes `telemetry.ts` with `Sample`, `decodeSample`, the register lists), `LatestWins` and `GOAL_WRITE_GAP_MS` from `control.ts`, `writeControl` and `spansOver` from `live.tsx`.

PR 3: Servo page and control table. `HealthCard` subscribes slow to the health fields (`fault_flags`, `status_flags`, `trim_steps`, `crc_fail_count`, `framing_drop_count`) and clears counters via `bus.command`; `AboutCard` uses `useReadOnce` over the identity fields; `CalibrationCard` writes via `bus.write` and drops `own` (the dirty read refreshes the session's constants); `ManageCard.useTorque` becomes `useRegisters(id, ["torque_enable"], "slow")` and its actions become `bus.command` followed by the session's `discover`; `TabPanel` uses `useReadOnce` over the tab's rows for the static tabs (`reload` on Refresh) and a slow subscription for Live values, and `apply` is `bus.write` with the flash keyed on the next snapshot. Deletes `src/lib/table-live.ts` and its test (`FLASH_MS` moves to `table.tsx`), `readRows` from `table-read.ts` (`readSpans` and `decodeSpan` move to `bus/spans.ts`), `readCalibration` from `calibration-card.tsx`, and finally `Session.run` and `Session.client`.

## 6. Tests

Unit suite, `src/lib/bus/manager.test.ts`, with a fake clock (manual advance) and a fake client whose latency and outcome are settable per call and which throws "busy" on overlap exactly like the wasm one:

| test                                                                                                   | pins                                     |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| three servos, fast and slow subscriptions, writes and commands interleaved: the client never sees an overlap | one exchange in flight (sec 4)      |
| a write submitted mid-read starts when that read settles, ahead of every due read                      | rule 3                                   |
| writes to one register while one is in flight collapse to the newest; both promises settle together    | sec 3.4                                  |
| writes to different registers of one servo keep submission order                                       | sec 3.4                                  |
| a command is never coalesced with a write or reordered past one                                        | sec 3.4                                  |
| a write dirties its field; the refresh read runs before the next live read and reaches every subscriber covering the field | sec 3.5                      |
| a dirty field inside a live span due within a fast period is served by that live read: one exchange    | rule 4                                   |
| registers of one servo and rate merge into the fewest spans under 252 bytes, gaps read through          | sec 3.2                                  |
| a slow field inside a fast span costs no exchange of its own                                           | sec 3.2                                  |
| subscribers on one span receive the same Snapshot object; values are decoded once                       | sec 3.3                                  |
| a 1 s stall of the bus is followed by one read per span, not ten                                       | rule 5, no backlog                       |
| with latency above the fast period the slow class still gets its turn (earliest due first)             | rule 5                                   |
| utilisation over target lengthens the fast period; two cycles under target shorten it back             | sec 3.6                                  |
| nothing due: the clock is armed for the earliest due and no read is issued meanwhile                    | rule 7                                   |
| the same span on three servos goes out as one gread; a silent slot marks only its servo stale          | sec 3.7                                  |
| without `gread` the same subscriptions produce per-servo reads and identical snapshots                  | sec 3.7                                  |
| a failed read marks the snapshot stale, keeps the subscription, three failures switch the servo to the probe cadence, one success restores it | sec 4 |
| a timeout inserts the pacing pause before the next exchange                                            | sec 4                                    |
| unsubscribe during an in-flight read: the cache updates, no listener fires                              | sec 3.8                                  |
| detach rejects pending writes with "not connected", lets the in-flight settle, marks snapshots stale; attach resumes the same subscriptions | sec 3.8 |
| exclusive runs after the in-flight exchange, freezes the lanes, and due times restart without a burst  | rule 2                                   |
| roster drops a vanished id from scheduling; its subscriber sees stale                                   | sec 3.8                                  |
| a validation rejection rejects the write and dirties nothing                                           | sec 4                                    |
| stats record wait, run, lag, stalled, coalesced and grouped counts and the effective periods            | sec 3.9                                  |
| a subscription before its layout loads is planned on `layoutChanged`                                   | sec 4                                    |

`src/lib/bus/store.test.ts`: listeners fire once per animation frame however many reads land; only changed cells notify; the ring publishes a fresh array per frame and trims to the window. `src/lib/bus/spans.test.ts` takes over the span and decode tests from `card-poll.test.ts`, `telemetry-poll.test.ts` and `table-read.test.ts`.

Browser specs. None of the existing tests changes its assertions. `control.spec.ts` "a goal past the rail stops at it" and "torque on reads back on" now exercise coalescing and the dirty read; `table-edit.spec.ts` "a number edit shows after apply and survives a refresh" exercises `readOnce` and `reload`. One new spec, `tests/e2e/bus.spec.ts` on `?sim=1,2&debug`: after a 2 s slider drag on the Live page the readout equals the last goal, the stats panel shows `stalled 0`, `errors 0`, `coalesced > 0`; on the Dashboard with two servos `grouped > 0` once the binding exists.

Hardware procedure, with the `?debug` panel, one servo, the adapter at 3 M:

1. Dashboard only, 30 s. Record `run` p50 for the small (health) and large (live span, 210 B) classes. Intercept = t_ipc plus k transfers; slope per byte should be near 3.3 us. Repeat at 1 M: slope near 10 us, intercept unchanged.
2. Open Live, 30 s. If the intercept rises and `lag` p95 rises with it, the main thread is the bottleneck. If `stalled` is nonzero and `run` shows values near 2000 ms, the guard is firing. Either way `wait` p95 for control items must stay under one large `run` p95.
3. Drag the slider for 5 s, release: the readout converges within one exchange of the release; `coalesced` grows during the drag. Toggle torque off: the switch reflects the servo's value within two exchanges and stays off.
4. Two servos on the Dashboard: `grouped` grows and `perSecond` for the card spans halves against step 1.

## 7. Open questions

1. `gread` in the web bindings (`client/web/src/client.rs`, wrapping `Client::gread`). Recommendation: add it in the monorepo before PR 1 lands; the manager feature-detects it, so nothing blocks on it.
2. Guard and transfer counters. `set_guard` is not exposed, nor is a per-pipe count of `transferIn` calls. Recommendation: expose `setGuard(ms)` and `transfersIn()` on `OscClient`; set the guard to 250 ms for the GUI (every engine window is under 10 ms at any baud, so 250 ms only ever catches a dead adapter) and use the counter to pin k in sec 2.
3. Where the effective rate shows. The Live header prints a fixed "10 Hz". Recommendation: leave the header alone; the effective period lives in the `?debug` panel only.
4. Fleet card poll on every page. Keeping the slow subscriptions for every servo alive on every page costs two exchanges per second per servo, one per second per span once grouped. Recommendation: keep it; the sidebar badges depend on it and grouping makes it flat in the fleet size.
5. NOREPLY writes for the slider (protocol sec 7 hot loop). The ack is how a `validation` result reaches the user, and `write_noreply` is not exposed. Recommendation: no; the coalescing already bounds a drag to one exchange in flight.
