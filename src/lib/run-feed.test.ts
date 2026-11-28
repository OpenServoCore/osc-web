import type { Progress } from "@openservocore/client-ident";
import { expect, test } from "vitest";
import {
  current,
  doneShare,
  FEED_START,
  feedOfSteps,
  feedReduce,
  markOf,
  RESUME_STEP,
  RUN_STEPS,
  stateText,
  unitText,
  type Feed,
  type FeedStep,
} from "./run-feed";

const feed = (events: readonly Progress[]): Feed => events.reduce(feedReduce, FEED_START);

function named(f: Feed, name: string): FeedStep {
  const s = f.steps.find((e) => e.name === name);
  if (s === undefined) throw new Error(`no step ${name}`);
  return s;
}

const PROBE_WHY = "aborted: the probe's first shunt burst read no current";

// The simulated servo's run as osc-client-web-ident tells it: the files read, the bus found,
// rest accepted, the probe aborted, and the entries after the chain recorded not run.
const SIM_RUN: Progress[] = [
  { event: "lines", lines: ["heat model: from profiles/mg90-d.json"] },
  { event: "lines", lines: ["bus at 3000000 baud"] },
  { event: "started", step: "rest" },
  { event: "lines", lines: ["step rest accepted"] },
  { event: "ended", step: "rest", state: "accepted", why: null },
  { event: "started", step: "probe" },
  { event: "ended", step: "probe", state: "aborted", why: PROBE_WHY },
  ...(["gather", "tune", "cruise", "final"] as const).map((step): Progress => ({
    event: "ended",
    step,
    state: "not run",
    why: "not every step was accepted",
  })),
  { event: "lines", lines: ["rebooted to clear unsaved: now unsaved no, 0 differences"] },
];

test("before the run every step of run.json waits, in the order the run reaches them", () => {
  expect(FEED_START.steps.map((s) => s.name)).toEqual([...RUN_STEPS]);
  expect(FEED_START.steps.map((s) => stateText(s, false))).toEqual(RUN_STEPS.map(() => "waiting"));
  expect(current(FEED_START)).toBeUndefined();
  expect(doneShare(FEED_START)).toBe(0);
});

test("a started step runs; its end gives the state and why run.json records", () => {
  const during = feed(SIM_RUN.slice(0, 6));
  expect(current(during)?.name).toBe("probe");
  expect(stateText(named(during, "rest"), false)).toBe("accepted");
  expect(stateText(named(during, "probe"), false)).toBe("running");

  const after = feed(SIM_RUN);
  expect(current(after)).toBeUndefined();
  expect(after.steps.find((s) => s.name === "probe")).toEqual({
    name: "probe",
    phase: "ended",
    state: "aborted",
    why: PROBE_WHY,
    fraction: 0,
    try: undefined,
    unit: undefined,
  });
  expect(after.steps.map((s) => stateText(s, true))).toEqual([
    "accepted",
    "aborted",
    "not reached",
    "not reached",
    "not reached",
    "not reached",
    "not run",
    "not run",
    "not run",
    "not run",
  ]);
});

test("every line is kept in the order told", () => {
  expect(feed(SIM_RUN).lines).toEqual([
    "heat model: from profiles/mg90-d.json",
    "bus at 3000000 baud",
    "step rest accepted",
    "rebooted to clear unsaved: now unsaved no, 0 differences",
  ]);
});

test("the tune's try shows as at of, and stays on the step once it ends", () => {
  const tuning = feed([
    { event: "started", step: "tune" },
    { event: "try", step: "tune", at: 1, of: 6 },
    { event: "try", step: "tune", at: 3, of: 6 },
  ]);
  expect(stateText(named(tuning, "tune"), false)).toBe("running, try 3 of at most 6");
  const done = feedReduce(tuning, { event: "ended", step: "tune", state: "accepted", why: null });
  expect(stateText(named(done, "tune"), true)).toBe("accepted, try 3 of at most 6");
});

test("a step still running when the run ends says no end was recorded", () => {
  const cut = feed([{ event: "started", step: "rest" }]);
  expect(stateText(named(cut, "rest"), true)).toBe("no end recorded");
});

test("the share done counts ended steps and the tune's tries begun before this one", () => {
  const n = RUN_STEPS.length;
  expect(doneShare(feed(SIM_RUN.slice(0, 5)))).toBeCloseTo(1 / n);
  expect(
    doneShare(
      feed([
        { event: "ended", step: "rest", state: "accepted", why: null },
        { event: "started", step: "tune" },
        { event: "try", step: "tune", at: 4, of: 6 },
      ]),
    ),
  ).toBeCloseTo((1 + 3 / 6) / n);
  const all = feed(
    RUN_STEPS.map((step): Progress => ({ event: "ended", step, state: "accepted", why: null })),
  );
  expect(doneShare(all)).toBe(1);
});

test("a step the list does not know is added at its end", () => {
  const f = feed([{ event: "started", step: "verify" }]);
  expect(f.steps.map((s) => s.name)).toEqual([...RUN_STEPS, "verify"]);
  expect(current(f)?.name).toBe("verify");
});

const ring = (f: Feed, name: string): number => named(f, name).fraction;

test("a step's ring is the largest share its units told, never going back, full on accept", () => {
  const events: Progress[] = [
    { event: "started", step: "stops" },
    { event: "unit", step: "stops", at: 1, of: 6, what: "seat" },
    { event: "unit", step: "stops", at: 4, of: 6, what: "seat" },
  ];
  const at4 = feed(events);
  expect(ring(at4, "stops")).toBeCloseTo(3 / 6);
  expect(unitText(named(at4, "stops"))).toBe("seat 4 of 6");
  // A lost-row retake tells its unit again; a count that grows never pulls the ring back.
  const table = feed([
    { event: "started", step: "table" },
    { event: "unit", step: "table", at: 5, of: 9, what: "slow pass" },
    { event: "unit", step: "table", at: 5, of: 11, what: "slow pass" },
  ]);
  expect(ring(table, "table")).toBeCloseTo(4 / 9);
  expect(unitText(named(table, "table"))).toBe("slow pass 5 of 11");
  const accepted = feedReduce(at4, { event: "ended", step: "stops", state: "accepted", why: null });
  expect(ring(accepted, "stops")).toBe(1);
  expect(markOf(named(accepted, "stops"), false)).toBe("accepted");
});

test("a refused, aborted or interrupted step keeps its ring where it stopped", () => {
  const during = feed([
    { event: "started", step: "window" },
    { event: "unit", step: "window", at: 13, of: 24, what: "onset" },
  ]);
  for (const state of ["refused", "aborted", "interrupted"]) {
    const ended = feedReduce(during, { event: "ended", step: "window", state, why: `${state}: x` });
    expect(ring(ended, "window")).toBeCloseTo(12 / 24);
    expect(markOf(named(ended, "window"), true)).toBe(
      state === "interrupted" ? "interrupted" : "failed",
    );
  }
});

test("a unit for a step not running is not taken", () => {
  const f = feed([{ event: "unit", step: "rest", at: 2, of: 2, what: "burst" }]);
  expect(named(f, "rest")).toEqual({ name: "rest", phase: "waiting", fraction: 0 });
});

test("the tune's ring is the current try's check, from empty again at each try", () => {
  const f = feed([
    { event: "started", step: "tune" },
    { event: "try", step: "tune", at: 1, of: 6 },
    { event: "unit", step: "tune", at: 11, of: 20, what: "move" },
  ]);
  expect(ring(f, "tune")).toBeCloseTo(10 / 20);
  expect(unitText(named(f, "tune"))).toBe("try 1 of at most 6, move 11 of 20");
  const next = feedReduce(f, { event: "try", step: "tune", at: 2, of: 6 });
  expect(ring(next, "tune")).toBe(0);
  expect(unitText(named(next, "tune"))).toBe("try 2 of at most 6");
  expect(doneShare(next)).toBeCloseTo(1 / 6 / RUN_STEPS.length);
});

test("each mark: waiting, running, accepted, a cross, interrupted, not run, and a step cut off", () => {
  const f = feed(SIM_RUN.slice(0, 6));
  expect(markOf(named(f, "rest"), false)).toBe("accepted");
  expect(markOf(named(f, "probe"), false)).toBe("running");
  expect(markOf(named(f, "stops"), false)).toBe("waiting");
  // The run ended with the probe still running: it was cut off.
  expect(markOf(named(f, "probe"), true)).toBe("interrupted");
  expect(markOf(named(f, "stops"), true)).toBe("not run");
  const after = feed(SIM_RUN);
  expect(markOf(named(after, "probe"), true)).toBe("failed");
  expect(markOf(named(after, "gather"), true)).toBe("not run");
});

test("a folder's steps show as it records them, an entry left running as cut off", () => {
  const f = feedOfSteps([
    { name: "rest", state: "accepted", why: null },
    { name: "probe", state: "running", why: null },
  ]);
  expect(markOf(named(f, "rest"), true)).toBe("accepted");
  expect(ring(f, "rest")).toBe(1);
  expect(markOf(named(f, "probe"), true)).toBe("interrupted");
  expect(stateText(named(f, "probe"), true)).toBe("no end recorded: the run was cut off");
  expect(markOf(named(f, "stops"), true)).toBe("not run");
});

test("a resume's own row goes above the steps, and does not count in the share done", () => {
  const f = feed([
    { event: "ended", step: "rest", state: "accepted", why: null },
    { event: "started", step: RESUME_STEP },
    { event: "unit", step: RESUME_STEP, at: 6, of: 18, what: "s cooling" },
  ]);
  expect(f.steps[0]?.name).toBe(RESUME_STEP);
  expect(ring(f, RESUME_STEP)).toBeCloseTo(5 / 18);
  expect(doneShare(f)).toBeCloseTo(1 / RUN_STEPS.length);
});
