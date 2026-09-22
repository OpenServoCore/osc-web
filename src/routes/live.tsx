import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type uPlot from "uplot";
import { Chart, type ChartOptions } from "@/components/uplot";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChartTokens, type ChartTokens } from "@/lib/chart-theme";
import { inFlight } from "@/lib/in-flight";
import { isUnits, type Units } from "@/lib/prefs";
import { useSession } from "@/lib/session";
import {
  POLL_HZ,
  SampleRing,
  startTelemetry,
  WINDOW_S,
  type Sample,
  type TelemetryConfig,
} from "@/lib/telemetry-poll";
import {
  busV,
  calibrationStatus,
  currentMa,
  DISPLAY,
  positionDeg,
  temperatureC,
  vdiffV,
  velocityDegPerS,
  type Display,
} from "@/lib/units";
import { useUnitsPref } from "@/lib/use-pref";

export const Route = createFileRoute("/live")({ component: LivePage });

type SeriesKey =
  "position" | "goal" | "velocity" | "current" | "busVoltage" | "motorVoltage" | "temperature";

interface SeriesDef {
  key: SeriesKey;
  label: string;
  token: keyof ChartTokens;
  dash?: number[];
  right?: boolean;
}

interface PanelDef {
  key: string;
  title: string;
  series: readonly SeriesDef[];
  /** The panel leaves the stack while its series is off. */
  optional?: boolean;
}

const DASH = [6, 4];

const PANELS: readonly PanelDef[] = [
  {
    key: "motion",
    title: "Motion",
    series: [
      { key: "position", label: "Position", token: "series1" },
      { key: "goal", label: "Goal", token: "series1", dash: DASH },
      { key: "velocity", label: "Velocity", token: "series2", right: true },
    ],
  },
  {
    key: "electrical",
    title: "Electrical",
    series: [
      { key: "current", label: "Current", token: "series3" },
      { key: "busVoltage", label: "Bus V", token: "ctx", right: true },
      { key: "motorVoltage", label: "Motor V", token: "ctx", dash: DASH, right: true },
    ],
  },
  {
    key: "temperature",
    title: "Temperature",
    series: [{ key: "temperature", label: "Temperature", token: "series2" }],
    optional: true,
  },
];

const OFF_BY_DEFAULT: readonly SeriesKey[] = ["motorVoltage", "temperature"];
/** Raw mode shows counts for these; the rest stay in real units. */
const RAW_FAMILY: readonly SeriesKey[] = ["position", "goal", "velocity"];

type Shown = Record<SeriesKey, boolean>;
type Row = Record<SeriesKey, number> & { t: number };

function initialShown(): Shown {
  const shown = {} as Shown;
  for (const panel of PANELS) {
    for (const s of panel.series) shown[s.key] = !OFF_BY_DEFAULT.includes(s.key);
  }
  return shown;
}

function convert(s: Sample, { sense, cal, biases }: TelemetryConfig, raw: boolean): Row {
  return {
    t: s.t,
    position: raw ? s.pos : positionDeg(s.pos, cal),
    goal: raw ? s.goal : positionDeg(s.goal, cal),
    velocity: raw ? s.velocity : velocityDegPerS(s.velocity, cal),
    current: currentMa(s.current, biases.currentBiasCounts, sense),
    busVoltage: busV(s.vbus, sense),
    motorVoltage: vdiffV(s.vmotorA, s.vmotorB, sense),
    temperature: temperatureC(s.ntc, sense),
  };
}

/** Rows with `t` relative to the newest sample, which sits at 0. */
function toRows(samples: readonly Sample[], config: TelemetryConfig, raw: boolean): Row[] {
  const last = samples.at(-1);
  if (last === undefined) return [];
  return samples.map((s) => ({ ...convert(s, config, raw), t: s.t - last.t }));
}

function display(key: SeriesKey, raw: boolean): Display {
  if (!raw || !RAW_FAMILY.includes(key)) return DISPLAY[key];
  if (key === "velocity") return { unit: `${DISPLAY.raw.unit}/s`, digits: DISPLAY.raw.digits };
  return DISPLAY.raw;
}

function format(value: number | undefined, d: Display): string {
  return value === undefined || !Number.isFinite(value)
    ? "-"
    : `${value.toFixed(d.digits)} ${d.unit}`;
}

function panelTitle(panel: PanelDef, raw: boolean): string {
  const unitOf = (right: boolean) => {
    const s = panel.series.find((x) => (x.right ?? false) === right);
    return s === undefined ? undefined : display(s.key, raw).unit;
  };
  const right = unitOf(true);
  return `${panel.title} ${unitOf(false) ?? ""}${right === undefined ? "" : ` | ${right}`}`;
}

function panelOptions(panel: PanelDef, shown: Shown, tokens: ChartTokens): ChartOptions {
  const axis = {
    stroke: tokens.label,
    grid: { stroke: tokens.grid, width: 1 },
    ticks: { stroke: tokens.axis, width: 1 },
  };
  // Fixed so the panels' x axes line up whatever their y labels are wide.
  const size = 60;
  const right = panel.series.some((s) => s.right);
  return {
    legend: { show: false },
    cursor: { drag: { x: false, y: false } },
    scales: { x: { time: false, range: [-WINDOW_S, 0] }, y: {}, ...(right ? { r: {} } : {}) },
    axes: [
      axis,
      { ...axis, scale: "y", size },
      ...(right ? [{ ...axis, scale: "r", side: 1, size, grid: { show: false } }] : []),
    ],
    series: [
      {},
      ...panel.series.map((s) => ({
        label: s.label,
        scale: s.right ? "r" : "y",
        stroke: tokens[s.token],
        width: 1.5,
        dash: s.dash,
        show: shown[s.key],
        points: { show: false },
      })),
    ],
  };
}

function LivePage() {
  const { status, selected } = useSession();
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Live</h1>
      {status !== "ready" ? (
        <p>Connect first.</p>
      ) : selected === undefined ? (
        <p>Pick a servo in the left pane.</p>
      ) : (
        <Tabs defaultValue="telemetry">
          <TabsList>
            <TabsTrigger value="telemetry">Telemetry</TabsTrigger>
            <TabsTrigger value="stream">Stream</TabsTrigger>
          </TabsList>
          <TabsContent value="telemetry">
            <Telemetry key={selected} id={selected} />
          </TabsContent>
          <TabsContent value="stream">
            <p className="text-text-3">Stream capture comes later.</p>
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

function Telemetry({ id }: { id: number }) {
  const { client, descriptor, descriptorError } = useSession();
  const [config, setConfig] = useState<TelemetryConfig>();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState<string>();
  const [shown, setShown] = useState(initialShown);
  const [unitsPref, setUnitsPref] = useUnitsPref();
  const tokens = useChartTokens();

  useEffect(() => {
    if (client === undefined || descriptor === undefined) return;
    const ring = new SampleRing(WINDOW_S);
    return startTelemetry({
      fields: descriptor.fields(),
      // Swap for the session's command queue once it lands: read through it,
      // drop inFlight.
      read: inFlight((addr, count) => client.read(id, addr, count)),
      now: () => performance.now() / 1000,
      periodMs: 1000 / POLL_HZ,
      onConfig: setConfig,
      onSample: (s) => {
        ring.push(s);
        setSamples(ring.samples);
      },
      onError: (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      },
    });
  }, [client, descriptor, id]);

  const calibrated = config !== undefined && calibrationStatus(config.cal).valid;
  const raw = !calibrated || unitsPref === "raw";
  const rows = useMemo(
    () => (config === undefined ? [] : toRows(samples, config, raw)),
    [samples, config, raw],
  );
  const latest = rows.at(-1);
  const problem = error ?? descriptorError;

  return (
    <div className="flex items-start gap-4">
      <Card className="min-w-0 flex-1">
        <CardHeader>
          <CardTitle>Telemetry</CardTitle>
          <CardDescription>
            {POLL_HZ} Hz, last {WINDOW_S} s
          </CardDescription>
        </CardHeader>
        <CardContent>
          {problem !== undefined && <p className="mb-2 text-danger">{problem}</p>}
          <div className="relative flex h-[max(60vh,calc(100vh-18rem))] flex-col gap-4">
            {PANELS.filter((p) => !p.optional || p.series.some((s) => shown[s.key])).map(
              (panel) => (
                <Panel
                  key={panel.key}
                  panel={panel}
                  rows={rows}
                  shown={shown}
                  tokens={tokens}
                  raw={raw}
                />
              ),
            )}
            {rows.length === 0 && (
              <p className="absolute inset-0 flex items-center justify-center text-text-3">
                waiting for data
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      <aside className="sticky top-4 w-[300px] shrink-0">
        <Card size="sm">
          <CardContent className="flex flex-col gap-4">
            <section>
              <h3 className="mb-2 text-xs font-medium text-text-3 uppercase">Units</h3>
              <UnitsSegment
                value={raw ? "raw" : "real"}
                disabled={!calibrated}
                onChange={setUnitsPref}
              />
              {config !== undefined && !calibrated && (
                <p className="mt-2 text-sm text-text-3">
                  <Link to="/servo" search={true} className="underline underline-offset-4">
                    Not calibrated - showing counts
                  </Link>
                </p>
              )}
            </section>
            {PANELS.map((panel) => (
              <section key={panel.key} className="border-t pt-3">
                <h3 className="mb-1 text-xs font-medium text-text-3 uppercase">{panel.title}</h3>
                {panel.series.map((s) => (
                  <SeriesRow
                    key={s.key}
                    series={s}
                    checked={shown[s.key]}
                    color={tokens[s.token]}
                    readout={format(latest?.[s.key], display(s.key, raw))}
                    onChange={(checked) => {
                      setShown({ ...shown, [s.key]: checked });
                    }}
                  />
                ))}
              </section>
            ))}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function Panel({
  panel,
  rows,
  shown,
  tokens,
  raw,
}: {
  panel: PanelDef;
  rows: readonly Row[];
  shown: Shown;
  tokens: ChartTokens;
  raw: boolean;
}) {
  const options = useMemo(() => panelOptions(panel, shown, tokens), [panel, shown, tokens]);
  const data = useMemo<uPlot.AlignedData>(
    () => [
      rows.map((r) => r.t),
      ...panel.series.map((s) => rows.map((r) => (Number.isFinite(r[s.key]) ? r[s.key] : null))),
    ],
    [rows, panel],
  );
  const heading = `panel-${panel.key}`;
  return (
    <section aria-labelledby={heading} className="flex min-h-0 flex-1 flex-col">
      <h3 id={heading} className="text-sm font-medium text-text-2">
        {panelTitle(panel, raw)}
      </h3>
      <Chart options={options} data={data} className="min-h-0 flex-1" />
    </section>
  );
}

function UnitsSegment({
  value,
  disabled,
  onChange,
}: {
  value: Units;
  disabled: boolean;
  onChange: (units: Units) => void;
}) {
  const segment = (
    <Tabs
      value={value}
      onValueChange={(v) => {
        if (isUnits(v)) onChange(v);
      }}
    >
      <TabsList className="w-full" aria-label="Units">
        <TabsTrigger value="real" disabled={disabled}>
          Real
        </TabsTrigger>
        <TabsTrigger value="raw" disabled={disabled}>
          Raw
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
  if (!disabled) return segment;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>{segment}</div>
      </TooltipTrigger>
      <TooltipContent>Calibrate the servo first</TooltipContent>
    </Tooltip>
  );
}

function SeriesRow({
  series,
  checked,
  color,
  readout,
  onChange,
}: {
  series: SeriesDef;
  checked: boolean;
  color: string;
  readout: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-7 cursor-pointer items-center gap-2 text-sm">
      <Switch size="sm" aria-label={series.label} checked={checked} onCheckedChange={onChange} />
      <span
        aria-hidden
        className="w-3 shrink-0 border-t-2"
        style={{ borderColor: color, borderStyle: series.dash === undefined ? "solid" : "dashed" }}
      />
      <span>{series.label}</span>
      <span aria-label={`${series.label} value`} className="ml-auto font-mono tabular-nums">
        {readout}
      </span>
    </label>
  );
}
