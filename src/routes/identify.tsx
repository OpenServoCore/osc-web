import type { BaudRate } from "@openservocore/client";
import type { RunArgs } from "@openservocore/client-ident";
import { createFileRoute, Link, useBlocker } from "@tanstack/react-router";
import { ArrowLeft, ScanSearch } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { FIELD_NAME, readiness, type Blocker } from "@/lib/ident-setup";
import { runArgs } from "@/lib/ident-run";
import { policies, profiles } from "@/lib/library";
import { DEFAULT_KEY, DEFAULT_POLICY } from "@/lib/policy-form";
import { stoppedAt } from "@/lib/report";
import { current, doneShare, STEP_TEXT, stateText, type Feed } from "@/lib/run-feed";
import { phrase, stepTitle } from "@/lib/run-folder";
import { useSession } from "@/lib/session";
import { rateIssue } from "@/lib/stream";
import { useIdentRun, type RunTarget, type RunView } from "@/lib/use-ident-run";
import { useLibrary } from "@/lib/use-library";
import { useSetup } from "@/lib/use-setup";

export const Route = createFileRoute("/identify")({ component: IdentifyPage });

function IdentifyPage() {
  const session = useSession();
  const { status, servos, selected, baud, simulated, discover } = session;
  const { view, start, cancel } = useIdentRun(simulated, () => {
    void discover();
  });
  const [warned, setWarned] = useState(false);
  const busy = view.phase === "loading" || view.phase === "running" || view.phase === "saving";

  useBlocker({
    shouldBlockFn: () => {
      setWarned(true);
      return true;
    },
    enableBeforeUnload: busy,
    disabled: !busy,
  });

  const live = status === "ready" || status === "scanning";
  const chosen = live ? servos.find((s) => s.id === selected) : undefined;
  const target: RunTarget | undefined =
    view.target ?? (chosen === undefined ? undefined : { id: chosen.id, uid: chosen.uid });
  if (target === undefined) {
    return <p className="text-text-3">Pick a servo in the left pane.</p>;
  }
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link
          to="/servo"
          search={true}
          aria-label={`Back to ID ${String(target.id)}`}
          className="text-text-3 hover:text-text"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ScanSearch className="size-5" />
          Identify ID {target.id}
        </h1>
      </div>
      {busy && warned && (
        <p role="alert" className="mb-3 text-warning">
          A run is in progress: it holds the bus and moves the horn. Cancel it and wait for the step
          to end before you leave this page.
        </p>
      )}
      {view.phase === "ready" ? (
        <BeforeStart
          key={target.uid}
          target={target}
          baud={live ? baud : undefined}
          onStart={(args) => void start(target, args)}
        />
      ) : (
        <RunScreen view={view} onCancel={cancel} />
      )}
    </>
  );
}

function blockerText(b: Blocker): string {
  switch (b.kind) {
    case "no-profile":
      return "Choose the profile that describes this servo's model.";
    case "missing":
      return `The profile has no ${FIELD_NAME[b.field]}: ${b.text}`;
    case "not-metal":
    case "refused":
      return b.text;
  }
}

/** Tab rules a run in a browser lives by: a hidden tab and a closed one. */
function TabNotes() {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text-2">
      <li>
        Keep this tab in front while the horn moves. A hidden tab slows its timers, and the servo
        cuts off a drive that runs long, which stops the run.
      </li>
      <li>
        Closing the tab stops the run. The servo lets the horn coast when the drive in flight ends,
        within about 2 s, as when osc-ident is stopped. What the run wrote to the servo stays
        unsaved until the servo restarts.
      </li>
    </ul>
  );
}

function BeforeStart({
  target,
  baud,
  onStart,
}: {
  target: RunTarget;
  baud: BaudRate | undefined;
  onStart: (args: RunArgs) => void;
}) {
  const profileShelf = useLibrary(profiles);
  const policyShelf = useLibrary(policies);
  const { setup, error } = useSetup(target.uid);
  const problem = error ?? profileShelf.error ?? policyShelf.error;
  if (problem !== undefined) return <p className="text-danger">{problem}</p>;
  if (
    setup === undefined ||
    profileShelf.entries === undefined ||
    policyShelf.entries === undefined
  ) {
    return <Skeleton className="h-40 w-full" />;
  }
  const profile = profileShelf.entries.find((e) => e.value.key === setup.profile?.key);
  const policy = policyShelf.entries.find((e) => e.value.key === setup.policy?.key) ?? null;
  const ready = readiness(profile?.value, policy?.value ?? DEFAULT_POLICY);
  const rate =
    baud === undefined
      ? "The bus speed is not known yet."
      : (() => {
          const issue = rateIssue(baud);
          return issue === undefined
            ? undefined
            : `An identification captures on TEL bursts. ${issue}`;
        })();
  const refusal = ready.blocker === undefined ? rate : blockerText(ready.blocker);
  const policyName =
    policy === null || policy.value.key === DEFAULT_KEY
      ? "Default"
      : `${policy.value.key} rev ${String(policy.value.revision)}`;

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <p aria-label="Run inputs" className="text-sm text-text-2">
        {profile === undefined
          ? "no profile"
          : `profile ${profile.value.key} rev ${String(profile.value.revision)}`}{" "}
        . policy {policyName} . board facts read from the servo
      </p>
      <p>About 6 minutes. The horn moves stop to stop and presses each stop.</p>
      <TabNotes />
      {ready.warning !== undefined && <p className="text-sm text-warning">{ready.warning}</p>}
      {refusal !== undefined && (
        <p role="status" className="text-sm text-warning">
          {refusal}{" "}
          {ready.blocker !== undefined && (
            <Link to="/servo" search={true} className="text-text-3 underline">
              Open ID {target.id}
            </Link>
          )}
        </p>
      )}
      <div>
        <Button
          disabled={refusal !== undefined || profile === undefined}
          onClick={() => {
            if (profile !== undefined) onStart(runArgs(target.id, profile, policy));
          }}
        >
          Start
        </Button>
      </div>
    </div>
  );
}

function RunScreen({ view, onCancel }: { view: RunView; onCancel: () => void }) {
  const over = view.phase === "ended";
  return (
    <div className="flex flex-col gap-4">
      {over ? <Outcome view={view} /> : <ProgressBlock view={view} onCancel={onCancel} />}
      <div className="grid grid-cols-[18rem_1fr] items-start gap-4">
        <StepList feed={view.feed} over={over} />
        <Lines lines={view.feed.lines} />
      </div>
    </div>
  );
}

function ProgressBlock({ view, onCancel }: { view: RunView; onCancel: () => void }) {
  const step = current(view.feed);
  const [title, text] =
    view.phase === "loading"
      ? ["Loading the identification", "Fetching the run's module. Nothing goes to the servo yet."]
      : view.phase === "saving"
        ? [
            "Storing the run",
            "Copying the run folder into this browser. Nothing goes to the servo.",
          ]
        : step === undefined
          ? ["Reaching the servo", "Reading the profile and the policy, then finding the servo."]
          : [stepTitle(step.name), STEP_TEXT[step.name] ?? ""];
  return (
    <section
      aria-label="Run progress"
      className="flex flex-col gap-2 rounded-lg border bg-card p-4"
    >
      <h2 className="font-medium">{title}</h2>
      <Progress aria-label="Steps done" value={100 * doneShare(view.feed)} />
      <p className="text-sm text-text-3">{text}</p>
      <TabNotes />
      <div className="flex items-center gap-3">
        <Button variant="outline" disabled={view.cancelled} onClick={onCancel}>
          Cancel
        </Button>
        {view.cancelled && (
          <span className="text-sm text-text-3">
            Cancelling: the step stops between its moves and ends with torque off.
          </span>
        )}
      </div>
    </section>
  );
}

function Outcome({ view }: { view: RunView }) {
  const { outcome, stored, failure } = view;
  const steps = stored?.identity.steps;
  const stop = steps === undefined ? undefined : stoppedAt(steps);
  return (
    <section aria-label="Run outcome" className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <h2 className="font-medium">The run ended</h2>
      {failure !== undefined && <p className="text-danger">{failure}</p>}
      {outcome?.refused !== undefined && <p className="text-warning">refused: {outcome.refused}</p>}
      {stored !== undefined && (
        <p>
          {stop === undefined
            ? `The run went ${stored.identity.reach}.`
            : `The run stopped at ${phrase(stop.name)}: ${stop.why ?? stop.state}.`}
          {outcome?.accepted === true && " The tune accepted a set."}
        </p>
      )}
      {stored === undefined ? (
        outcome !== undefined && <p className="text-text-3">The run wrote no run folder.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-text-3">
            The run folder is in this browser at {stored.identity.uid}/{stored.identity.utc}/.
          </span>
          <Button asChild size="sm">
            <Link
              to="/runs/$uid/$utc"
              params={{ uid: stored.identity.uid, utc: stored.identity.utc }}
              search={true}
            >
              Open the report
            </Link>
          </Button>
          <Link
            to="/runs"
            search={(s) => ({ ...s, run: `${stored.identity.uid}/${stored.identity.utc}` })}
            className="text-text-3 underline"
          >
            All runs
          </Link>
        </div>
      )}
    </section>
  );
}

function StepList({ feed, over }: { feed: Feed; over: boolean }) {
  return (
    <ol aria-label="Steps" className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      {feed.steps.map((s) => (
        <li
          key={s.name}
          aria-current={s.phase === "running" && !over ? "step" : undefined}
          className="flex flex-col rounded px-2 py-1 aria-[current=step]:bg-muted"
        >
          <span className="flex justify-between gap-2">
            <span className="font-medium">{stepTitle(s.name)}</span>
            <span className="text-sm text-text-3">{stateText(s, over)}</span>
          </span>
          {s.phase === "ended" && s.why !== null && s.state !== "accepted" && (
            <span className="text-sm text-text-3">{s.why}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Lines({ lines }: { lines: readonly string[] }) {
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <pre
      ref={box}
      aria-label="Run lines"
      className="max-h-[32rem] min-h-40 overflow-auto rounded-lg border bg-card p-3 font-mono text-xs whitespace-pre-wrap"
    >
      {lines.join("\n")}
    </pre>
  );
}
