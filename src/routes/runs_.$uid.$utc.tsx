import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, FileChartColumn } from "lucide-react";
import {
  AccuracyChart,
  EffortChart,
  InputsView,
  MoveResponse,
  ReportCard,
  SpeedChart,
  Tiles,
  TravelStrip,
} from "@/components/report/cards";
import { Skeleton } from "@/components/ui/skeleton";
import { durationText, stoppedAt } from "@/lib/report";
import {
  accuracy,
  effort,
  headlineTiles,
  inputs,
  moves,
  saveLine,
  speed,
  travelMap,
} from "@/lib/report-cards";
import { phrase, utcText, type Named } from "@/lib/run-folder";
import { useSession } from "@/lib/session";
import { useRunReport, type LoadedRun } from "@/lib/use-report";

export const Route = createFileRoute("/runs_/$uid/$utc")({
  component: ReportPage,
});

function ReportPage() {
  const { uid, utc } = Route.useParams();
  const { run, error } = useRunReport(uid, utc);
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link
          to="/runs"
          search={(s) => ({ ...s, run: `${uid}/${utc}` })}
          aria-label="Back to the runs"
          className="text-text-3 hover:text-text"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <FileChartColumn className="size-5" />
          Identification report
        </h1>
      </div>
      {error !== undefined && <p className="text-danger">{error}</p>}
      {run === undefined ? (
        error === undefined && <Skeleton className="h-64 w-full" />
      ) : (
        <Report run={run} uid={uid} utc={utc} />
      )}
    </>
  );
}

function namedText(n: Named | null): string {
  if (n === null) return "not recorded";
  return n.revision === null ? n.key : `${n.key} rev ${String(n.revision)}`;
}

function RunLine({ run, uid, utc }: { run: LoadedRun; uid: string; utc: string }) {
  const r = run.identity;
  const stop = stoppedAt(r.steps);
  const board = run.docs.has("inputs/board.json")
    ? "board facts read from the servo"
    : "the tool's built-in osc-dev-v006 facts";
  const parts = [
    `profile ${namedText(r.profile)}`,
    `policy ${namedText(r.policy)}`,
    board,
    r.tool ?? "tool not recorded",
    run.times.seconds === undefined ? undefined : durationText(run.times.seconds),
    r.reach,
  ].filter((p) => p !== undefined);
  return (
    <section aria-label="Run" className="mb-4 flex flex-col gap-1">
      <p className="text-lg">{utcText(utc)}</p>
      <p className="text-text-2">
        Servo <span className="font-mono text-sm">{uid}</span> . {parts.join(" . ")}
      </p>
      {stop !== undefined && (
        <p aria-label="Where the run stopped">
          The run stopped at {phrase(stop.name)} ({stop.state}): {stop.why ?? "no reason recorded"}
        </p>
      )}
    </section>
  );
}

function Report({ run, uid, utc }: { run: LoadedRun; uid: string; utc: string }) {
  const { servos } = useSession();
  const steps = run.identity.steps;
  const docs = run.docs;
  const id = servos.find((s) => s.uid === uid)?.id;
  const save = saveLine(docs, steps, run.times.setFile, uid, utc, id);
  return (
    <div className="flex flex-col gap-4">
      <RunLine run={run} uid={uid} utc={utc} />
      <Tiles tiles={headlineTiles(docs, steps)} />
      <ReportCard
        title="Travel map"
        says="Where on the travel the position sensor skips: codes the pot never read on the slow passes, and the converter's wide codes, in horn degrees from the CW stop."
        card={travelMap(docs, steps)}
      >
        {(t) => <TravelStrip travel={t} />}
      </ReportCard>
      <ReportCard
        title="Accuracy across travel"
        says="How far the pot alone reads off the horn's angle across the travel, and how much the up and down passes differ, both in degrees."
        card={accuracy(docs, steps)}
      >
        {(a) => <AccuracyChart accuracy={a} />}
      </ReportCard>
      <ReportCard
        title="Move response"
        says="One of the final check's moves: the horn's angle against its goal, and the motor current, on one time axis."
        card={moves(docs, steps)}
      >
        {(m) => <MoveResponse moves={m} uid={uid} utc={utc} />}
      </ReportCard>
      <div className="grid grid-cols-2 items-start gap-4">
        <ReportCard
          title="Speed against volts"
          says="Each spin's speed at its drive voltage, the speed V / Ke gives, and the profile's stated no-load speeds."
          card={speed(docs, steps)}
        >
          {(s) => <SpeedChart speed={s} />}
        </ReportCard>
        <ReportCard
          title="Current to keep moving"
          says="The current that holds each cruise speed, up and down, and the line through their means."
          card={effort(docs, steps)}
        >
          {(e) => <EffortChart effort={e} />}
        </ReportCard>
      </div>
      <ReportCard
        title="Inputs"
        says="What the run was given: the profile and the policy as resolved, and the profile's stated values beside the run's."
        card={inputs(docs, steps)}
      >
        {(i) => <InputsView inputs={i} />}
      </ReportCard>
      <ReportCard
        title="Store the final set"
        says="osc-ident leaves the final set on the servo until a reboot. To store it, run this from the folder that holds the run folder:"
        card={save}
      >
        {(line) => <code className="rounded bg-muted p-2 font-mono text-sm break-all">{line}</code>}
      </ReportCard>
    </div>
  );
}
