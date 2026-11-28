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
  resume:
    "Checks the servo is the one the run began on, with the same settings, firmware and supply, waits for the winding to cool where a cold step runs again, then sets the stopped step's files aside.",
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

/** The step a resume's own checks, cooling and re-seat are told under; its row shows above the steps. */
export const RESUME_STEP = "resume";

/** Unit `at` of `of` inside a step, as the run told it: "seat 3 of 6". */
export interface StepUnit {
  at: number;
  of: number;
  what: string;
}

/**
 * A step as the feed has told it: not begun, begun, or ended in the state `run.json` records.
 * `fraction` is the step's ring, 0 to 1: the largest `(at - 1) / of` its units told, never going
 * back, full on accept, frozen at the end otherwise. The tune's and the final check's ring is the
 * current try's, from 0 again at each try.
 */
export type FeedStep =
  | { name: string; phase: "waiting"; fraction: number }
  | {
      name: string;
      phase: "running";
      fraction: number;
      try?: { at: number; of: number };
      unit?: StepUnit;
    }
  | {
      name: string;
      phase: "ended";
      state: string;
      why: string | null;
      fraction: number;
      try?: { at: number; of: number };
      unit?: StepUnit;
    };

export interface Feed {
  steps: readonly FeedStep[];
  /** Every line told, in order: what the CLI prints. */
  lines: readonly string[];
}

export const FEED_START: Feed = {
  steps: RUN_STEPS.map((name) => ({ name, phase: "waiting", fraction: 0 })),
  lines: [],
};

/** The steps as a stopped run's folder records them, before anything of a resume is told. */
export function feedOfSteps(
  steps: readonly { name: string; state: string; why: string | null }[],
): Feed {
  return steps.reduce<Feed>(
    (f, s) => ({
      ...f,
      steps: put(f.steps, {
        name: s.name,
        phase: "ended",
        state: s.state,
        why: s.why,
        fraction: s.state === "accepted" ? 1 : 0,
      }),
    }),
    FEED_START,
  );
}

function put(steps: readonly FeedStep[], next: FeedStep): FeedStep[] {
  const at = steps.findIndex((s) => s.name === next.name);
  if (at !== -1) return steps.map((s, i) => (i === at ? next : s));
  return next.name === RESUME_STEP ? [next, ...steps] : [...steps, next];
}

function tryOf(step: FeedStep | undefined): { at: number; of: number } | undefined {
  return step === undefined || step.phase === "waiting" ? undefined : step.try;
}

export function feedReduce(feed: Feed, p: Progress): Feed {
  const was = (name: string) => feed.steps.find((s) => s.name === name);
  switch (p.event) {
    case "started":
      return { ...feed, steps: put(feed.steps, { name: p.step, phase: "running", fraction: 0 }) };
    case "try":
      return {
        ...feed,
        steps: put(feed.steps, {
          name: p.step,
          phase: "running",
          fraction: 0,
          try: { at: p.at, of: p.of },
        }),
      };
    case "unit": {
      const s = was(p.step);
      if (s?.phase !== "running") return feed;
      const share = p.of > 0 ? Math.min(1, Math.max(0, (p.at - 1) / p.of)) : 0;
      return {
        ...feed,
        steps: put(feed.steps, {
          ...s,
          fraction: Math.max(s.fraction, share),
          unit: { at: p.at, of: p.of, what: p.what },
        }),
      };
    }
    case "lines":
      return { ...feed, lines: [...feed.lines, ...p.lines] };
    case "ended": {
      const s = was(p.step);
      return {
        ...feed,
        steps: put(feed.steps, {
          name: p.step,
          phase: "ended",
          state: p.state,
          why: p.why,
          fraction: p.state === "accepted" ? 1 : (s?.fraction ?? 0),
          try: tryOf(s),
          unit: s?.phase === "running" ? s.unit : undefined,
        }),
      };
    }
  }
}

/** The step in progress, if one is. */
export function current(feed: Feed): FeedStep | undefined {
  return feed.steps.find((s) => s.phase === "running");
}

/** The share of the run done: the steps ended, the one running by its ring, the tune and the final check by their tries. */
export function doneShare(feed: Feed): number {
  const steps = feed.steps.filter((s) => s.name !== RESUME_STEP);
  let done = 0;
  for (const s of steps) {
    if (s.phase === "ended") done += 1;
    else if (s.phase === "running") {
      done +=
        s.try !== undefined && s.try.of > 0 ? (s.try.at - 1 + s.fraction) / s.try.of : s.fraction;
    }
  }
  return steps.length === 0 ? 0 : done / steps.length;
}

/** How a step's mark shows it: the icon, and whether a ring is drawn around it. */
export type StepMark = "accepted" | "failed" | "interrupted" | "running" | "waiting" | "not run";

/**
 * The step's mark. A step still running once the run has ended, or a folder's entry left
 * `running` with no run live, was cut off: interrupted. `over` once the run has ended.
 */
export function markOf(step: FeedStep, over: boolean): StepMark {
  switch (step.phase) {
    case "waiting":
      return over ? "not run" : "waiting";
    case "running":
      return over ? "interrupted" : "running";
    case "ended":
      switch (step.state) {
        case "accepted":
          return "accepted";
        case "refused":
        case "aborted":
          return "failed";
        case "interrupted":
        case "running":
          return "interrupted";
        default:
          return "not run";
      }
  }
}

/** Where a step has got, beside its ring: "seat 3 of 6", "try 2 of at most 6, move 4 of 20". */
export function unitText(step: FeedStep): string | undefined {
  if (step.phase === "waiting") return undefined;
  const parts: string[] = [];
  if (step.try !== undefined) {
    parts.push(`try ${String(step.try.at)} of at most ${String(step.try.of)}`);
  }
  if (step.unit !== undefined) {
    parts.push(`${step.unit.what} ${String(step.unit.at)} of ${String(step.unit.of)}`);
  }
  return parts.length === 0 ? undefined : parts.join(", ");
}

/** A step's state in words: the tool's own once it ended. `over` once the run has ended. */
export function stateText(step: FeedStep, over: boolean): string {
  const tries = (t: { at: number; of: number } | undefined) =>
    t === undefined ? "" : `, try ${String(t.at)} of at most ${String(t.of)}`;
  switch (step.phase) {
    case "waiting":
      return over ? "not reached" : "waiting";
    case "running":
      return over ? `no end recorded${tries(step.try)}` : `running${tries(step.try)}`;
    case "ended":
      return step.state === "running"
        ? "no end recorded: the run was cut off"
        : `${step.state}${tries(step.try)}`;
  }
}
