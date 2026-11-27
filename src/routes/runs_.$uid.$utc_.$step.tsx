import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, FileChartColumn } from "lucide-react";
import {
  CapturesCard,
  ChecksTable,
  DrillCard,
  DrivesCard,
  EstimatesTable,
  RawJson,
} from "@/components/report/drill";
import {
  CruiseView,
  ProbeView,
  RestView,
  SpinsView,
  StopsView,
  TableView,
  TuneView,
  VerifyView,
  WindowView,
} from "@/components/report/drill-steps";
import { Skeleton } from "@/components/ui/skeleton";
import { capturesDir, DRILL_STEPS, isDrillStep, resultsFile, type DrillStep } from "@/lib/drill";
import { durationText, num, str } from "@/lib/report";
import { stepTitle, utcText, type RunStep } from "@/lib/run-folder";
import { useRunFiles } from "@/lib/use-drill";
import { useRunReport } from "@/lib/use-report";

export const Route = createFileRoute("/runs_/$uid/$utc_/$step")({
  component: DrillPage,
});

/** The files a step's drill-in reads beside its results. */
function filesOf(step: DrillStep): string[] {
  if (step === "tune") return ["tune/tune.json", "tune/back-off.json"];
  if (step === "final") return [resultsFile(step), "final/set.json", "final/inputs/pos_lut.json"];
  return [resultsFile(step)];
}

function DrillPage() {
  const { uid, utc, step } = Route.useParams();
  const { run, error } = useRunReport(uid, utc);
  const known = isDrillStep(step);
  // Wide tables scroll inside their cards instead of widening the page.
  return (
    <div className="[contain:inline-size]">
      <div className="mb-4 flex items-center gap-3">
        <Link
          to="/runs/$uid/$utc"
          params={{ uid, utc }}
          search={true}
          aria-label="Back to the report"
          className="text-text-3 hover:text-text"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <FileChartColumn className="size-5" />
          {stepTitle(step)} data
        </h1>
      </div>
      <p className="mb-2 text-text-2">
        {utcText(utc)} . Servo <span className="font-mono text-sm">{uid}</span>
      </p>
      <StepNav uid={uid} utc={utc} step={step} />
      {error !== undefined && <p className="text-danger">{error}</p>}
      {!known ? (
        <p className="text-text-3">No step {step} has a drill-in.</p>
      ) : run === undefined ? (
        error === undefined && <Skeleton className="h-64 w-full" />
      ) : (
        <Drill
          key={step}
          uid={uid}
          utc={utc}
          step={step}
          entry={run.identity.steps.find((s) => s.name === step)}
          times={run.docs.get("run.json")}
        />
      )}
    </div>
  );
}

function StepNav({ uid, utc, step }: { uid: string; utc: string; step: string }) {
  return (
    <nav aria-label="Steps" className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {DRILL_STEPS.map((s) => (
        <Link
          key={s}
          to="/runs/$uid/$utc/$step"
          params={{ uid, utc, step: s }}
          search={true}
          aria-current={s === step ? "page" : undefined}
          className={
            s === step ? "font-semibold" : "text-text-2 underline-offset-2 hover:underline"
          }
        >
          {stepTitle(s)}
        </Link>
      ))}
    </nav>
  );
}

function entryLine(entry: RunStep | undefined, record: unknown, step: string): string {
  if (entry === undefined) return "run.json records no such entry.";
  const when = (k: string) => num(record, `steps.${step}.${k}`) ?? num(record, `${step}.${k}`);
  const [started, ended] = [when("started"), when("ended")];
  const took =
    started === undefined || ended === undefined ? "" : `, ${durationText(ended - started)}`;
  return `run.json: ${entry.state}${took}${entry.why === null ? "" : `: ${entry.why}`}`;
}

function Drill({
  uid,
  utc,
  step,
  entry,
  times,
}: {
  uid: string;
  utc: string;
  step: DrillStep;
  entry: RunStep | undefined;
  times: unknown;
}) {
  const { data: files, error } = useRunFiles(uid, utc, filesOf(step));
  const file = resultsFile(step);
  const doc = files?.get(file);
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Step" className="flex flex-col gap-1">
        <p>{entryLine(entry, times, step)}</p>
        {doc !== undefined && step !== "tune" && (
          <p className="text-text-2">
            {file}: method {str(doc, "method") ?? "not written"}, revision{" "}
            {String(num(doc, "revision") ?? "not written")}, the tool's word{" "}
            {str(doc, "verdict") ?? "not written"}
            {str(doc, "why") === undefined ? "" : `: ${str(doc, "why") ?? ""}`}
          </p>
        )}
      </section>
      {error !== undefined && <p className="text-danger">{error}</p>}
      {files === undefined ? (
        error === undefined && <Skeleton className="h-64 w-full" />
      ) : doc === undefined ? (
        <p className="text-text-3">The run folder holds no {file}.</p>
      ) : (
        <>
          {step !== "tune" && (
            <>
              <DrillCard
                title="Estimates"
                says="Each value the step measured, with its spread and the number of reads behind it."
              >
                <EstimatesTable doc={doc} file={file} />
              </DrillCard>
              <DrillCard title="Checks" says="The tool's checks, word for word.">
                <ChecksTable doc={doc} />
              </DrillCard>
            </>
          )}
          <StepView uid={uid} utc={utc} step={step} doc={doc} files={files} />
          {step !== "tune" && <DrivesCard doc={doc} />}
          {step !== "tune" && <CapturesCard uid={uid} utc={utc} dir={capturesDir(step)} />}
          <DrillCard title="Files" says="The step's files as the tool wrote them.">
            {filesOf(step).map((p) =>
              files.has(p) ? <RawJson key={p} path={p} doc={files.get(p)} /> : null,
            )}
          </DrillCard>
        </>
      )}
    </div>
  );
}

function StepView({
  uid,
  utc,
  step,
  doc,
  files,
}: {
  uid: string;
  utc: string;
  step: DrillStep;
  doc: unknown;
  files: Map<string, unknown>;
}) {
  switch (step) {
    case "rest":
      return <RestView uid={uid} utc={utc} doc={doc} />;
    case "probe":
      return <ProbeView doc={doc} />;
    case "stops":
      return <StopsView doc={doc} />;
    case "table":
      return <TableView doc={doc} />;
    case "window":
      return <WindowView doc={doc} />;
    case "spins":
      return <SpinsView doc={doc} />;
    case "cruise":
      return <CruiseView doc={doc} />;
    case "tune":
      return <TuneView uid={uid} utc={utc} files={files} />;
    case "final":
      return (
        <VerifyView
          uid={uid}
          utc={utc}
          verify={doc}
          set={files.get("final/set.json")}
          posLut={files.get("final/inputs/pos_lut.json")}
          at0="final/"
        />
      );
  }
}
