import type { Field } from "@openservocore/client";
import type { Span } from "./table-read";

export const LIVE_POLL_MS = 1000;
export const FLASH_MS = 800;

/** The span a re-read after a write covers: the one holding `field`, else the field alone. */
export function spanHolding(spans: readonly Span[], field: Pick<Field, "addr" | "width">): Span {
  const end = field.addr + field.width;
  return (
    spans.find((s) => s.addr <= field.addr && end <= s.addr + s.count) ?? {
      addr: field.addr,
      count: field.width,
    }
  );
}

export interface PollOptions {
  periodMs: number;
  /** One read pass. */
  tick: () => Promise<void>;
  /** While true a tick is skipped: an edit is in flight and the next tick picks up its result. */
  hold?: () => boolean;
  onError: (error: unknown) => void;
}

/**
 * Ticks at once and then every `periodMs`, skipping a tick while the previous
 * one is still pending or `hold` is set. An error is reported and polling goes
 * on; only the returned stop ends it.
 */
export function startPoll(o: PollOptions): () => void {
  let pending = false;
  let stopped = false;
  const tick = (): void => {
    if (stopped || pending || o.hold?.() === true) return;
    pending = true;
    o.tick()
      .catch((e: unknown) => {
        if (!stopped) o.onError(e);
      })
      .finally(() => {
        pending = false;
      });
  };
  const timer = setInterval(tick, o.periodMs);
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
