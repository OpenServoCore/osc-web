import type { Progress } from "@openservocore/client-ident";

/** The run's entries in `run.json`, in the order the run reaches them. */
export const RUN_STEPS = [
  "rest",
  "probe",
  "stops",
  "table",
  "window",
  "spins",
  "gather",
  "tune",
  "cruise",
  "final",
] as const;

/** What each step measures, in a sentence. */
export const STEP_TEXT: Readonly<Record<string, string>> = {
  rest: "Reads every sensor with the motor off: the noise on each reading and where zero current sits.",
  probe: "Short pulses find which way the motor turns and a first reading of the winding.",
  stops:
    "Presses the horn into each end stop three times and measures the winding's resistance there.",
  table:
    "Sweeps slowly from stop to stop, counting the motor's ripple, to map the position sensor and find the codes it skips.",
  window:
    "Starts the motor from rest many times to measure how the current reading lags the drive.",
  spins:
    "Spins the horn at three voltages and lets it coast, for the motor constant, the inertia and the drag.",
  gather: "Turns the measurements into the servo's settings. Nothing moves.",
  tune: "Tries the speed gain, highest first, with closed-loop moves at each, until the moves settle.",
  cruise: "Holds steady speeds both ways to measure the friction the loop must overcome.",
  final: "Installs the final settings for now (not saved) and scores 12 moves.",
};

/** A step as the feed has told it: not begun, begun, or ended in the state `run.json` records. */
export type FeedStep =
  | { name: string; phase: "waiting" }
  | { name: string; phase: "running"; try?: { at: number; of: number } }
  | {
      name: string;
      phase: "ended";
      state: string;
      why: string | null;
      try?: { at: number; of: number };
    };

export interface Feed {
  steps: readonly FeedStep[];
  /** Every line told, in order: what the CLI prints. */
  lines: readonly string[];
}

export const FEED_START: Feed = {
  steps: RUN_STEPS.map((name) => ({ name, phase: "waiting" })),
  lines: [],
};

function put(steps: readonly FeedStep[], next: FeedStep): FeedStep[] {
  const at = steps.findIndex((s) => s.name === next.name);
  return at === -1 ? [...steps, next] : steps.map((s, i) => (i === at ? next : s));
}

function tryOf(step: FeedStep | undefined): { at: number; of: number } | undefined {
  return step === undefined || step.phase === "waiting" ? undefined : step.try;
}

export function feedReduce(feed: Feed, p: Progress): Feed {
  const was = (name: string) => feed.steps.find((s) => s.name === name);
  switch (p.event) {
    case "started":
      return { ...feed, steps: put(feed.steps, { name: p.step, phase: "running" }) };
    case "try":
      return {
        ...feed,
        steps: put(feed.steps, { name: p.step, phase: "running", try: { at: p.at, of: p.of } }),
      };
    case "lines":
      return { ...feed, lines: [...feed.lines, ...p.lines] };
    case "ended":
      return {
        ...feed,
        steps: put(feed.steps, {
          name: p.step,
          phase: "ended",
          state: p.state,
          why: p.why,
          try: tryOf(was(p.step)),
        }),
      };
  }
}

/** The step in progress, if one is. */
export function current(feed: Feed): FeedStep | undefined {
  return feed.steps.find((s) => s.phase === "running");
}

/** The share of the run done: the steps ended, the tune and the final check by their tries. */
export function doneShare(feed: Feed): number {
  let done = 0;
  for (const s of feed.steps) {
    if (s.phase === "ended") done += 1;
    else if (s.phase === "running" && s.try !== undefined && s.try.of > 0) {
      done += (s.try.at - 1) / s.try.of;
    }
  }
  return feed.steps.length === 0 ? 0 : done / feed.steps.length;
}

/** A step's state in words: the tool's own once it ended. `over` once the run has ended. */
export function stateText(step: FeedStep, over: boolean): string {
  const tries = (t: { at: number; of: number } | undefined) =>
    t === undefined ? "" : `, try ${String(t.at)} of ${String(t.of)}`;
  switch (step.phase) {
    case "waiting":
      return over ? "not reached" : "waiting";
    case "running":
      return over ? `no end recorded${tries(step.try)}` : `running${tries(step.try)}`;
    case "ended":
      return `${step.state}${tries(step.try)}`;
  }
}
