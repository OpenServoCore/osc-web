import type { Field, Value } from "@openservocore/client";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Pause, Play, TriangleAlert } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type uPlot from "uplot";
import { StreamTab } from "@/components/stream-tab";
import { Chart, type ChartOptions } from "@/components/uplot";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBus, useReadOnce, useRegisters, useRing } from "@/lib/bus/hooks";
import { useChartTokens, type ChartTokens } from "@/lib/chart-theme";
import {
  clampGoal,
  CONTROL_REGISTERS,
  decodeControl,
  dutyPercent,
  goalOf,
  goalSpec,
  goalUnits,
  isWindow,
  LIMIT_REGISTERS,
  limitsFromTable,
  modeLabel,
  modeName,
  WINDOWS_S,
  type GoalRegister,
  type GoalUnits,
  type ModeName,
  type WindowS,
} from "@/lib/control";
import { isUnits, type Units } from "@/lib/prefs";
import { useSession } from "@/lib/session";
import {
  BIAS_REGISTERS,
  CONFIG_REGISTERS,
  configFrom,
  decodeSample,
  POLL_HZ,
  SAMPLE_REGISTERS,
  type Sample,
  type TelemetryConfig,
} from "@/lib/telemetry";
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
/** The ring keeps the longest window, so a shorter one is a view over the same samples. */
const RING_S: WindowS = 30;
/** One read behind every conversion the panels and the goal units need. */
const CONVERSION_REGISTERS: readonly string[] = [...CONFIG_REGISTERS, ...BIAS_REGISTERS];
/** Inside the sample span, so the mode costs no exchange of its own. */
const MODE_REGISTERS: readonly string[] = ["mode"];

const POSITION: SeriesDef = { key: "position", label: "Position", token: "series1" };
const VELOCITY: SeriesDef = { key: "velocity", label: "Velocity", token: "series2", right: true };
const CURRENT: SeriesDef = { key: "current", label: "Current", token: "series3" };
const BUS_V: SeriesDef = { key: "busVoltage", label: "Bus V", token: "ctx", right: true };
const MOTOR_V: SeriesDef = {
  key: "motorVoltage",
  label: "Motor V",
  token: "ctx",
  dash: DASH,
  right: true,
};
const TEMPERATURE: SeriesDef = { key: "temperature", label: "Temperature", token: "series2" };

/**
 * The dashed goal sits with the series it is the setpoint of, in that series'
 * hue: nowhere in open loop, which has no duty axis.
 */
function panelsFor(mode: ModeName | undefined): PanelDef[] {
  const goal = (of: SeriesDef): SeriesDef => ({ ...of, key: "goal", label: "Goal", dash: DASH });
  return [
    {
      key: "motion",
      title: "Motion",
      series: [
        POSITION,
        ...(mode === "Position" ? [goal(POSITION)] : []),
        VELOCITY,
        ...(mode === "Velocity" ? [goal(VELOCITY)] : []),
      ],
    },
    {
      key: "electrical",
      title: "Electrical",
      series: [CURRENT, ...(mode === "Current" ? [goal(CURRENT)] : []), BUS_V, MOTOR_V],
    },
    { key: "temperature", title: "Temperature", series: [TEMPERATURE], optional: true },
  ];
}

const OFF_BY_DEFAULT: readonly SeriesKey[] = ["motorVoltage", "temperature"];
/** Raw mode shows counts for these; the rest stay in real units. */
const RAW_FAMILY: readonly SeriesKey[] = ["position", "goal", "velocity"];

type Shown = Record<SeriesKey, boolean>;
type Row = Record<SeriesKey, number> & { t: number };

function initialShown(): Shown {
  const shown = {} as Shown;
  for (const panel of panelsFor("Position")) {
    for (const s of panel.series) shown[s.key] = !OFF_BY_DEFAULT.includes(s.key);
  }
  return shown;
}

function convert(
  s: Sample,
  { sense, cal, biases }: TelemetryConfig,
  raw: boolean,
  goal: GoalUnits | undefined,
): Row {
  return {
    t: s.t,
    position: raw ? s.pos : positionDeg(s.pos, cal),
    goal: goal === undefined ? NaN : goal.toDisplay(goalOf(s, goal.register)),
    velocity: raw ? s.velocity : velocityDegPerS(s.velocity, cal),
    current: currentMa(s.current, biases.currentBiasCounts, sense),
    busVoltage: busV(s.vbus, sense),
    motorVoltage: vdiffV(s.vmotorA, s.vmotorB, sense),
    temperature: temperatureC(s.ntc, sense),
  };
}

/** The last `windowS` seconds as rows with `t` relative to the newest sample, which sits at 0. */
function toRows(
  samples: readonly Sample[],
  config: TelemetryConfig,
  raw: boolean,
  goal: GoalUnits | undefined,
  windowS: number,
): Row[] {
  const last = samples.at(-1);
  if (last === undefined) return [];
  return samples
    .filter((s) => s.t >= last.t - windowS)
    .map((s) => ({ ...convert(s, config, raw, goal), t: s.t - last.t }));
}

function display(key: SeriesKey, raw: boolean, goal: GoalUnits | undefined): Display {
  if (key === "goal" && goal !== undefined) return { unit: goal.unit, digits: goal.digits };
  if (!raw || !RAW_FAMILY.includes(key)) return DISPLAY[key];
  if (key === "velocity") return { unit: `${DISPLAY.raw.unit}/s`, digits: DISPLAY.raw.digits };
  return DISPLAY.raw;
}

function format(value: number | undefined, d: Display): string {
  return value === undefined || !Number.isFinite(value)
    ? "-"
    : `${value.toFixed(d.digits)} ${d.unit}`;
}

function panelTitle(panel: PanelDef, raw: boolean, goal: GoalUnits | undefined): string {
  const unitOf = (right: boolean) => {
    const s = panel.series.find((x) => (x.right ?? false) === right);
    return s === undefined ? undefined : display(s.key, raw, goal).unit;
  };
  const right = unitOf(true);
  return `${panel.title} ${unitOf(false) ?? ""}${right === undefined ? "" : ` | ${right}`}`;
}

function panelOptions(
  panel: PanelDef,
  shown: Shown,
  tokens: ChartTokens,
  windowS: number,
): ChartOptions {
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
    scales: { x: { time: false, range: [-windowS, 0] }, y: {}, ...(right ? { r: {} } : {}) },
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

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
            <StreamTab key={selected} id={selected} />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

function Telemetry({ id }: { id: number }) {
  const { descriptor, descriptorError } = useSession();
  const snapshots = useRing(id, SAMPLE_REGISTERS, "fast", RING_S);
  const conversion = useReadOnce(id, CONVERSION_REGISTERS, [descriptor]);
  const modeSnapshot = useRegisters(id, MODE_REGISTERS, "fast");
  /** The samples on screen while paused; the subscription keeps filling the ring behind them. */
  const [frozen, setFrozen] = useState<Sample[]>();
  const [windowS, setWindowS] = useState<WindowS>(RING_S);
  const [shown, setShown] = useState(initialShown);
  const [unitsPref, setUnitsPref] = useUnitsPref();
  const tokens = useChartTokens();

  const config = useMemo(
    () => (conversion.snapshot === undefined ? undefined : configFrom(conversion.snapshot.read)),
    [conversion.snapshot],
  );
  const samples = useMemo(
    () => snapshots.filter((s) => !s.stale).map((s) => decodeSample(s.read, s.t)),
    [snapshots],
  );
  const calibrated = config !== undefined && calibrationStatus(config.cal).valid;
  const raw = !calibrated || unitsPref === "raw";
  const shownSamples = frozen ?? samples;
  const latestSample = shownSamples.at(-1);
  const modeField = useMemo(
    () => descriptor?.fields().find((f) => f.name === "mode"),
    [descriptor],
  );
  // The mode register as read back, not mode_active: the servo republishes
  // mode_active from it within one slow tick, and the simulated fleet never
  // runs the kernel that would.
  const mode =
    modeField === undefined || modeSnapshot === undefined || modeSnapshot.stale
      ? undefined
      : modeName(modeField.variants, modeSnapshot.read("mode"));
  const active =
    modeField === undefined || latestSample === undefined
      ? undefined
      : modeName(modeField.variants, latestSample.modeActive);
  const goal = useMemo(
    () =>
      mode === undefined || config === undefined
        ? undefined
        : goalUnits(mode, { cal: config.cal, sense: config.sense, raw }),
    [mode, config, raw],
  );
  const panels = useMemo(() => panelsFor(mode), [mode]);
  const rows = useMemo(
    () => (config === undefined ? [] : toRows(shownSamples, config, raw, goal, windowS)),
    [shownSamples, config, raw, goal, windowS],
  );
  const newest = snapshots.at(-1);
  const latest = rows.at(-1);
  const problem =
    (descriptor === undefined ? undefined : conversion.error) ??
    (newest?.stale === true ? newest.error : undefined) ??
    descriptorError;
  const windowId = useId();

  return (
    <div className="flex items-start gap-4">
      <Card className="min-w-0 flex-1">
        <CardHeader>
          <CardTitle>Telemetry</CardTitle>
          <CardDescription className="flex items-center gap-2">
            <Label htmlFor={windowId} className="font-normal text-text-3">
              {POLL_HZ} Hz, last
            </Label>
            <Select
              value={String(windowS)}
              onValueChange={(v) => {
                const w = Number(v);
                if (isWindow(w)) setWindowS(w);
              }}
            >
              <SelectTrigger id={windowId} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS_S.map((w) => (
                  <SelectItem key={w} value={String(w)}>
                    {w} s
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              aria-pressed={frozen !== undefined}
              onClick={() => {
                setFrozen(frozen === undefined ? samples : undefined);
              }}
            >
              {frozen === undefined ? <Pause /> : <Play />}
              {frozen === undefined ? "Pause" : "Resume"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {problem !== undefined && <p className="mb-2 text-danger">{problem}</p>}
          <div className="relative flex h-[max(60vh,calc(100vh-18rem))] flex-col gap-4">
            {panels
              .filter((p) => !p.optional || p.series.some((s) => shown[s.key]))
              .map((panel) => (
                <Panel
                  key={panel.key}
                  panel={panel}
                  rows={rows}
                  shown={shown}
                  tokens={tokens}
                  windowS={windowS}
                  title={panelTitle(panel, raw, goal)}
                />
              ))}
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
            {config !== undefined && (
              <Controls
                id={id}
                modeField={modeField}
                config={config}
                raw={raw}
                mode={mode}
                active={active}
                latest={latestSample}
              />
            )}
            <section className="border-t pt-3">
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
            {panels.map((panel) => (
              <section key={panel.key} className="border-t pt-3">
                <h3 className="mb-1 text-xs font-medium text-text-3 uppercase">{panel.title}</h3>
                {panel.series.map((s) => (
                  <SeriesRow
                    key={s.key}
                    series={s}
                    checked={shown[s.key]}
                    color={tokens[s.token]}
                    readout={format(latest?.[s.key], display(s.key, raw, goal))}
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
  windowS,
  title,
}: {
  panel: PanelDef;
  rows: readonly Row[];
  shown: Shown;
  tokens: ChartTokens;
  windowS: number;
  title: string;
}) {
  const options = useMemo(
    () => panelOptions(panel, shown, tokens, windowS),
    [panel, shown, tokens, windowS],
  );
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
        {title}
      </h3>
      <Chart options={options} data={data} className="min-h-0 flex-1" />
    </section>
  );
}

/** The slider's own goal while a burst of writes is out; the servo's goal otherwise. */
interface Draft {
  register: GoalRegister;
  counts: number;
  /** The snapshot seq the burst's last write acked past; unset while writes are out. */
  until?: number;
}

function Controls({
  id,
  modeField,
  config,
  raw,
  mode,
  active,
  latest,
}: {
  id: number;
  modeField: Field | undefined;
  config: TelemetryConfig;
  raw: boolean;
  mode: ModeName | undefined;
  /** What the servo reports running, from the newest sample on screen. */
  active: ModeName | undefined;
  latest: Sample | undefined;
}) {
  const bus = useBus();
  const snapshot = useRegisters(id, CONTROL_REGISTERS, "fast");
  const limitRead = useReadOnce(id, LIMIT_REGISTERS, [modeField]);
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState<string>();
  const writes = useRef(0);
  const seen = useRef(0);
  const modeId = useId();
  const torqueId = useId();
  const goalId = useId();

  const state = snapshot === undefined || snapshot.stale ? undefined : decodeControl(snapshot.read);
  useEffect(() => {
    if (snapshot !== undefined) seen.current = snapshot.seq;
  }, [snapshot]);
  // The draft outlives the burst that wrote it: it clears on the first snapshot
  // the servo answered past the last write, so a drag never snaps back mid-way.
  if (draft?.until !== undefined && snapshot !== undefined && snapshot.seq > draft.until) {
    setDraft(undefined);
  }

  const limits = useMemo(
    () => (limitRead.snapshot === undefined ? undefined : limitsFromTable(limitRead.snapshot.read)),
    [limitRead.snapshot],
  );

  const write = (register: string, value: Value) => {
    bus.write(id, register, value).then(
      () => {
        setError(undefined);
      },
      (e: unknown) => {
        setError(message(e));
      },
    );
  };

  const spec =
    mode === undefined || limits === undefined
      ? undefined
      : goalSpec(mode, { cal: config.cal, sense: config.sense, limits, raw });
  const counts =
    spec === undefined || state === undefined
      ? undefined
      : draft?.register === spec.register
        ? draft.counts
        : state.goals[spec.register];

  const setGoal = (next: number) => {
    if (spec === undefined) return;
    const clamped = clampGoal(next, spec.range);
    setDraft({ register: spec.register, counts: clamped });
    writes.current++;
    bus.write(id, spec.register, { kind: "int", value: clamped }).then(
      () => {
        setError(undefined);
        if (--writes.current > 0) return;
        const until = seen.current;
        setDraft((d) => (d === undefined ? d : { ...d, until }));
      },
      (e: unknown) => {
        setError(message(e));
        if (--writes.current === 0) setDraft(undefined);
      },
    );
  };

  const fmt = (c: number) => (spec === undefined ? "" : spec.toDisplay(c).toFixed(spec.digits));
  const problem = error ?? limitRead.error;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Label htmlFor={modeId} className="w-14">
          Mode
        </Label>
        <Select
          value={state === undefined ? "" : String(state.mode)}
          onValueChange={(v) => {
            write("mode", { kind: "enum", value: Number(v) });
          }}
        >
          <SelectTrigger id={modeId} className="flex-1" disabled={state === undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(modeField?.variants ?? []).map((v) => {
              const name = modeName([v], v.value);
              return (
                <SelectItem key={v.value} value={String(v.value)}>
                  {name === undefined ? v.name : modeLabel(name)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
      {active !== undefined && mode !== undefined && active !== mode && (
        <p className="text-sm text-text-3">running {modeLabel(active)}</p>
      )}
      {mode === "OpenLoop" && (
        <Alert className="border-warning bg-warning-soft text-warning">
          <TriangleAlert />
          <AlertTitle>Open loop can strip the gears or overheat the motor</AlertTitle>
          <AlertDescription className="text-warning">
            The duty goes straight to the bridge, so the current limit does not cap it and a stall
            is never timed out.
          </AlertDescription>
        </Alert>
      )}
      {spec !== undefined && counts !== undefined && (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-2xl tabular-nums" aria-label="Goal readout">
            {fmt(counts)} <span className="text-base text-text-3">{spec.unit}</span>
          </p>
          <Slider
            aria-label="Goal"
            min={spec.range.min}
            max={spec.range.max}
            step={1}
            value={[counts]}
            onValueChange={([v]) => {
              if (v !== undefined) setGoal(v);
            }}
          />
          <div className="flex justify-between text-xs text-text-3 tabular-nums">
            <span>{fmt(spec.range.min)}</span>
            <span>{fmt(spec.range.max)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={goalId} className="w-14">
              Goal
            </Label>
            <GoalInput
              id={goalId}
              value={fmt(counts)}
              min={fmt(spec.range.min)}
              max={fmt(spec.range.max)}
              step={10 ** -spec.digits}
              unit={spec.unit}
              onCommit={(v) => {
                setGoal(spec.fromDisplay(v));
              }}
            />
          </div>
        </div>
      )}
      {mode === "OpenLoop" && latest !== undefined && (
        <dl className="grid grid-cols-[1fr_auto] gap-x-2 text-sm">
          <dt>Commanded duty</dt>
          <dd aria-label="Commanded duty value" className="font-mono tabular-nums">
            {dutyPercent(latest.goalDuty).toFixed(1)} %
          </dd>
          <dt>Applied duty</dt>
          <dd aria-label="Applied duty value" className="font-mono tabular-nums">
            {dutyPercent(latest.dutyApplied).toFixed(1)} %
          </dd>
        </dl>
      )}
      <div className="flex items-center gap-2">
        <Label htmlFor={torqueId} className="w-14">
          Torque
        </Label>
        <Switch
          id={torqueId}
          checked={state?.torque ?? false}
          disabled={state === undefined}
          onCheckedChange={(on) => {
            write("torque_enable", { kind: "bool", value: on });
          }}
        />
        <span className="font-mono text-xs text-text-3">torque_enable</span>
      </div>
      {problem !== undefined && <p className="text-sm text-danger">{problem}</p>}
    </section>
  );
}

/** Commits on Enter or blur, so a half-typed number never reaches the servo. */
function GoalInput({
  id,
  value,
  min,
  max,
  step,
  unit,
  onCommit,
}: {
  id: string;
  value: string;
  min: string;
  max: string;
  step: number;
  unit: string;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(value);
  // Follows the slider and the servo's read-back; a new value replaces what was typed.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n) && text !== value) onCommit(n);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
  };
  return (
    <>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        className="flex-1 font-mono tabular-nums"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <span className="text-sm text-text-3">{unit}</span>
    </>
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
