import { ChartSpline } from "lucide-react";
import { useMemo } from "react";
import type uPlot from "uplot";
import { Chart, type ChartOptions } from "@/components/uplot";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useClientOnce, useRegisters } from "@/lib/bus/hooks";
import { useChartTokens, type ChartTokens } from "@/lib/chart-theme";
import { hexAddr } from "@/lib/format";
import {
  GRID,
  gradeRule,
  gradeText,
  INTERVALS,
  report,
  stateWords,
  summary,
  type Report,
} from "@/lib/pot-lut";
import { useSession } from "@/lib/session";

/** A byte beside the cards' span, on their cadence, so a COMMIT elsewhere shows within a second. */
const STATE_REGISTERS: readonly string[] = ["lut_state"];
const ADC_SPAN = INTERVALS * GRID;

function chartOptions(
  tokens: ChartTokens,
  label: string,
  token: keyof ChartTokens,
  range: [number, number] | undefined,
): ChartOptions {
  const axis = {
    stroke: tokens.label,
    grid: { stroke: tokens.grid, width: 1 },
    ticks: { stroke: tokens.axis, width: 1 },
  };
  return {
    legend: { show: false },
    cursor: { drag: { x: false, y: false } },
    scales: { x: { time: false, range: [0, ADC_SPAN] }, y: range === undefined ? {} : { range } },
    axes: [
      { ...axis, label: "raw counts" },
      { ...axis, scale: "y", size: 60, label },
    ],
    series: [{}, { label, stroke: tokens[token], width: 1.5, points: { show: false } }],
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
  const table = lut.value;
  const r = useMemo(() => (table === undefined ? undefined : report(table.knots)), [table]);
  const correction = useMemo(
    () => chartOptions(tokens, "correction, counts", "series1", undefined),
    [tokens],
  );
  const gain = useMemo(
    () => chartOptions(tokens, "gain, x nominal", "series2", undefined),
    [tokens],
  );
  const data = useMemo<
    { correction: uPlot.AlignedData; gain: uPlot.AlignedData } | undefined
  >(() => {
    if (table === undefined || r === undefined) return undefined;
    const knotsX = Array.from({ length: INTERVALS + 1 }, (_, k) => k * GRID);
    const gainsX = Array.from({ length: INTERVALS }, (_, k) => k * GRID + GRID / 2);
    return {
      correction: [knotsX, [...table.knots, 0]],
      gain: [gainsX, r.gains],
    };
  }, [table, r]);
  const problem = lut.error ?? descriptorError;

  return (
    <Card role="region" aria-label="Pot table" className="col-span-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ChartSpline className="size-4" />
          Pot table
        </CardTitle>
        {r?.grade !== undefined && (
          <CardAction>
            <GradeChip report={r} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {problem !== undefined && <p className="text-danger">{problem}</p>}
        {table === undefined || r === undefined ? (
          problem === undefined && <Skeleton className="h-5 w-2/3" />
        ) : (
          <>
            <p aria-label="Table state">{stateWords(table.state)}</p>
            <ul aria-label="Table facts" className="text-text-2">
              {summary(r).map((line) => (
                <li key={line}>{line}</li>
              ))}
              {stops !== undefined && (
                <li>
                  Stops at raw {stops.rawMin} and {stops.rawMax}; the table is the identity outside
                  them.
                </li>
              )}
            </ul>
            {data !== undefined && r.span !== undefined && (
              <div className="flex flex-col gap-3">
                <section aria-label="Correction curve" className="h-44">
                  <Chart options={correction} data={data.correction} className="h-full" />
                </section>
                <section aria-label="Local gain" className="h-44">
                  <Chart options={gain} data={data.gain} className="h-full" />
                </section>
              </div>
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
