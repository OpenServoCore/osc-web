import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import uPlot from "uplot";
import { Chart, type ChartOptions } from "@/components/uplot";
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
import { readFile } from "@/lib/opfs";
import { moveCaptures, moveTrace, readRows, short, type MoveTrace } from "@/lib/report";
import type {
  Accuracy,
  Card as ReportCardData,
  Effort,
  Inputs,
  Moves,
  Speed,
  Tile,
} from "@/lib/report-cards";
import { storage } from "@/lib/use-library";
import { axis, Legend, PointChart, readoutOf, seriesOf, type Series } from "./charts";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A report card: its title, the sentence saying what it shows, and the data or why there is none. */
export function ReportCard<T>({
  title,
  says,
  card,
  className,
  children,
}: {
  title: string;
  says: string;
  card: ReportCardData<T>;
  className?: string;
  children: (data: T) => ReactNode;
}) {
  return (
    <Card role="region" aria-label={title} className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-text-2">{says}</p>
        {"why" in card ? <p className="text-text-3">{card.why}</p> : children(card.data)}
      </CardContent>
    </Card>
  );
}

export function Tiles({
  tiles,
  uid,
  utc,
}: {
  tiles: readonly ReportCardData<Tile>[];
  uid: string;
  utc: string;
}) {
  return (
    <section
      aria-label="Headline numbers"
      className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3"
    >
      {tiles.map((t, i) =>
        "why" in t ? (
          <div key={i} className="rounded-lg border bg-card p-3 text-sm text-text-3">
            {t.why}
          </div>
        ) : (
          <div
            key={t.data.label}
            role="group"
            aria-label={t.data.label}
            className="rounded-lg border bg-card hover:border-border-strong"
          >
            <Link
              to="/runs/$uid/$utc/$step"
              params={{ uid, utc, step: t.data.step }}
              search={true}
              className="flex flex-col gap-0.5 p-3"
            >
              <span className="text-sm text-text-3">{t.data.label}</span>
              <span className="text-xl font-semibold tabular-nums">{t.data.value}</span>
              {t.data.spread !== undefined && (
                <span className="text-sm text-text-2 tabular-nums">{t.data.spread}</span>
              )}
              <span className="text-xs text-text-3">{t.data.about}</span>
            </Link>
          </div>
        ),
      )}
    </section>
  );
}

function accuracySeries(tokens: ChartTokens): Series[] {
  return [
    { label: "what the pot alone reads off", mark: "line", color: tokens.series1 },
    { label: "up and down differ by (rms)", mark: "steps", color: tokens.series2 },
  ];
}

export function AccuracyChart({ accuracy }: { accuracy: Accuracy }) {
  const tokens = useChartTokens();
  const [hover, setHover] = useState<number>();
  const series = useMemo(() => accuracySeries(tokens), [tokens]);
  const data = useMemo<uPlot.AlignedData>(
    () => [accuracy.series.x, accuracy.series.y, accuracy.directions],
    [accuracy],
  );
  const options = useMemo<ChartOptions>(
    () => ({
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false } },
      axes: [axis(tokens, "horn angle, deg"), axis(tokens, "deg", { size: 60 })],
      series: [{}, ...series.map((s) => seriesOf(s, tokens.surface))],
      hooks: {
        setCursor: [
          (u) => {
            setHover(u.cursor.idx ?? undefined);
          },
        ],
      },
    }),
    [tokens, series],
  );
  const held = accuracy.held;
  return (
    <div className="flex flex-col gap-1">
      <Chart options={options} data={data} className="h-48" />
      <Legend series={series} />
      <p aria-label="Hover readout" className="h-5 font-mono text-sm text-text-2 tabular-nums">
        {readoutOf(data, series, hover, "deg", "deg")}
      </p>
      {held.length > 0 && (
        <p aria-label="Passes the table never saw">
          Passes the table never saw land within{" "}
          {held
            .map(
              (h) =>
                `${h.counts.toFixed(2)} counts rms (${h.deg.toFixed(3)} deg, rung ${String(h.rung)})`,
            )
            .join("; ")}
          .
        </p>
      )}
    </div>
  );
}

function scoreText(v: number | undefined, unit: string, digits: number): string {
  return v === undefined ? "not recorded" : `${v.toFixed(digits)} ${unit}`;
}

const DEFAULT_MOVE = "10% + out";

export function MoveResponse({ moves, uid, utc }: { moves: Moves; uid: string; utc: string }) {
  const names = moves.moves.map((m) => m.name);
  const [chosen, setChosen] = useState(
    names.includes(DEFAULT_MOVE) ? DEFAULT_MOVE : (names[0] ?? ""),
  );
  const score = moves.moves.find((m) => m.name === chosen);
  const [trace, setTrace] = useState<{ name: string; trace?: MoveTrace; error?: string }>();
  const tokens = useChartTokens();

  useEffect(() => {
    if (score === undefined) return;
    let live = true;
    void (async () => {
      try {
        const root = await storage();
        const files = (await moveCaptures(root, uid, utc)).filter((c) => c.move === score.name);
        const first = files[0];
        if (first === undefined) {
          if (live)
            setTrace({ name: score.name, error: "The run folder holds no capture of this move." });
          return;
        }
        const rows = new Map<string, (number | null)[]>();
        for (const f of files) {
          const bytes = await readFile(root, f.file);
          if (bytes === null) continue;
          for (const [k, v] of await readRows(bytes)) rows.set(k, [...(rows.get(k) ?? []), ...v]);
        }
        const t = moveTrace(rows, {
          cal: moves.cal,
          points: moves.points,
          slots: moves.slots,
          currentZeroCounts: moves.currentZeroCounts,
          countsPerA: moves.countsPerA,
          tickHz: first.tickHz,
          fromCounts: score.fromCounts,
          goalCounts: score.goalCounts,
        });
        if (live) setTrace({ name: score.name, trace: t });
      } catch (e) {
        if (live) setTrace({ name: score.name, error: message(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [score, moves, uid, utc]);

  const shown = trace?.name === chosen ? trace : undefined;
  const pos = useMemo<Series[]>(
    () => [
      { label: "position", mark: "line", color: tokens.series1 },
      { label: "goal", mark: "steps", color: tokens.ctx },
    ],
    [tokens],
  );
  const cur = useMemo<Series[]>(
    () => [{ label: "current", mark: "line", color: tokens.series2 }],
    [tokens],
  );
  const sync = useMemo(() => ({ key: `move-${uid}-${utc}` }), [uid, utc]);
  const posOptions = useMemo<ChartOptions>(
    () => ({
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, sync },
      scales: { x: { time: false } },
      axes: [axis(tokens, "time, s"), axis(tokens, "position, deg", { size: 60 })],
      series: [{}, ...pos.map((s) => seriesOf(s, tokens.surface))],
    }),
    [tokens, sync, pos],
  );
  const curOptions = useMemo<ChartOptions>(
    () => ({
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, sync },
      scales: { x: { time: false } },
      axes: [axis(tokens, "time, s"), axis(tokens, "current, mA", { size: 60 })],
      series: [{}, ...cur.map((s) => seriesOf(s, tokens.surface))],
    }),
    [tokens, sync, cur],
  );
  const posData = useMemo<uPlot.AlignedData | undefined>(
    () =>
      shown?.trace === undefined ? undefined : [shown.trace.t, shown.trace.deg, shown.trace.goal],
    [shown],
  );
  const curData = useMemo<uPlot.AlignedData | undefined>(
    () => (shown?.trace === undefined ? undefined : [shown.trace.t, shown.trace.ma]),
    [shown],
  );

  return (
    <div className="flex flex-col gap-2">
      <Select value={chosen} onValueChange={setChosen}>
        <SelectTrigger aria-label="Move" className="w-48">
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
      {shown?.error !== undefined && <p className="text-text-3">{shown.error}</p>}
      {posData === undefined || curData === undefined ? (
        shown?.error === undefined && <Skeleton className="h-80 w-full" />
      ) : (
        <>
          <Chart options={posOptions} data={posData} className="h-44" />
          <Chart options={curOptions} data={curData} className="h-32" />
          <Legend series={[...pos, ...cur]} />
        </>
      )}
      {score !== undefined && (
        <ul aria-label="Move scores" className="grid grid-cols-2 gap-x-6 text-sm tabular-nums">
          <li>Step: {scoreText(score.stepDeg, "deg", 2)}</li>
          <li>
            Overshoot: {scoreText(score.overshootDeg, "deg", 2)} (bound{" "}
            {scoreText(score.overshootBoundDeg, "deg", 2)})
          </li>
          <li>Settle time: {scoreText(score.settleS, "s", 3)}</li>
          <li>Rest error: {scoreText(score.restErrorDeg, "deg", 2)}</li>
          <li>
            Peak current:{" "}
            {score.currentPeakA === undefined
              ? "not recorded"
              : `${(score.currentPeakA * 1000).toFixed(0)} mA`}
          </li>
          <li>Following error: {scoreText(score.followPeakDeg, "deg", 2)}</li>
        </ul>
      )}
    </div>
  );
}

export function SpeedChart({ speed }: { speed: Speed }) {
  const tokens = useChartTokens();
  const series = useMemo<Series[]>(
    () => [
      { label: "spins up", mark: "dots", color: tokens.series1 },
      { label: "spins down", mark: "dots", color: tokens.series2 },
      { label: "V / Ke", mark: "line", color: tokens.ctx },
      { label: "stated", mark: "hollow", color: tokens.series3 },
    ],
    [tokens],
  );
  const sets = useMemo(() => [speed.up, speed.down, speed.line, speed.stated], [speed]);
  return (
    <PointChart
      tokens={tokens}
      series={series}
      sets={sets}
      x={{ label: "volts, V", unit: "V" }}
      y={{ label: "speed at the horn, deg/s", unit: "deg/s" }}
    />
  );
}

export function EffortChart({ effort }: { effort: Effort }) {
  const tokens = useChartTokens();
  const series = useMemo<Series[]>(
    () => [
      { label: "up", mark: "dots", color: tokens.series1 },
      { label: "down", mark: "dots", color: tokens.series2 },
      { label: "mean", mark: "hollow", color: tokens.series3 },
      { label: "line", mark: "line", color: tokens.ctx },
    ],
    [tokens],
  );
  const sets = useMemo(() => [effort.up, effort.down, effort.mean, effort.line], [effort]);
  return (
    <div className="flex flex-col gap-1">
      <PointChart
        tokens={tokens}
        series={series}
        sets={sets}
        x={{ label: "speed at the horn, deg/s", unit: "deg/s" }}
        y={{ label: "current, mA", unit: "mA" }}
      />
      <p aria-label="Friction line">
        Line {short(effort.coulombMa)} mA + {short(effort.viscousMaPerDegS)} mA per deg/s
        {effort.rmsMa === undefined ? "" : `, rms ${short(effort.rmsMa)} mA`}
        {effort.legs === undefined ? "" : ` over ${String(effort.legs)} legs`}.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="shrink-0 text-text-3">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export function InputsView({ inputs }: { inputs: Inputs }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Row label="Profile">{inputs.profile}</Row>
        <Row label="Policy">{inputs.policy}</Row>
        {inputs.headline.map((l) => (
          <Row key={l.field} label={l.label ?? l.field}>
            {l.value}
            {l.note === undefined ? "" : ` (${l.note})`}
            <span className="text-text-3"> . {l.form}</span>
          </Row>
        ))}
      </div>
      <section aria-label="Clamps" className="flex flex-col gap-1">
        <h3 className="font-medium">Values stored at a bound</h3>
        {inputs.clamps.length === 0 ? (
          <p className="text-text-3">The resolve stored no value at a bound.</p>
        ) : (
          <ul className="text-sm">
            {inputs.clamps.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </section>
      <p aria-label="Heat model">{inputs.heat}</p>
      <table aria-label="Cross-checks" className="w-full text-sm tabular-nums">
        <caption className="mb-1 text-left font-medium">
          The profile beside the run (reported, not judged)
        </caption>
        <thead className="text-left text-text-3">
          <tr>
            <th className="py-1 font-normal">Check</th>
            <th className="py-1 font-normal">The run</th>
            <th className="py-1 font-normal">The profile</th>
            <th className="py-1 font-normal">Difference</th>
          </tr>
        </thead>
        <tbody>
          {inputs.checks.map((c) => (
            <tr key={c.what} className="border-t align-baseline">
              <td className="py-1 pr-4">{c.what}</td>
              <td className="py-1 pr-4">{c.run}</td>
              <td className="py-1 pr-4" title={c.statedFrom}>
                {c.stated}
              </td>
              <td className="py-1">{c.difference ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details>
        <summary className="cursor-pointer text-sm text-text-2">
          Every resolved value ({inputs.lines.length})
        </summary>
        <table aria-label="Resolved values" className="mt-2 w-full text-sm">
          <thead className="text-left text-text-3">
            <tr>
              <th className="py-1 font-normal">Field</th>
              <th className="py-1 font-normal">Form</th>
              <th className="py-1 font-normal">Value</th>
              <th className="py-1 font-normal">Binds</th>
            </tr>
          </thead>
          <tbody>
            {inputs.lines.map((l) => (
              <tr key={l.field} className="border-t align-baseline">
                <td className="py-1 pr-4 font-mono text-xs">{l.field}</td>
                <td className="py-1 pr-4">{l.form}</td>
                <td className="py-1 pr-4">
                  {l.value}
                  {l.note === undefined ? "" : ` (${l.note})`}
                </td>
                <td className="py-1 font-mono text-xs">{l.binds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
