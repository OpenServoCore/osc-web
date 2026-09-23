// The React binding for one manager. Reads settle whenever the bus frees;
// this collects them and publishes once per animation frame, so however many
// land inside a frame React renders once and only where a value moved.

import type { Snapshot } from "./manager";

export type Frame = (fn: () => void) => void;

interface Publishable {
  publish: () => void;
}

export class Cell<T> {
  private value: T;
  private staged: T;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: BusStore,
    initial: T,
  ) {
    this.value = initial;
    this.staged = initial;
  }

  readonly get = (): T => this.value;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(next: T): void {
    this.staged = next;
    this.store.stage(this);
  }

  publish = (): void => {
    if (Object.is(this.value, this.staged)) return;
    this.value = this.staged;
    for (const listener of this.listeners) listener();
  };
}

/** The last `windowS` seconds of snapshots, oldest first, one array per frame. */
export class RingCell {
  private buf: Snapshot[] = [];
  private value: readonly Snapshot[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: BusStore,
    private readonly windowS: number,
  ) {}

  readonly get = (): readonly Snapshot[] => this.value;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  push(snapshot: Snapshot): void {
    this.buf.push(snapshot);
    const cutoff = snapshot.t - this.windowS;
    let drop = 0;
    for (const s of this.buf) {
      if (s.t >= cutoff) break;
      drop++;
    }
    if (drop > 0) this.buf.splice(0, drop);
    this.store.stage(this);
  }

  publish = (): void => {
    this.value = this.buf.slice();
    for (const listener of this.listeners) listener();
  };
}

export class BusStore {
  private readonly pending = new Set<Publishable>();
  private scheduled = false;

  constructor(private readonly frame: Frame) {}

  cell<T>(initial: T): Cell<T> {
    return new Cell<T>(this, initial);
  }

  ring(windowS: number): RingCell {
    return new RingCell(this, windowS);
  }

  /** @internal */
  stage(cell: Publishable): void {
    this.pending.add(cell);
    if (this.scheduled) return;
    this.scheduled = true;
    this.frame(() => {
      this.scheduled = false;
      this.flush();
    });
  }

  private flush(): void {
    const cells = [...this.pending];
    this.pending.clear();
    for (const cell of cells) cell.publish();
  }
}

export const animationFrame: Frame =
  typeof requestAnimationFrame === "function"
    ? (fn) => {
        requestAnimationFrame(fn);
      }
    : (fn) => {
        setTimeout(fn, 16);
      };
