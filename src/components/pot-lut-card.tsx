import { ChartSpline } from "lucide-react";
import { useMemo, useState } from "react";
import uPlot from "uplot";
import { Chart, type ChartOptions } from "@/components/uplot";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useClientOnce, useRegisters } from "@/lib/bus/hooks";
import { useChartTokens, type ChartTokens } from "@/lib/chart-theme";
import { diverging, type Diverging } from "@/lib/diverging";
import { hexAddr } from "@/lib/format";
import {
  errorSeries,
  gradeRule,
  gradeText,
  headline,
  hoverWords,
  pointsWords,
  report,
  stateWords,
  type ErrorSeries,
  type Report,
} from "@/lib/pot-lut";
import { useSession } from "@/lib/session";
import { calibrationStatus } from "@/lib/units";

/** A byte beside the cards' span, on their cadence, so a COMMIT elsewhere shows within a second. */
const STATE_REGISTERS: readonly string[] = ["lut_state"];
const PAD = 0.1;
const LABEL_MIN_PX = 100;
/** Color stops across -max..+max; the mapping itself is `diverging`. */
const GRADIENT_STOPS = 32;
const FILL_ALPHA = 0.25;

function padded([lo, hi]: [number, number]): [number, number] {
  const pad = (hi - lo) * PAD;
  return [lo - pad, hi + pad];
}

/** The calibrated band shaded, the flat sides named, and the zero line, under the axes. */
function underlay(s: ErrorSeries, tokens: ChartTokens): (u: uPlot) => void {
  return (u) => {
    const { ctx, bbox } = u;
    const px = uPlot.pxRatio;
    ctx.save();
    if (s.band !== undefined) {
      const x0 = u.valToPos(s.band[0], "x", true);
      const x1 = u.valToPos(s.band[1], "x", true);
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = tokens.series1;
      ctx.fillRect(x0, bbox.top, x1 - x0, bbox.height);
      ctx.globalAlpha = 1;
      ctx.fillStyle = tokens.label;
      ctx.font = `${12 * px}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const flats: [number, number][] = [
        [bbox.left, x0],
        [x1, bbox.left + bbox.width],
      ];
      for (const [a, b] of flats) {
        if (b - a >= LABEL_MIN_PX * px)
          ctx.fillText("not corrected", (a + b) / 2, bbox.top + 4 * px);
      }
    }
    const y0 = u.valToPos(0, "y", true);
    ctx.strokeStyle = tokens.axis;
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.moveTo(bbox.left, y0);
    ctx.lineTo(bbox.left + bbox.width, y0);
    ctx.stroke();
    ctx.restore();
  };
}

/** Reads low is blue, reads high is orange, on target the neutral grey. */
function scaleOf(tokens: ChartTokens): Diverging {
  return { low: tokens.series1, zero: tokens.ctx, high: tokens.series2 };
}

/**
 * The curve's color keyed to the y scale: symmetric about zero so equal
 * errors either way are equally deep. Rebuilt every draw, since the pixel
 * positions move with the host's size.
 */
function gradient(
  s: ErrorSeries,
  scale: Diverging,
  alpha: number,
): (u: uPlot) => CanvasGradient | string {
  return (u) => {
    if (s.maxAbs === 0) return scale.zero;
    const top = u.valToPos(s.maxAbs, "y", true);
    const bottom = u.valToPos(-s.maxAbs, "y", true);
    const g = u.ctx.createLinearGradient(0, top, 0, bottom);
    for (let i = 0; i <= GRADIENT_STOPS; i++) {
      const at = i / GRADIENT_STOPS;
      g.addColorStop(at, diverging(1 - 2 * at, scale, alpha));
    }
    return g;
  };
}

function chartOptions(
  tokens: ChartTokens,
  s: ErrorSeries,
  onHover: (idx: number | undefined) => void,
): ChartOptions {
  const scale = scaleOf(tokens);
  const axis = {
    stroke: tokens.label,
    grid: { stroke: tokens.grid, width: 1 },
    ticks: { stroke: tokens.axis, width: 1 },
  };
  const deg = s.unit === "deg";
  const y = padded([Math.min(0, ...s.y), Math.max(0, ...s.y)]);
  return {
    legend: { show: false },
    cursor: { drag: { x: false, y: false } },
    scales: {
      x: { time: false, range: [s.x[0] ?? 0, s.x.at(-1) ?? 0] },
      y: { range: y },
      r: { range: [y[0] * s.pctPerUnit, y[1] * s.pctPerUnit] },
    },
    axes: [
      { ...axis, label: deg ? "position, deg" : "position, raw counts" },
      { ...axis, scale: "y", size: 60, label: deg ? "error, deg" : "error, counts" },
      {
        ...axis,
        scale: "r",
        side: 1,
        size: 60,
        grid: { show: false },
        label: deg ? "% of travel" : "% of range",
      },
    ],
    series: [
      {},
      {
        label: "error",
        stroke: gradient(s, scale, 1),
        fill: gradient(s, scale, FILL_ALPHA),
        fillTo: 0,
        width: 1.5,
        points: { show: false },
      },
    ],
    hooks: {
      drawClear: [underlay(s, tokens)],
      setCursor: [
        (u) => {
          onHover(u.cursor.idx ?? undefined);
        },
      ],
    },
  };
}

export function PotLutCard({ id, uid }: { id: number; uid: string }) {
  const { descriptor, descriptorError, values } = useSession();
  const tokens = useChartTokens();
  const stateSnapshot = useRegisters(id, STATE_REGISTERS, "slow");
  const state =
    stateSnapshot === undefined || stateSnapshot.stale
      ? undefined
      : stateSnapshot.read("lut_state");
  const lut = useClientOnce(
    (c) => (descriptor === undefined ? Promise.resolve(undefined) : c.readPotLut(id, descriptor)),
    [id, descriptor, state],
  );
  const stateField = descriptor?.fields().find((f) => f.name === "lut_state");
  const stops = values.get(uid)?.constants.calibration;
  const map = stops !== undefined && calibrationStatus(stops).valid ? stops : undefined;
  const table = lut.value;
  const r = useMemo(() => (table === undefined ? undefined : report(table.knots)), [table]);
  const series = useMemo(
    () => (table === undefined ? undefined : errorSeries(table.knots, map)),
    [table, map],
  );
  const [hover, setHover] = useState<number | undefined>(undefined);
  const options = useMemo(
    () => (series === undefined ? undefined : chartOptions(tokens, series, setHover)),
    [tokens, series],
  );
  const data = useMemo<uPlot.AlignedData | undefined>(
    () => (series === undefined ? undefined : [series.x, series.y]),
    [series],
  );
  const problem = lut.error ?? descriptorError;

  return (
    <Card role="region" aria-label="Position calibration" className="col-span-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ChartSpline className="size-4" />
          Position calibration
        </CardTitle>
        {r?.grade !== undefined && (
          <CardAction>
            <GradeChip report={r} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {problem !== undefined && <p className="text-danger">{problem}</p>}
        {table === undefined || r === undefined || series === undefined ? (
          problem === undefined && <Skeleton className="h-5 w-2/3" />
        ) : (
          <>
            <p aria-label="Table state">{stateWords(table.state)}</p>
            <ul aria-label="Table facts" className="text-text-2">
              <li>{pointsWords(r, map)}</li>
              {stops !== undefined && (
                <li>
                  Stops at raw {stops.rawMin} and {stops.rawMax}; the table is the identity outside
                  them.
                </li>
              )}
            </ul>
            {options !== undefined && data !== undefined && r.span !== undefined && (
              <section aria-label="Error vs position" className="mt-3 flex flex-col gap-1">
                <p aria-label="Error headline">{headline(series)}</p>
                <Chart options={options} data={data} className="h-48" />
                <p
                  aria-label="Hover readout"
                  className="h-5 font-mono text-sm text-text-2 tabular-nums"
                >
                  {hover === undefined ? "" : hoverWords(series, hover)}
                </p>
              </section>
            )}
            <p className="font-mono text-xs text-text-3">
              lut_state {stateField === undefined ? "" : hexAddr(stateField.addr)} = {table.state}
              {table.stateName === undefined ? "" : ` ${table.stateName}`}; tables are written with
              osc lut write
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GradeChip({ report: r }: { report: Report }) {
  if (r.grade === undefined) return null;
  const tone =
    r.grade === "A"
      ? "bg-success-soft text-success"
      : r.grade === "B"
        ? "bg-warning-soft text-warning"
        : "bg-danger-soft text-danger";
  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge className={tone} aria-label="Grade">
          Grade {r.grade} - {gradeText(r.grade)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">{gradeRule()}</TooltipContent>
    </Tooltip>
  );
}
