import { Download } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type uPlot from "uplot";
import { Chart, type ChartOptions } from "@/components/uplot";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useChartTokens, type ChartTokens } from "@/lib/chart-theme";
import {
  captureSeries,
  cellText,
  checkRows,
  csvPreview,
  estimateRows,
  keyLines,
  planText,
  scatter,
  trimmedText,
  type KeyLine,
  type Preview,
} from "@/lib/drill";
import { at, list, num, parseCsv, type Columns } from "@/lib/report";
import type { Point } from "@/lib/report-cards";
import { readCapture, useCaptures, type ListedCapture } from "@/lib/use-drill";
import { download } from "@/lib/use-library";
import { axis, Legend, readoutOf, seriesOf, type Mark, type Series } from "./charts";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A drill-in card: a title, the sentence saying what it shows, and its content. */
export function DrillCard({
  title,
  says,
  children,
}: {
  title: string;
  says?: string;
  children: ReactNode;
}) {
  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {says !== undefined && <p className="text-text-2">{says}</p>}
        {children}
      </CardContent>
    </Card>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="py-1 pr-4 font-normal">{children}</th>;
}

export function EstimatesTable({ doc, file }: { doc: unknown; file: string }) {
  const rows = estimateRows(doc);
  if (rows.length === 0) return <p className="text-text-3">{file} writes no estimates.</p>;
  return (
    <table aria-label="Estimates" className="w-full text-sm tabular-nums">
      <thead className="text-left text-text-3">
        <tr>
          <Th>Name</Th>
          <Th>Value</Th>
          <Th>Spread</Th>
          <Th>n</Th>
          <Th>Unit</Th>
          <Th>Source</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-t align-baseline">
            <td className="py-1 pr-4 font-mono text-xs">{r.name}</td>
            <td className="py-1 pr-4">{r.value}</td>
            <td className="py-1 pr-4">{r.sd}</td>
            <td className="py-1 pr-4">{r.n}</td>
            <td className="py-1 pr-4">{r.unit}</td>
            <td className="py-1 text-text-2">{r.source}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The tool's checks as it wrote them. */
export function ChecksTable({ doc, path = "checks" }: { doc: unknown; path?: string }) {
  const rows = checkRows(doc, path);
  if (rows.length === 0) return <p className="text-text-3">No checks written.</p>;
  return (
    <table aria-label="Checks" className="w-full text-sm">
      <thead className="text-left text-text-3">
        <tr>
          <Th>Check</Th>
          <Th>Value</Th>
          <Th>Bound</Th>
          <Th>The tool's word</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t align-baseline">
            <td className="py-1 pr-4">{r.name}</td>
            <td className="py-1 pr-4">{r.value}</td>
            <td className="py-1 pr-4">{r.bound}</td>
            <td className="py-1">{r.verdict}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function KeyTable({ label, lines }: { label: string; lines: readonly KeyLine[] }) {
  if (lines.length === 0) return null;
  return (
    <table aria-label={label} className="w-full text-sm tabular-nums">
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} className="border-t align-baseline">
            <td className="py-1 pr-4 font-mono text-xs text-text-2">{l.key}</td>
            <td className="py-1 break-all">{l.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface Col {
  /** A dotted path into each row. */
  key: string;
  label?: string;
}

/** An array of records as a table, one column per path, values as written. */
export function ListTable({
  label,
  rows,
  cols,
}: {
  label: string;
  rows: readonly unknown[];
  cols: readonly (string | Col)[];
}) {
  const columns = cols.map((c) => (typeof c === "string" ? { key: c } : c));
  if (rows.length === 0) return <p className="text-text-3">No {label.toLowerCase()} written.</p>;
  return (
    <div className="max-h-96 overflow-auto">
      <table aria-label={label} className="w-full text-sm tabular-nums">
        <thead className="sticky top-0 bg-card text-left text-text-3">
          <tr>
            {columns.map((c) => (
              <Th key={c.key}>{c.label ?? c.key}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t align-baseline">
              {columns.map((c) => (
                <td key={c.key} className="py-1 pr-4">
                  {cellText(at(r, c.key))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Lines the tool wrote as it went (`path`), word for word. */
export function Lines({ label, doc, path }: { label: string; doc: unknown; path: string }) {
  const lines = list(doc, path).map(cellText);
  if (lines.length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer text-sm text-text-2">
        {label} ({lines.length})
      </summary>
      <ol aria-label={label} className="mt-2 list-decimal pl-6 text-sm">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>
    </details>
  );
}

/** What the step drove: its drive settings, its exit and whether it ended with torque off. */
export function DrivesCard({ doc }: { doc: unknown }) {
  const drives = keyLines(at(doc, "drives"));
  const exit = list(doc, "exit").map(cellText);
  const torqueOff = at(doc, "torque_off");
  const ends = [
    ["position_before_counts", "position before"],
    ["position_centered_counts", "position centered"],
    ["position_after_counts", "position after"],
    ["rail_v", "rail, V"],
  ] as const;
  return (
    <DrillCard title="Drives" says="What the step drove and how it left the servo.">
      <KeyTable label="Drive settings" lines={drives} />
      <KeyTable
        label="Ends"
        lines={ends.flatMap(([k, label]) => {
          const v = num(doc, k);
          return v === undefined ? [] : [{ key: label, value: cellText(v) }];
        })}
      />
      {exit.length > 0 && (
        <div>
          <h3 className="font-medium">Exit writes</h3>
          <ol aria-label="Exit writes" className="list-decimal pl-6 font-mono text-xs">
            {exit.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ol>
        </div>
      )}
      {typeof torqueOff === "boolean" && (
        <p aria-label="Torque off">Torque off at the end: {torqueOff ? "yes" : "no"}</p>
      )}
    </DrillCard>
  );
}

/** A results file as written, folded away, with a download. */
export function RawJson({ path, doc }: { path: string; doc: unknown }) {
  const text = useMemo(() => JSON.stringify(doc, null, 2), [doc]);
  return (
    <details>
      <summary className="cursor-pointer text-sm text-text-2">{path} as written</summary>
      <div className="mt-2 flex flex-col gap-2">
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            download(new TextEncoder().encode(text), path.replaceAll("/", "-"));
          }}
        >
          <Download />
          Download {path}
        </Button>
        <pre className="max-h-96 overflow-auto rounded bg-muted p-2 font-mono text-xs">{text}</pre>
      </div>
    </details>
  );
}

/** A series of a chart: its legend label, its mark and which token colors it. */
export interface PlotSeries {
  label: string;
  mark: Mark;
  tone: "series1" | "series2" | "series3" | "ctx";
}

/** Point sets on one x and one y axis, colored from the chart tokens; points sharing an x all show. */
export function Plot({
  series,
  sets,
  x,
  y,
  className,
}: {
  series: readonly PlotSeries[];
  sets: readonly (readonly Point[])[];
  x: { label: string; unit: string };
  y: { label: string; unit: string };
  className?: string;
}) {
  const tokens = useChartTokens();
  const [hover, setHover] = useState<number>();
  const colored = useMemo<Series[]>(
    () => series.map((s) => ({ label: s.label, mark: s.mark, color: tokens[s.tone] })),
    [series, tokens],
  );
  const data = useMemo<uPlot.AlignedData>(() => scatter(sets), [sets]);
  const options = useMemo<ChartOptions>(
    () => ({
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false } },
      axes: [axis(tokens, x.label), axis(tokens, y.label, { size: 60 })],
      series: [{}, ...colored.map((s) => seriesOf(s, tokens.surface))],
      hooks: {
        setCursor: [
          (u) => {
            setHover(u.cursor.idx ?? undefined);
          },
        ],
      },
    }),
    [tokens, colored, x.label, y.label],
  );
  return (
    <div className="flex flex-col gap-1">
      <Chart options={options} data={data} className={className ?? "h-56"} />
      <Legend series={colored} />
      <p aria-label="Hover readout" className="h-5 font-mono text-sm text-text-2 tabular-nums">
        {readoutOf(data, colored, hover, x.unit, y.unit)}
      </p>
    </div>
  );
}

const PREVIEW_ROWS = 2000;

function seriesOptions(tokens: ChartTokens, xLabel: string, yLabel: string): ChartOptions {
  return {
    legend: { show: false },
    cursor: { drag: { x: false, y: false } },
    scales: { x: { time: false } },
    axes: [axis(tokens, xLabel), axis(tokens, yLabel, { size: 60 })],
    series: [{}, { label: yLabel, stroke: tokens.series1, width: 1.5, points: { show: false } }],
  };
}

interface Opened {
  bytes: Uint8Array<ArrayBuffer>;
  cols: Columns;
  preview: Preview;
}

function CaptureRows({ uid, utc, capture }: { uid: string; utc: string; capture: ListedCapture }) {
  const [opened, setOpened] = useState<Opened>();
  const [error, setError] = useState<string>();
  const [column, setColumn] = useState<string>();
  const tokens = useChartTokens();
  const tickHz = num(capture.metaDoc, "tick_hz");
  const names = opened === undefined ? [] : [...opened.cols.keys()];
  const shownColumn = column ?? (names.includes("pos") ? "pos" : (names[1] ?? names[0] ?? ""));
  const series = useMemo(
    () => (opened === undefined ? undefined : captureSeries(opened.cols, shownColumn, tickHz)),
    [opened, shownColumn, tickHz],
  );
  const options = useMemo(
    () => (series === undefined ? undefined : seriesOptions(tokens, series.xLabel, shownColumn)),
    [tokens, series, shownColumn],
  );
  const data = useMemo<uPlot.AlignedData | undefined>(
    () => (series === undefined ? undefined : [series.x, series.y]),
    [series],
  );

  async function open() {
    try {
      const read = await readCapture(uid, utc, capture.rows);
      if (read === undefined) {
        setError(trimmedText(capture));
        return;
      }
      setOpened({
        bytes: read.bytes,
        cols: parseCsv(read.text),
        preview: csvPreview(read.text, PREVIEW_ROWS),
      });
    } catch (e) {
      setError(message(e));
    }
  }

  if (opened === undefined) {
    return (
      <div className="flex flex-col gap-1">
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            void open();
          }}
        >
          Open rows
        </Button>
        {error !== undefined && <p className="text-text-3">{error}</p>}
      </div>
    );
  }
  const name = capture.rows.slice(capture.rows.lastIndexOf("/") + 1);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={shownColumn} onValueChange={setColumn}>
          <SelectTrigger aria-label="Column" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {names.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            download(opened.bytes, name, name.endsWith(".gz") ? "application/gzip" : "text/csv");
          }}
        >
          <Download />
          Download {name}
        </Button>
      </div>
      {options !== undefined && data !== undefined && (
        <Chart options={options} data={data} className="h-48" />
      )}
      <p className="text-sm text-text-3">
        {opened.preview.total > opened.preview.rows.length
          ? `The first ${String(opened.preview.rows.length)} of ${String(opened.preview.total)} rows.`
          : `All ${String(opened.preview.total)} rows.`}
      </p>
      <div className="max-h-80 overflow-auto">
        <table aria-label={`Rows of ${name}`} className="text-xs tabular-nums">
          <thead className="sticky top-0 bg-card text-left text-text-3">
            <tr>
              {opened.preview.header.map((h) => (
                <th key={h} className="pr-3 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {opened.preview.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="pr-3">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A capture folder's captures, each with what it was and its rows, or the note that they were trimmed. */
export function CapturesCard({ uid, utc, dir }: { uid: string; utc: string; dir: string }) {
  const { data, error } = useCaptures(uid, utc, dir);
  return (
    <DrillCard
      title="Captures"
      says={`The rows the step read, from ${dir}/. Each opens as a chart of one column and its first rows.`}
    >
      {error !== undefined && <p className="text-danger">{error}</p>}
      {data === undefined ? (
        error === undefined && <Skeleton className="h-24 w-full" />
      ) : data.length === 0 ? (
        <p className="text-text-3">The run folder holds no {dir}/.</p>
      ) : (
        <ul aria-label="Capture list" className="flex flex-col divide-y">
          {data.map((c) => (
            <li key={c.name} aria-label={c.name} className="flex flex-col gap-1 py-2">
              <span>
                <span className="font-mono text-sm">{c.name}</span>
                {c.metaDoc !== undefined && (
                  <span className="text-text-2"> . {planText(c.metaDoc)}</span>
                )}
              </span>
              {c.kept ? (
                <CaptureRows uid={uid} utc={utc} capture={c} />
              ) : (
                <p className="text-sm text-text-3">{trimmedText(c)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </DrillCard>
  );
}
