import type { Progress } from "@openservocore/client-ident";
import { expect, test } from "vitest";
import {
  current,
  doneShare,
  FEED_START,
  feedReduce,
  RUN_STEPS,
  stateText,
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
    try: undefined,
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
  expect(stateText(named(tuning, "tune"), false)).toBe("running, try 3 of 6");
  const done = feedReduce(tuning, { event: "ended", step: "tune", state: "accepted", why: null });
  expect(stateText(named(done, "tune"), true)).toBe("accepted, try 3 of 6");
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
