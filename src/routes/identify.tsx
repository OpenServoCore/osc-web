import type { BaudRate } from "@openservocore/client";
import type { ResumeArgs, RunArgs } from "@openservocore/client-ident";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, RotateCcw, ScanSearch } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SaveSet } from "@/components/save-set";
import { StepMark } from "@/components/step-mark";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { FIELD_NAME, readiness, type Blocker } from "@/lib/ident-setup";
import { resumeArgs, runArgs, stopped } from "@/lib/ident-run";
import { hasFinalSet } from "@/lib/save-set";
import { policies, profiles } from "@/lib/library";
import { DEFAULT_KEY, DEFAULT_POLICY } from "@/lib/policy-form";
import { stoppedAt } from "@/lib/report";
import {
  current,
  doneShare,
  feedOfSteps,
  rowText,
  STEP_TEXT,
  type Feed,
  type FeedStep,
} from "@/lib/run-feed";
import { phrase, stepTitle, utcText, type RunIdentity } from "@/lib/run-folder";
import { useSession } from "@/lib/session";
import { rateIssue } from "@/lib/stream";
import { useIdentRun, type RunTarget, type RunView } from "@/lib/use-ident-run";
import { storage, useLibrary } from "@/lib/use-library";
import { useResumePlan } from "@/lib/use-resume-plan";
import { useRuns } from "@/lib/use-runs";
import { useSetup } from "@/lib/use-setup";

export const Route = createFileRoute("/identify")({
  component: IdentifyPage,
  // The rest of the query (`?sim`) passes through untouched.
  validateSearch: (search: Record<string, unknown>): { resume?: string } => ({
    ...search,
    resume: typeof search.resume === "string" ? search.resume : undefined,
  }),
});

function IdentifyPage() {
  const session = useSession();
  const { status, servos, selected, baud, simulated, discover } = session;
  const { resume: wanted } = Route.useSearch();
  const navigate = useNavigate();
  const { view, start, resume, cancel, reset } = useIdentRun(simulated, () => {
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
  const wantedUid = wanted?.split("/")[0];
  const chosen = live
    ? servos.find((s) => (wantedUid === undefined ? s.id === selected : s.uid === wantedUid))
    : undefined;
  const target: RunTarget | undefined =
    view.target ?? (chosen === undefined ? undefined : { id: chosen.id, uid: chosen.uid });
  if (target === undefined) {
    return (
      <p className="text-text-3">
        {live && wantedUid !== undefined
          ? `Servo ${wantedUid} is not on the bus: connect it to resume its run.`
          : "Pick a servo in the left pane."}
      </p>
    );
  }
  const offerResume = (at: string) => {
    reset();
    void navigate({ to: "/identify", search: (s) => ({ ...s, resume: at }) });
  };
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
        <div className="flex flex-col gap-4">
          <BeforeStart
            key={target.uid}
            target={target}
            baud={live ? baud : undefined}
            onStart={(args) => void start(target, args)}
          />
          <StoppedRun
            key={`${target.uid} ${wanted ?? ""}`}
            target={target}
            baud={live ? baud : undefined}
            at={wanted}
            onResume={(args) => void resume(target, args)}
          />
        </div>
      ) : (
        <RunScreen view={view} onCancel={cancel} onResume={offerResume} />
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
      <li>The run goes on with this tab hidden or another window in front.</li>
      <li>
        Closing the tab stops the run. The servo lets the horn coast when the drive in flight ends,
        within about 2 s, as when osc-ident is stopped. What the run wrote to the servo stays
        unsaved until the servo restarts.
      </li>
    </ul>
  );
}

/** Why a run cannot start at the bus speed `baud`, if it cannot. */
function rateRefusal(baud: BaudRate | undefined): string | undefined {
  if (baud === undefined) return "The bus speed is not known yet.";
  const issue = rateIssue(baud);
  return issue === undefined ? undefined : `An identification captures on TEL bursts. ${issue}`;
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
  const rate = rateRefusal(baud);
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

function RunScreen({
  view,
  onCancel,
  onResume,
}: {
  view: RunView;
  onCancel: () => void;
  onResume: (at: string) => void;
}) {
  const over = view.phase === "ended";
  return (
    <div className="flex flex-col gap-4">
      {over ? (
        <Outcome view={view} onResume={onResume} />
      ) : (
        <ProgressBlock view={view} onCancel={onCancel} />
      )}
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
        ? ["Storing the run", "The run folder is in this browser. Nothing goes to the servo."]
        : step === undefined
          ? view.resuming === undefined
            ? ["Reaching the servo", "Reading the profile and the policy, then finding the servo."]
            : [
                "Reaching the servo",
                `Reading the run folder ${view.resuming}/, the profile and the policy, then finding the servo.`,
              ]
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

function Outcome({ view, onResume }: { view: RunView; onResume: (at: string) => void }) {
  const { outcome, stored, failure } = view;
  const { servos } = useSession();
  const onId = servos.find((s) => s.id === view.target?.id);
  const steps = stored?.identity.steps;
  const stop = steps === undefined ? undefined : stoppedAt(steps);
  const at = stored === undefined ? undefined : `${stored.identity.uid}/${stored.identity.utc}`;
  return (
    <section aria-label="Run outcome" className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <h2 className="font-medium">
        {view.resuming === undefined ? "The run ended" : "The resumed run ended"}
      </h2>
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
      {stored === undefined || at === undefined ? (
        outcome !== undefined && <p className="text-text-3">The run wrote no run folder.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-text-3">The run folder is in this browser at {at}/.</span>
          <Button asChild size="sm">
            <Link
              to="/runs/$uid/$utc"
              params={{ uid: stored.identity.uid, utc: stored.identity.utc }}
              search={true}
            >
              Open the report
            </Link>
          </Button>
          {stopped(stored.identity) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onResume(at);
              }}
            >
              <RotateCcw />
              Resume
            </Button>
          )}
          <Link to="/runs" search={(s) => ({ ...s, run: at })} className="text-text-3 underline">
            All runs
          </Link>
        </div>
      )}
      {stored !== undefined && hasFinalSet(stored.identity) && (
        <SaveSet identity={stored.identity} servo={onId} />
      )}
    </section>
  );
}

function StepList({ feed, over }: { feed: Feed; over: boolean }) {
  return (
    <ol aria-label="Steps" className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      {feed.steps.map((s) => (
        <StepRow key={s.name} step={s} over={over} />
      ))}
    </ol>
  );
}

function StepRow({ step: s, over }: { step: FeedStep; over: boolean }) {
  const running = s.phase === "running" && !over;
  const label = rowText(s);
  return (
    <li
      aria-current={running ? "step" : undefined}
      className="flex flex-col rounded px-2 py-1 aria-[current=step]:bg-muted"
    >
      <span className="flex items-center gap-2">
        <StepMark step={s} over={over} />
        <span className="font-medium">{stepTitle(s.name)}</span>
        {label !== undefined && <span className="ml-auto text-xs text-text-3">{label}</span>}
      </span>
      {s.phase === "ended" && s.why !== null && s.state !== "accepted" && (
        <span className="pl-7 text-sm text-text-3">{s.why}</span>
      )}
    </li>
  );
}

/** The servo's setup as a new run would take it: what a resume names where its folder records none. */
function useRunArgs(target: RunTarget): RunArgs | undefined {
  const profileShelf = useLibrary(profiles);
  const policyShelf = useLibrary(policies);
  const { setup } = useSetup(target.uid);
  if (
    setup === undefined ||
    profileShelf.entries === undefined ||
    policyShelf.entries === undefined
  ) {
    return undefined;
  }
  const profile = profileShelf.entries.find((e) => e.value.key === setup.profile?.key);
  const policy = policyShelf.entries.find((e) => e.value.key === setup.policy?.key) ?? null;
  return profile === undefined ? undefined : runArgs(target.id, profile, policy);
}

/**
 * The stopped run a resume goes on with: the one asked for (`at`), else this servo's newest run
 * that did not get through the final check. Its steps as its folder records them, what the module
 * says a resume would do, or why it refuses, in the module's words.
 */
function StoppedRun({
  target,
  baud,
  at,
  onResume,
}: {
  target: RunTarget;
  baud: BaudRate | undefined;
  at: string | undefined;
  onResume: (args: ResumeArgs) => void;
}) {
  const { runs } = useRuns();
  const fallback = useRunArgs(target);
  const run: RunIdentity | undefined = runs
    ?.map((r) => r.identity)
    .find((r) =>
      at === undefined ? r.uid === target.uid && stopped(r) : `${r.uid}/${r.utc}` === at,
    );
  const folder = run === undefined ? undefined : `${run.uid}/${run.utc}`;
  const [args, setArgs] = useState<ResumeArgs>();
  const [problem, setProblem] = useState<string>();
  const [nameplate, policy] = [fallback?.nameplate, fallback?.policy];
  useEffect(() => {
    if (folder === undefined) return;
    let live = true;
    const named =
      nameplate === undefined || policy === undefined ? undefined : { nameplate, policy };
    void (async () => {
      try {
        const a = await resumeArgs(await storage(), target.id, folder, named);
        if (live) setArgs(a);
      } catch (e) {
        if (live) setProblem(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [folder, target.id, nameplate, policy]);
  const check = useResumePlan(args);
  const feed = useMemo(() => (run === undefined ? undefined : feedOfSteps(run.steps)), [run]);
  if (run === undefined || feed === undefined) {
    return at === undefined || runs === undefined ? null : (
      <p className="text-warning">The run {at}/ is not in this browser.</p>
    );
  }
  const { plan, refused } = check;
  const said = problem ?? refused;
  const rate = rateRefusal(baud);
  return (
    <section aria-label="Stopped run" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="font-medium">
        The run of {utcText(run.utc)}, {run.reach}
      </h2>
      <div className="grid grid-cols-[18rem_1fr] items-start gap-4">
        <StepList feed={feed} over={true} />
        <div className="flex flex-col gap-2 text-sm">
          {said !== undefined ? (
            <p role="status" className="text-warning">
              {said}
            </p>
          ) : plan === undefined ? (
            <p className="text-text-3">Reading the run folder.</p>
          ) : (
            <>
              <p aria-label="Resume plan">
                Resume goes on in the same folder from {phrase(plan.from)}, as segment{" "}
                {plan.segment}. The steps accepted before it stay.
                {plan.coolS > 0 &&
                  ` It first waits up to ${String(Math.ceil(plan.coolS))} s, torque off, for the winding to cool.`}
                {plan.reseat &&
                  " It first presses the high stop once, to check the horn sits where it did."}
              </p>
              <ul className="list-disc pl-5 text-text-3">
                {plan.why.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </>
          )}
          {rate !== undefined && said === undefined && (
            <p role="status" className="text-warning">
              {rate}
            </p>
          )}
          <div>
            <Button
              variant="outline"
              disabled={
                args === undefined || plan === undefined || said !== undefined || rate !== undefined
              }
              onClick={() => {
                if (args !== undefined) onResume(args);
              }}
            >
              <RotateCcw />
              Resume
            </Button>
          </div>
        </div>
      </div>
    </section>
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
