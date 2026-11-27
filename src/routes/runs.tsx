import { createFileRoute } from "@tanstack/react-router";
import { Download, FileArchive, FolderOpen, History } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  exportRun,
  filesOfPick,
  filesOfZip,
  importRun,
  locateRun,
  RunRefused,
  sizeText,
  stepTitle,
  utcText,
  zipName,
  type RunIdentity,
  type StoredRun,
} from "@/lib/run-folder";
import { useSession } from "@/lib/session";
import { download, storage } from "@/lib/use-library";
import { useRuns } from "@/lib/use-runs";
import type { ZipEntry } from "@/lib/zip";

export const Route = createFileRoute("/runs")({
  component: RunsPage,
  // The rest of the query (`?sim`) passes through untouched.
  validateSearch: (search: Record<string, unknown>): { run?: string } => ({
    ...search,
    run: typeof search.run === "string" ? search.run : undefined,
  }),
});

interface Note {
  text: string;
  error: boolean;
}

interface Copying {
  written: number;
  total: number;
}

const keyOf = (r: RunIdentity) => `${r.uid}/${r.utc}`;

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function RunsPage() {
  const { runs, error, refresh } = useRuns();
  const [chosen, setChosen] = useState(Route.useSearch().run);
  const [note, setNote] = useState<Note>();
  const [copying, setCopying] = useState<Copying>();
  const selected = runs?.find((r) => keyOf(r.identity) === chosen) ?? runs?.[0];

  async function open(name: string, files: () => Promise<ZipEntry[]>) {
    setNote(undefined);
    try {
      const run = locateRun(await files());
      setCopying({ written: 0, total: run.files.length });
      const done = await importRun(await storage(), run, (written, total) => {
        setCopying({ written, total });
      });
      await refresh();
      setChosen(keyOf(run.identity));
      const which = `the run of ${utcText(run.identity.utc)} for servo ${run.identity.uid}`;
      setNote({
        text:
          done === "already"
            ? `This run is already in the browser: ${which}.`
            : `Opened ${which}, ${String(run.files.length)} files.`,
        error: false,
      });
    } catch (e) {
      const why =
        e instanceof RunRefused ? e.message : `the browser could not store it (${message(e)})`;
      setNote({ text: `${name} was not opened: ${why}.`, error: true });
    } finally {
      setCopying(undefined);
    }
  }

  async function exportZip(r: RunIdentity) {
    try {
      const bytes = await exportRun(await storage(), r.uid, r.utc);
      if (bytes !== null) download(bytes, zipName(r.uid, r.utc), "application/zip");
    } catch (e) {
      setNote({ text: `The run was not zipped: ${message(e)}.`, error: true });
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <History className="size-5" />
          Identification runs
        </h1>
        <div className="ml-auto flex gap-2">
          <FolderButton
            disabled={copying !== undefined}
            onFiles={(list) => {
              const top = list[0]?.webkitRelativePath.split("/")[0] ?? "The folder";
              void open(top, () => filesOfPick(list));
            }}
          />
          <ZipButton
            disabled={copying !== undefined}
            onFile={(file) => {
              void open(file.name, async () =>
                filesOfZip(new Uint8Array(await file.arrayBuffer())),
              );
            }}
          />
        </div>
      </div>
      {copying !== undefined && <CopyProgress copying={copying} />}
      {note !== undefined && (
        <p role="status" className={note.error ? "mb-3 text-danger" : "mb-3 text-sm text-text-3"}>
          {note.text}
        </p>
      )}
      {error !== undefined && <p className="mb-3 text-danger">{error}</p>}
      {runs === undefined ? (
        error === undefined && <Skeleton className="h-64 w-full" />
      ) : selected === undefined ? (
        <p className="rounded-lg border border-dashed p-6 text-text-3">
          No runs yet. Open a run folder osc-ident wrote (its &lt;servo uid&gt;/&lt;UTC time&gt;/
          folder), or a zip of one.
        </p>
      ) : (
        <div className="grid grid-cols-[22rem_1fr] items-start gap-4">
          <RunList
            runs={runs}
            selected={keyOf(selected.identity)}
            onSelect={(key) => {
              setChosen(key);
              setNote(undefined);
            }}
          />
          <RunCard
            key={keyOf(selected.identity)}
            run={selected}
            onExport={() => void exportZip(selected.identity)}
          />
        </div>
      )}
    </>
  );
}

function CopyProgress({ copying }: { copying: Copying }) {
  const percent = copying.total === 0 ? 0 : (100 * copying.written) / copying.total;
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg border bg-card p-4">
      <span className="font-medium">Opening the run</span>
      <Progress aria-label="Files copied" value={percent} />
      <span className="text-sm text-text-3">
        Copying the run folder into this browser. Nothing goes to the servo. {copying.written} of{" "}
        {copying.total} files.
      </span>
    </div>
  );
}

/** The runs grouped by servo, each servo's newest first; the list itself comes newest first. */
function RunList({
  runs,
  selected,
  onSelect,
}: {
  runs: readonly StoredRun[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  const { servos } = useSession();
  const byServo = new Map<string, StoredRun[]>();
  for (const r of runs) byServo.set(r.identity.uid, [...(byServo.get(r.identity.uid) ?? []), r]);
  return (
    <nav aria-label="Runs" className="flex flex-col gap-4">
      {[...byServo].map(([uid, list]) => {
        const id = servos.find((s) => s.uid === uid)?.id;
        return (
          <section key={uid} aria-label={`Servo ${uid}`} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">
              Servo <span className="font-mono text-xs break-all">{uid}</span>
              {id !== undefined && <span className="text-text-3"> . ID {id}</span>}
            </h2>
            {list.map(({ identity: r, files, bytes }) => (
              <button
                key={r.utc}
                type="button"
                aria-current={keyOf(r) === selected}
                className="flex flex-col gap-1 rounded-lg border bg-card p-3 text-left hover:bg-muted aria-[current=true]:border-primary"
                onClick={() => {
                  onSelect(keyOf(r));
                }}
              >
                <span className="text-sm">{utcText(r.utc)}</span>
                <span className="text-xs text-text-3">
                  {[
                    r.reach,
                    r.profile === null ? undefined : namedText(r.profile),
                    sizeText(bytes),
                    `${String(files)} files`,
                  ]
                    .filter((part) => part !== undefined)
                    .join(" . ")}
                </span>
              </button>
            ))}
          </section>
        );
      })}
    </nav>
  );
}

function namedText({ key, revision }: { key: string; revision: number | null }): string {
  return revision === null ? key : `${key} rev ${String(revision)}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="shrink-0 text-text-3">{label}</span>
      <span className="text-right break-all">{children}</span>
    </div>
  );
}

function RunCard({ run, onExport }: { run: StoredRun; onExport: () => void }) {
  const r = run.identity;
  const notRecorded = <span className="text-text-3">not recorded</span>;
  return (
    <Card role="region" aria-label="Run">
      <CardHeader>
        <CardTitle>{utcText(r.utc)}</CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download />
            Download as zip
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Row label="Servo">
            <span className="font-mono text-xs">{r.uid}</span>
          </Row>
          <Row label="Run folder">
            <span className="font-mono text-xs">
              {r.uid}/{r.utc}/
            </span>
          </Row>
          <Row label="How far it got">{r.reach}</Row>
          <Row label="Tool">{r.tool ?? notRecorded}</Row>
          <Row label="Firmware image">{r.image ?? notRecorded}</Row>
          <Row label="Profile">{r.profile === null ? notRecorded : namedText(r.profile)}</Row>
          <Row label="Policy">{r.policy === null ? notRecorded : namedText(r.policy)}</Row>
          <Row label="Files">
            {run.files} files, {sizeText(run.bytes)}
          </Row>
        </div>
        <table className="w-full text-sm">
          <caption className="mb-1 text-left font-medium">Steps in run.json</caption>
          <thead className="text-left text-text-3">
            <tr>
              <th className="py-1 font-normal">Step</th>
              <th className="py-1 font-normal">State</th>
              <th className="py-1 font-normal">Why</th>
            </tr>
          </thead>
          <tbody>
            {r.steps.map((s) => (
              <tr key={s.name} className="border-t align-baseline">
                <td className="py-1 pr-4">{stepTitle(s.name)}</td>
                <td className="py-1 pr-4">{s.state}</td>
                <td className="py-1">{s.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function FolderButton({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={(el) => {
          input.current = el;
          // React has no prop for it; the attribute turns the file chooser into a folder chooser.
          if (el !== null) el.webkitdirectory = true;
        }}
        type="file"
        className="hidden"
        aria-label="Run folder"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
      <Button variant="outline" disabled={disabled} onClick={() => input.current?.click()}>
        <FolderOpen />
        Open folder
      </Button>
    </>
  );
}

function ZipButton({ disabled, onFile }: { disabled: boolean; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        aria-label="Run zip"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file !== undefined) onFile(file);
        }}
      />
      <Button variant="outline" disabled={disabled} onClick={() => input.current?.click()}>
        <FileArchive />
        Open zip
      </Button>
    </>
  );
}
