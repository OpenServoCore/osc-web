import { CircleQuestionMark, Download, Zap } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type uPlot from "uplot";
import { Chart, type ChartOptions } from "@/components/uplot";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBus, useReadOnce } from "@/lib/bus/hooks";
import { useChartTokens, type ChartTokens } from "@/lib/chart-theme";
import { hex16 } from "@/lib/format";
import { useSession } from "@/lib/session";
import {
  decodeBurst,
  DEFAULT_FIELDS,
  familyOf,
  FIELDS,
  maskIssue,
  maskOf,
  summarize,
  summaryText,
  toCsv,
  unitsFor,
  type FieldKey,
  type Row,
  type Summary,
  type Unit,
} from "@/lib/stream";
import {
  BIAS_REGISTERS,
  CONFIG_REGISTERS,
  configFrom,
  type TelemetryConfig,
} from "@/lib/telemetry";
import { calibrationStatus } from "@/lib/units";
import { useUnitsPref } from "@/lib/use-pref";

const DEFAULT_COUNT = 120;
const DEFAULT_WINDOW_MS = 500;
/** tel_count is a u16 on the wire. */
const COUNT_MAX = 65535;
/** The burst window is a u32 of microseconds. */
const WINDOW_MAX_MS = 4_294_967;
const DASH = [6, 4];
const COLORS: readonly (keyof ChartTokens)[] = ["series1", "series2", "series3", "ctx"];
/** The conversion registers plus the tick rate a burst's time axis needs. */
const STREAM_REGISTERS: readonly string[] = [...CONFIG_REGISTERS, ...BIAS_REGISTERS, "tick_hz"];

interface StreamConfig extends TelemetryConfig {
  tickHz: number;
}

interface Capture {
  mask: number;
  rows: Row[];
  summary: Summary;
  at: Date;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function wholeIn(text: string, max: number): number | undefined {
  const n = Number(text);
  return /^\d+$/.test(text.trim()) && n >= 1 && n <= max ? n : undefined;
}

function spanMs(samples: number, tickHz: number): number {
  return (samples / tickHz) * 1000;
}

function chartOptions(units: readonly Unit[], tokens: ChartTokens, tickHz: number): ChartOptions {
  const axis = {
    stroke: tokens.label,
    grid: { stroke: tokens.grid, width: 1 },
    ticks: { stroke: tokens.axis, width: 1 },
  };
  const right = units.some((u) => familyOf(u.key) === "electrical");
  const left = units.some((u) => familyOf(u.key) === "position");
  return {
    legend: { show: false },
    cursor: { drag: { x: false, y: false } },
    scales: { x: { time: false }, ...(left ? { y: {} } : {}), ...(right ? { r: {} } : {}) },
    axes: [
      { ...axis, label: tickHz > 0 ? "ms" : "sample" },
      ...(left ? [{ ...axis, scale: "y", size: 60 }] : []),
      ...(right ? [{ ...axis, scale: "r", side: 1, size: 60, grid: { show: false } }] : []),
    ],
    series: [
      {},
      ...units.map((u, i) => ({
        label: u.key,
        scale: familyOf(u.key) === "position" ? "y" : "r",
        stroke: tokens[COLORS[i % COLORS.length] ?? "ctx"],
        width: 1.5,
        dash: i >= COLORS.length ? DASH : undefined,
        points: { show: false },
      })),
    ],
  };
}

function saveCsv(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export function StreamTab({ id }: { id: number }) {
  const { descriptor, descriptorError } = useSession();
  const bus = useBus();
  const stream = useReadOnce(id, STREAM_REGISTERS, [descriptor]);
  const [fields, setFields] = useState<readonly FieldKey[]>(DEFAULT_FIELDS);
  const [count, setCount] = useState(String(DEFAULT_COUNT));
  const [windowMs, setWindowMs] = useState(String(DEFAULT_WINDOW_MS));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [capture, setCapture] = useState<Capture>();
  const [unitsPref] = useUnitsPref();
  const tokens = useChartTokens();
  const countId = useId();
  const windowId = useId();
  const fieldsId = useId();

  const { snapshot } = stream;
  const config = useMemo<StreamConfig | undefined>(
    () =>
      snapshot === undefined
        ? undefined
        : { ...configFrom(snapshot.read), tickHz: snapshot.read("tick_hz") },
    [snapshot],
  );

  const calibrated = config !== undefined && calibrationStatus(config.cal).valid;
  const raw = !calibrated || unitsPref === "raw";
  const mask = maskOf(fields);
  const samples = wholeIn(count, COUNT_MAX);
  const window = wholeIn(windowMs, WINDOW_MAX_MS);
  const tickHz = config?.tickHz ?? 0;
  const units = useMemo(
    () => (capture === undefined ? [] : unitsFor(capture.mask, config, raw)),
    [capture, config, raw],
  );
  const options = useMemo(() => chartOptions(units, tokens, tickHz), [units, tokens, tickHz]);
  const data = useMemo<uPlot.AlignedData>(() => {
    const rows = capture?.rows ?? [];
    return [
      rows.map((r) => (tickHz > 0 ? spanMs(r.sample, tickHz) : r.sample)),
      ...units.map((u) =>
        rows.map((r) => {
          const c = r.values[u.key];
          return c === undefined ? null : u.convert(c);
        }),
      ),
    ];
  }, [capture, units, tickHz]);

  const startCapture = () => {
    const issue = maskIssue(mask);
    if (descriptor === undefined || samples === undefined || window === undefined) return;
    if (issue !== undefined) {
      setError(issue);
      return;
    }
    setPending(true);
    bus
      .command((c) => c.telBurst(id, descriptor, mask, samples, window * 1000))
      .then(
        (burst) => {
          const rows = decodeBurst(burst.frames, mask);
          setCapture({ mask, rows, summary: summarize(burst, rows), at: new Date() });
          setError(undefined);
        },
        (e: unknown) => {
          setError(message(e));
        },
      )
      .finally(() => {
        setPending(false);
      });
  };

  const problem = error ?? (descriptor === undefined ? undefined : stream.error) ?? descriptorError;
  const heading = `${fieldsId}-chart`;
  const title = (family: "position" | "electrical") =>
    [...new Set(units.filter((u) => familyOf(u.key) === family).map((u) => u.unit))].join(", ");

  return (
    <div className="flex items-start gap-4">
      <Card className="w-[360px] shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="size-4" />
            Capture
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label="About capture">
                  <CircleQuestionMark />
                </Button>
              </PopoverTrigger>
              <PopoverContent side="bottom" align="start">
                A burst records the servo's own control-tick samples for a few milliseconds, far
                faster than Telemetry polls. Pick the fields and a sample count, then Capture: the
                servo streams the batch over the bus and the line is its own until the last frame.
              </PopoverContent>
            </Popover>
          </CardTitle>
        </CardHeader>
        <CardContent className="gap-4">
          <fieldset aria-labelledby={fieldsId}>
            <legend id={fieldsId} className="mb-2 text-xs font-medium text-text-3 uppercase">
              Fields
            </legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {FIELDS.map((f) => {
                const boxId = `${fieldsId}-${f.key}`;
                return (
                  <div key={f.key} className="flex items-center gap-2">
                    <Checkbox
                      id={boxId}
                      checked={fields.includes(f.key)}
                      onCheckedChange={(on) => {
                        setFields(
                          on === true
                            ? FIELDS.filter((x) => x.key === f.key || fields.includes(x.key)).map(
                                (x) => x.key,
                              )
                            : fields.filter((k) => k !== f.key),
                        );
                      }}
                    />
                    <Label htmlFor={boxId} className="font-normal">
                      {f.label}
                    </Label>
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-2">
            <Label htmlFor={countId}>Samples</Label>
            <Input
              id={countId}
              type="number"
              inputMode="numeric"
              className="font-mono tabular-nums"
              min={1}
              max={COUNT_MAX}
              step={1}
              value={count}
              aria-invalid={samples === undefined}
              onChange={(e) => {
                setCount(e.target.value);
              }}
            />
            <span className="text-sm text-text-3">of {COUNT_MAX}</span>
            <Label htmlFor={windowId}>Window</Label>
            <Input
              id={windowId}
              type="number"
              inputMode="numeric"
              className="font-mono tabular-nums"
              min={1}
              max={WINDOW_MAX_MS}
              step={1}
              value={windowMs}
              aria-invalid={window === undefined}
              onChange={(e) => {
                setWindowMs(e.target.value);
              }}
            />
            <span className="text-sm text-text-3">ms</span>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              className="self-start"
              aria-busy={pending}
              disabled={
                pending || descriptor === undefined || samples === undefined || window === undefined
              }
              onClick={startCapture}
            >
              <Zap />
              {pending ? "Capturing..." : "Capture"}
            </Button>
            <p className="text-sm text-text-3">
              {fields.length} fields x {samples ?? "?"} samples
              {config !== undefined && samples !== undefined
                ? ` = ${spanMs(samples, config.tickHz).toFixed(1)} ms at ${(config.tickHz / 1000).toFixed(0)} kHz`
                : ""}
            </p>
            <p className="font-mono text-xs text-text-3">
              tel_mask {hex16(mask)} - tel_count {samples ?? "?"}
            </p>
            {capture !== undefined && (
              <p aria-label="Capture summary" className="text-sm text-text-3">
                {summaryText(capture.summary)}
              </p>
            )}
            {problem !== undefined && <p className="text-sm text-danger">{problem}</p>}
          </div>
        </CardContent>
      </Card>
      <Card className="min-w-0 flex-1">
        <CardHeader>
          <CardTitle>Last burst</CardTitle>
          <CardDescription>
            {capture === undefined
              ? "no capture yet"
              : `${capture.rows.length} samples${
                  tickHz > 0 ? `, ${spanMs(capture.rows.length, tickHz).toFixed(1)} ms` : ""
                }, ${capture.at.toLocaleTimeString()}`}
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              disabled={capture === undefined}
              onClick={() => {
                if (capture === undefined) return;
                const stamp = capture.at.toISOString().replace(/[:.]/g, "-");
                saveCsv(toCsv(capture.rows, units), `burst-id${id}-${stamp}.csv`);
              }}
            >
              <Download />
              Download .csv
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex h-[max(60vh,calc(100vh-18rem))] flex-col">
            {capture === undefined ? (
              <p className="flex flex-1 items-center justify-center rounded-md border border-dashed text-text-3">
                Capture a burst to see it here
              </p>
            ) : (
              <section aria-labelledby={heading} className="flex min-h-0 flex-1 flex-col">
                <h3 id={heading} className="text-sm font-medium text-text-2">
                  {[title("position"), title("electrical")].filter((t) => t !== "").join(" | ")}
                </h3>
                <Chart options={options} data={data} className="min-h-0 flex-1" />
              </section>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
