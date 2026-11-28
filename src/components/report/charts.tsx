import { useMemo, useState } from "react";
import uPlot from "uplot";
import { Chart, type ChartOptions } from "@/components/uplot";
import type { ChartTokens } from "@/lib/chart-theme";
import { withUnit } from "@/lib/format";
import type { Point } from "@/lib/report-cards";

export type Mark = "dots" | "hollow" | "line" | "steps" | "dashed";

export interface Series {
  label: string;
  mark: Mark;
  color: string;
}

const DOT_PX = 8;

export function axis(tokens: ChartTokens, label: string, extra?: uPlot.Axis): uPlot.Axis {
  return {
    stroke: tokens.label,
    grid: { stroke: tokens.grid, width: 1 },
    ticks: { stroke: tokens.axis, width: 1 },
    label,
    ...extra,
  };
}

export function seriesOf(s: Series, surface: string): uPlot.Series {
  const base: uPlot.Series = { label: s.label, stroke: s.color, width: 2, spanGaps: true };
  switch (s.mark) {
    case "dots":
      return {
        ...base,
        paths: () => null,
        points: { show: true, size: DOT_PX, fill: s.color, stroke: s.color },
      };
    case "hollow":
      return {
        ...base,
        paths: () => null,
        points: { show: true, size: DOT_PX + 2, width: 2, fill: surface, stroke: s.color },
      };
    case "steps":
      return {
        ...base,
        spanGaps: false,
        paths: uPlot.paths.stepped?.({ align: 1 }),
        points: { show: false },
      };
    case "dashed":
      return { ...base, dash: [6, 4], points: { show: false } };
    case "line":
      return { ...base, points: { show: false } };
  }
}

/** Point sets on one x axis: the union of their x, each set null where it has no point. */
export function aligned(sets: readonly (readonly Point[])[]): uPlot.AlignedData {
  const xs = [...new Set(sets.flatMap((s) => s.map((p) => p.x)))].sort((a, b) => a - b);
  const ys = sets.map((s) => {
    const at = new Map(s.map((p) => [p.x, p.y]));
    return xs.map((x) => at.get(x) ?? null);
  });
  return [xs, ...ys];
}

function swatch(s: Series) {
  const w = 18;
  const h = 10;
  if (s.mark === "dots" || s.mark === "hollow") {
    return (
      <svg width={w} height={h} aria-hidden="true">
        <circle
          cx={w / 2}
          cy={h / 2}
          r={3.5}
          fill={s.mark === "dots" ? s.color : "none"}
          stroke={s.color}
          strokeWidth={1.5}
        />
      </svg>
    );
  }
  return (
    <svg width={w} height={h} aria-hidden="true">
      <path
        d={s.mark === "steps" ? `M1 8 H8 V2 H17` : `M1 5 H17`}
        fill="none"
        stroke={s.color}
        strokeWidth={2}
        strokeDasharray={s.mark === "dashed" ? "4 3" : undefined}
      />
    </svg>
  );
}

export function Legend({ series }: { series: readonly Series[] }) {
  return (
    <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-2">
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          {swatch(s)}
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function fmt(v: number): string {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

/** The values under the cursor, in text ink: "1.20 V: up 96.2, line 192.9". */
export function readoutOf(
  data: uPlot.AlignedData,
  series: readonly Series[],
  idx: number | undefined,
  xUnit: string,
  yUnit: string,
): string {
  if (idx === undefined) return "";
  const x = data[0][idx];
  if (x === undefined) return "";
  const parts = series.flatMap((s, i) => {
    const y = data[i + 1]?.[idx];
    return y === null || y === undefined ? [] : [`${s.label} ${withUnit(fmt(y), yUnit)}`];
  });
  return parts.length === 0 ? "" : `${withUnit(fmt(x), xUnit)}: ${parts.join(", ")}`;
}

/** Points and lines on one x and one y axis, with a legend and the values under the cursor. */
export function PointChart({
  tokens,
  series,
  sets,
  x,
  y,
  className,
}: {
  tokens: ChartTokens;
  series: readonly Series[];
  sets: readonly (readonly Point[])[];
  x: { label: string; unit: string };
  y: { label: string; unit: string };
  className?: string;
}) {
  const [hover, setHover] = useState<number>();
  const data = useMemo(() => aligned(sets), [sets]);
  const options = useMemo<ChartOptions>(
    () => ({
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false } },
      axes: [axis(tokens, x.label), axis(tokens, y.label, { size: 60 })],
      series: [{}, ...series.map((s) => seriesOf(s, tokens.surface))],
      hooks: {
        setCursor: [
          (u) => {
            setHover(u.cursor.idx ?? undefined);
          },
        ],
      },
    }),
    [tokens, series, x.label, y.label],
  );
  return (
    <div className="flex flex-col gap-1">
      <Chart options={options} data={data} className={className ?? "h-56"} />
      <Legend series={series} />
      <p aria-label="Hover readout" className="h-5 font-mono text-sm text-text-2 tabular-nums">
        {readoutOf(data, series, hover, x.unit, y.unit)}
      </p>
    </div>
  );
}
