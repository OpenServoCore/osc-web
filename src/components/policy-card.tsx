import type { ServoProfile, TuningPolicy } from "@openservocore/client";
import { CircleQuestionMark, Download } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  InputEditor,
  ValueButton,
  type EditorField,
  type Values,
  type Verdict,
} from "@/components/input-editor";
import { Badge } from "@/components/ui/badge";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { unitSymbol, withUnit } from "@/lib/format";
import {
  accelOf,
  formOf,
  moveSpeedFixed,
  moveSpeedShare,
  num,
  parseShare,
  portability,
  previewOf,
  retiredSoftMargin,
  shareText,
  SOFT_TRAVEL,
  SOFT_TRAVEL_HINT,
  speedUpOf,
  valueAt,
  WARN,
  withSoftTravel,
  withValue,
} from "@/lib/policy-form";
import { HEAT_FIELDS, parseNumber } from "@/lib/profile-form";

interface Ctx {
  policy: TuningPolicy;
  profile: ServoProfile | undefined;
  rOhm: number | undefined;
  /** Undefined for the built-in Default, which is read-only. */
  save: ((next: TuningPolicy) => Promise<void>) | undefined;
}

const KEPT = "not set: the servo keeps its own";
const BY_RUN = "set by the run";

function plastic(profile: ServoProfile | undefined): boolean {
  return profile !== undefined && profile.gear_class !== "metal";
}

export function PolicyCard({
  policy,
  builtIn,
  profile,
  rOhm,
  head,
  onSave,
  onExport,
}: {
  policy: TuningPolicy;
  builtIn: boolean;
  profile: ServoProfile | undefined;
  rOhm: number | undefined;
  head: ReactNode;
  onSave: (next: TuningPolicy) => Promise<unknown>;
  onExport: (() => void) | undefined;
}) {
  const [all, setAll] = useState(false);
  const ctx: Ctx = {
    policy,
    profile,
    rOhm,
    save: builtIn
      ? undefined
      : async (next) => {
          await onSave(next);
        },
  };
  const pv = previewOf(policy, profile, rOhm);
  const why = (path: string) => (all ? policy.why?.[path] : undefined);
  const p = policy.protection ?? {};
  const v = pv.preview?.values;
  const line = (field: string) => pv.preview?.report.fields.find((l) => l.field === field);
  const heat = HEAT_FIELDS.flatMap((f) => {
    const l = line(`thermal.${f.id}`);
    return l === undefined ? [] : [{ ...f, line: l }];
  });
  const at = profile === undefined ? "" : ` with ${profile.key}`;

  const yieldRow = (
    <Row label="Max yield torque" why={why("protection.yield")}>
      <YieldValue ctx={ctx} />
    </Row>
  );
  const plasticRow = plastic(profile) && (
    <Row label="Plastic torque limit" note={WARN.plasticOver}>
      <Editable
        ctx={ctx}
        title="Plastic torque limit"
        shown={
          p.plastic_torque_limit_kg_cm == null
            ? "not known yet"
            : `${num(p.plastic_torque_limit_kg_cm)} kg cm`
        }
        fields={[{ id: "v", label: "Plastic torque limit", unit: "kg cm" }]}
        initial={{
          v: p.plastic_torque_limit_kg_cm == null ? "" : String(p.plastic_torque_limit_kg_cm),
        }}
        apply={(vals) => numberAt(ctx.policy, "protection.plastic_torque_limit_kg_cm", vals.v)}
      />
      <label className="ml-4 flex items-center gap-2 text-sm">
        <Checkbox
          checked={p.above_plastic_limit === true}
          disabled={ctx.save === undefined}
          onCheckedChange={(checked) =>
            void ctx.save?.(withValue(policy, "protection.above_plastic_limit", checked === true))
          }
        />
        Go above the plastic limit
      </label>
    </Row>
  );
  const moveRow = (
    <Row
      label="Move speed"
      resolved={v?.velocity_limit_deg_s == null ? undefined : `= ${num(v.velocity_limit_deg_s)}°/s`}
      note={line("motion.move_speed")?.clamp}
      why={why("motion.move_speed")}
    >
      <Dual
        ctx={ctx}
        title="Move speed"
        path="motion.move_speed"
        convert={(to, amount) => {
          const ceiling = pv.preview?.speedCeilingDegS;
          if (ceiling === undefined) return undefined;
          return to === "deg_s" ? moveSpeedFixed(amount, ceiling) : moveSpeedShare(amount, ceiling);
        }}
        portable={{ tag: "share_of_ceiling", label: "Share", unit: "of the ceiling" }}
        fixed={{ tag: "deg_s", label: "Fixed", unit: "deg/s" }}
        shown={(f) =>
          f.tag === "share_of_ceiling"
            ? `${num(f.amount ?? 0)} of the ceiling`
            : `${num(f.amount ?? 0)}°/s`
        }
        resolved={(q) => {
          const r = previewOf(q, profile, rOhm).preview;
          const clamp = r?.report.fields.find((l) => l.field === "motion.move_speed")?.clamp;
          return r?.values.velocity_limit_deg_s == null
            ? {}
            : {
                preview: `= ${num(r.values.velocity_limit_deg_s)}°/s${at}`,
                warning: clamp,
              };
        }}
      />
    </Row>
  );
  const speedUpRow = (
    <Row
      label="Speed-up time"
      resolved={v?.accel_limit_deg_s2 == null ? undefined : `= ${num(v.accel_limit_deg_s2)}°/s²`}
      why={why("motion.speed_up")}
    >
      <Dual
        ctx={ctx}
        title="Speed-up time"
        path="motion.speed_up"
        convert={(to, amount) => {
          const move = v?.velocity_limit_deg_s;
          if (move == null) return undefined;
          return to === "deg_s2" ? accelOf(move, amount) : speedUpOf(move, amount);
        }}
        portable={{ tag: "s", label: "Time", unit: "s to the move speed" }}
        fixed={{ tag: "deg_s2", label: "Fixed", unit: "deg/s^2" }}
        shown={(f) => (f.tag === "s" ? `${num(f.amount ?? 0)} s` : `${num(f.amount ?? 0)}°/s²`)}
        resolved={(q) => {
          const r = previewOf(q, profile, rOhm);
          if (r.refusal !== undefined) return { error: r.refusal };
          const a = r.preview?.values.accel_limit_deg_s2;
          return a == null ? {} : { preview: `= ${num(a)}°/s²${at}` };
        }}
      />
    </Row>
  );
  const cutoffRow = (
    <Row label="Heat cutoff" why={why("protection.cutoff_c")}>
      <NumberValue
        ctx={ctx}
        title="Heat cutoff"
        path="protection.cutoff_c"
        unit="C"
        warn={(n) => (n > 90 ? WARN.cutoff : undefined)}
      />
    </Row>
  );
  const runRow = (
    <Row
      label="Runs on"
      resolved={
        pv.preview === undefined
          ? undefined
          : `picks the ${num(pv.preview.speedCeilingAtV)} V rating`
      }
      why={why("protection.run_v")}
    >
      <NumberValue
        ctx={ctx}
        title="Runs on"
        path="protection.run_v"
        unit="V"
        warn={(n) => {
          const op = profile?.operating_v;
          return op != null && n > op.max ? WARN.runV : undefined;
        }}
      />
    </Row>
  );

  return (
    <Card role="region" aria-label="Policy">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {policy.label === undefined || policy.label === "" ? policy.key : policy.label}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="About tuning policies">
                <CircleQuestionMark />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start">
              A policy holds every choice of how to run a servo: protections, motion and loop
              targets. A value stated as a share resolves on any servo; a fixed value ties the
              policy to one.
            </PopoverContent>
          </Popover>
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          {policy.key}
          {builtIn ? " . built in, copy to edit" : ` . revision ${policy.revision ?? 0}`}
        </CardDescription>
        <CardAction>
          <Badge variant="outline">{portability(policy)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {head}
        {pv.refusal !== undefined && <p className="text-sm text-warning">{pv.refusal}</p>}
        {!all ? (
          <Section title="At a glance">
            {moveRow}
            {speedUpRow}
            {yieldRow}
            {plasticRow}
            {cutoffRow}
            {runRow}
          </Section>
        ) : (
          <>
            <Section title="Protection">
              {runRow}
              <Row
                label="Speed ceiling"
                resolved={
                  pv.preview === undefined
                    ? undefined
                    : `= ${num(Math.round(pv.preview.speedCeilingDegS))}°/s`
                }
                why={why("protection.speed_ceiling")}
              >
                <SpeedCeiling ctx={ctx} />
              </Row>
              <Row
                label="Current limit"
                resolved={
                  pv.preview === undefined || rOhm === undefined
                    ? BY_RUN
                    : `= ${pv.preview.currentLimitA.toFixed(2)} A at ${num(rOhm)} Ω, ${BY_RUN}`
                }
                why={why("protection.current_limit")}
              >
                <Editable
                  ctx={ctx}
                  title="Current limit"
                  shown={
                    p.current_limit == null
                      ? KEPT
                      : `${num(p.current_limit.share_of_stall)} of the stall current`
                  }
                  fields={[{ id: "v", label: "Share of the stall current", unit: "of V / R" }]}
                  initial={{
                    v: p.current_limit == null ? "" : String(p.current_limit.share_of_stall),
                  }}
                  apply={(vals) => {
                    const n = parseNumber(vals.v ?? "");
                    if ("error" in n) return n;
                    return withValue(
                      ctx.policy,
                      "protection.current_limit",
                      n.value === null ? null : { share_of_stall: n.value },
                    );
                  }}
                  warn={(q) => {
                    const s = q.protection?.current_limit?.share_of_stall;
                    return s !== undefined && s > 0.8 ? WARN.currentLimit : undefined;
                  }}
                />
              </Row>
              {yieldRow}
              {plasticRow}
              <Row
                label="Stall release"
                resolved={pv.byRun.has("protection.stall_release") ? BY_RUN : undefined}
                why={why("protection.stall_release")}
              >
                <Dual
                  ctx={ctx}
                  title="Stall release"
                  path="protection.stall_release"
                  portable={{ tag: "share_of_yield", label: "Share", unit: "of the yield current" }}
                  fixed={{ tag: "ma", label: "Fixed", unit: "mA" }}
                  shown={(f) =>
                    f.tag === "ma"
                      ? `${num(f.amount ?? 0)} mA`
                      : `${num(f.amount ?? 0)} of the yield current${plastic(profile) ? "" : " (of the cap on metal: inert with no fold)"}`
                  }
                  resolved={(q) => {
                    const f = formOf(q.protection?.stall_release);
                    return f?.tag === "share_of_yield" && (f.amount ?? 0) > 0.36
                      ? { warning: WARN.stallRelease }
                      : {};
                  }}
                />
              </Row>
              <Row label="Stall response" why={why("protection.stall_response")}>
                <Choice
                  ctx={ctx}
                  title="Stall response"
                  path="protection.stall_response"
                  options={[
                    { value: "yield", label: "Back off (yield)" },
                    { value: "fault", label: "Torque off (fault)" },
                  ]}
                  describe={(o) =>
                    o === "fault" ? WARN.stallFault : o === "yield" ? WARN.stallYield : undefined
                  }
                />
              </Row>
              <Row label="Stall time" why={why("protection.stall_time_ms")}>
                <NumberValue
                  ctx={ctx}
                  title="Stall time"
                  path="protection.stall_time_ms"
                  unit="ms"
                  warn={(n) => (n > 500 ? WARN.stallTime : undefined)}
                />
              </Row>
              <Row
                label="Stall speed"
                resolved={pv.byRun.has("protection.stall_speed") ? BY_RUN : undefined}
                why={why("protection.stall_speed")}
              >
                <Dual
                  ctx={ctx}
                  title="Stall speed"
                  path="protection.stall_speed"
                  portable={{
                    tag: "multiple_of_still_speed",
                    label: "Multiple",
                    unit: "x the still-shaft speed",
                  }}
                  fixed={{ tag: "deg_s", label: "Fixed", unit: "deg/s" }}
                  shown={(f) =>
                    f.tag === "deg_s"
                      ? `${num(f.amount ?? 0)}°/s`
                      : `${num(f.amount ?? 0)}× the still-shaft speed`
                  }
                  resolved={(q) => {
                    const f = formOf(q.protection?.stall_speed);
                    if (f?.tag !== "multiple_of_still_speed" || f.amount === null) return {};
                    if (f.amount < 4) return { warning: WARN.stallSpeedLow };
                    return f.amount > 4 ? { preview: WARN.stallSpeedHigh } : {};
                  }}
                />
              </Row>
              {cutoffRow}
              <Row label="Position error" why={why("protection.position_error")}>
                <PositionError ctx={ctx} />
              </Row>
              <Row label="Duty cap" why={why("protection.duty_max_share")}>
                <NumberValue
                  ctx={ctx}
                  title="Duty cap"
                  path="protection.duty_max_share"
                  unit="of the rail"
                />
              </Row>
              <Row
                label="Collision trip"
                note={WARN.collision}
                noteTone="grey"
                why={why("protection.collision_trip")}
              >
                <span className="px-1 font-mono">{p.collision_trip === "on" ? "On" : "Off"}</span>
              </Row>
            </Section>
            <Section title="Motion">
              {moveRow}
              {speedUpRow}
              <Row
                label="Soft travel"
                note={retiredSoftMargin(policy) ?? SOFT_TRAVEL_HINT}
                noteTone={retiredSoftMargin(policy) === undefined ? "grey" : "warning"}
                why={why(SOFT_TRAVEL)}
              >
                <SoftTravel ctx={ctx} />
              </Row>
              <Row label="Angle at the CW stop" why={why("motion.angle_cw_stop_deg")}>
                <NumberValue
                  ctx={ctx}
                  title="Angle at the CW stop"
                  path="motion.angle_cw_stop_deg"
                  unit="deg"
                />
              </Row>
            </Section>
            <Section title="Tuning targets">
              <Row
                label="Current loop"
                resolved={pv.byRun.has("loops.current_loop") ? BY_RUN : undefined}
                why={why("loops.current_loop")}
              >
                <Dual
                  ctx={ctx}
                  title="Current loop"
                  path="loops.current_loop"
                  portable={{
                    tag: "multiple_of_electrical_corner",
                    label: "Multiple",
                    unit: "x the electrical corner",
                  }}
                  fixed={{ tag: "hz", label: "Fixed", unit: "Hz" }}
                  shown={(f) =>
                    f.tag === "hz"
                      ? `${num(f.amount ?? 0)} Hz`
                      : `${num(f.amount ?? 0)}× the electrical corner`
                  }
                  resolved={() => ({ preview: WARN.loopRate })}
                />
              </Row>
              <Row
                label="Observer"
                resolved={pv.byRun.has("loops.observer") ? BY_RUN : undefined}
                why={why("loops.observer")}
              >
                <Dual
                  ctx={ctx}
                  title="Observer"
                  path="loops.observer"
                  portable={{
                    tag: "multiple_of_mechanical_corner",
                    label: "Multiple",
                    unit: "x the mechanical corner",
                  }}
                  fixed={{ tag: "hz", label: "Fixed", unit: "Hz" }}
                  shown={(f) =>
                    f.tag === "hz"
                      ? `${num(f.amount ?? 0)} Hz`
                      : `${num(f.amount ?? 0)}× the mechanical corner`
                  }
                  resolved={() => ({ preview: WARN.loopRate })}
                />
              </Row>
              {(
                [
                  ["Speed loop lag ratio", "loops.velocity_em_ratio", ""],
                  ["Speed loop zero ratio", "loops.velocity_zero_ratio", ""],
                  ["Speed loop shelf margin", "loops.velocity_shelf_margin_db", "dB"],
                  ["Position split", "loops.position_split", ""],
                  ["Hold band", "loops.hold_band_noise_multiple", "x the noise"],
                  ["Hold band floor", "loops.hold_band_floor_counts", "counts"],
                ] as const
              ).map(([label, path, unit]) => (
                <Row key={path} label={label} why={why(path)}>
                  <NumberValue ctx={ctx} title={label} path={path} unit={unit} />
                </Row>
              ))}
            </Section>
            <Section title="Sensor checks">
              <Row
                label="Pot jump"
                resolved={pv.byRun.has("sensor.pot_jump") ? BY_RUN : undefined}
                why={why("sensor.pot_jump")}
              >
                <Dual
                  ctx={ctx}
                  title="Pot jump"
                  path="sensor.pot_jump"
                  portable={{
                    tag: "multiple_of_step4",
                    label: "Multiple",
                    unit: "x the pot's noise while driving",
                  }}
                  fixed={{ tag: "counts", label: "Fixed", unit: "counts" }}
                  shown={(f) =>
                    f.tag === "counts"
                      ? `${num(f.amount ?? 0)} counts`
                      : `${num(f.amount ?? 0)}× the pot's noise while driving`
                  }
                  resolved={(q) => {
                    const f = formOf(q.sensor?.pot_jump);
                    return f?.tag === "multiple_of_step4" && (f.amount ?? 0) > 4
                      ? { warning: WARN.potJump }
                      : {};
                  }}
                />
              </Row>
              <Row label="Bad samples" why={why("sensor.bad_samples")}>
                <NumberValue
                  ctx={ctx}
                  title="Bad samples"
                  path="sensor.bad_samples"
                  unit="in a row"
                  warn={(n) => (n > 4 ? WARN.potJump : undefined)}
                />
              </Row>
            </Section>
            <Section title="Behavior">
              <Row label="Zero duty brakes in open loop" why={why("behavior.openloop_zero_brake")}>
                <Choice
                  ctx={ctx}
                  title="Zero duty brakes in open loop"
                  path="behavior.openloop_zero_brake"
                  options={SWITCH}
                />
              </Row>
              <Row label="Brush term" why={why("behavior.brush_term")}>
                <Choice ctx={ctx} title="Brush term" path="behavior.brush_term" options={SWITCH} />
              </Row>
            </Section>
            {heat.length > 0 && (
              <Section title="Heat model">
                {heat.map((h) => (
                  <Row key={h.id} label={h.label} note={h.line.note} noteTone="grey">
                    <span className="px-1 font-mono">
                      {withUnit(
                        typeof h.line.value === "number" ? num(h.line.value) : "",
                        h.line.unit,
                      )}
                    </span>
                    <span className="font-mono text-sm text-text-3">{h.line.form}</span>
                  </Row>
                ))}
              </Section>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          {onExport !== undefined && (
            <Button variant="outline" size="sm" onClick={onExport}>
              <Download />
              Export
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAll(!all);
            }}
          >
            {all ? "Show less" : "Show all"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const SWITCH = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0"
    >
      <h3 className="text-xs font-medium tracking-wide text-text-3 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Row({
  label,
  resolved,
  note,
  noteTone = "warning",
  why,
  children,
}: {
  label: string;
  resolved?: string;
  note?: string;
  noteTone?: "warning" | "grey";
  why?: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="w-52 text-sm">{label}</span>
        {children}
        {resolved !== undefined && (
          <span className="font-mono text-sm text-text-3">{resolved}</span>
        )}
      </div>
      {note !== undefined && (
        <p className={noteTone === "grey" ? "text-xs text-text-3" : "text-xs text-warning"}>
          {note}
        </p>
      )}
      {why !== undefined && (
        <p className="line-clamp-2 text-xs text-text-3" title={why}>
          {why}
        </p>
      )}
    </div>
  );
}

/** A value the user changes through the editor, or plain text on the read-only Default. */
function Editable({
  ctx,
  title,
  shown,
  fields,
  initial,
  apply,
  warn,
  describe,
  head,
}: {
  ctx: Ctx;
  title: string;
  shown: string;
  fields: readonly EditorField[];
  initial: Values;
  apply: (values: Values) => TuningPolicy | { error: string };
  warn?: (candidate: TuningPolicy) => string | undefined;
  describe?: (candidate: TuningPolicy, values: Values) => Verdict;
  head?: (values: Values, set: (next: Values) => void) => ReactNode;
}) {
  const save = ctx.save;
  if (save === undefined) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="px-1 font-mono">{shown}</span>
        </TooltipTrigger>
        <TooltipContent>Default is built in: copy it to edit</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <InputEditor
      title={title}
      current={shown}
      fields={fields}
      initial={() => initial}
      head={head}
      check={(values) => {
        const q = apply(values);
        if ("error" in q) return { error: q.error };
        const d = describe?.(q, values) ?? {};
        return { ...d, warning: d.warning ?? warn?.(q) };
      }}
      onSave={async (values) => {
        const q = apply(values);
        if (!("error" in q)) await save(q);
      }}
    >
      <ValueButton>{shown}</ValueButton>
    </InputEditor>
  );
}

function numberAt(policy: TuningPolicy, path: string, text: string | undefined) {
  const n = parseNumber(text ?? "");
  return "error" in n ? n : withValue(policy, path, n.value);
}

function SoftTravel({ ctx }: { ctx: Ctx }) {
  const v = valueAt(ctx.policy, SOFT_TRAVEL);
  const rated = ctx.profile?.rated_travel_deg;
  const shown =
    typeof v === "number"
      ? withUnit(num(v), "deg")
      : rated == null
        ? "the profile's rated travel"
        : `the profile's rated travel, ${withUnit(num(rated), "deg")}`;
  return (
    <Editable
      ctx={ctx}
      title="Soft travel"
      shown={shown}
      fields={[{ id: "v", label: "Soft travel", unit: "deg" }]}
      initial={{ v: typeof v === "number" ? String(v) : "" }}
      apply={(vals) => withSoftTravel(ctx.policy, vals.v)}
    />
  );
}

function NumberValue({
  ctx,
  title,
  path,
  unit,
  warn,
}: {
  ctx: Ctx;
  title: string;
  path: string;
  unit: string;
  warn?: (n: number) => string | undefined;
}) {
  const v = valueAt(ctx.policy, path);
  const shown = typeof v !== "number" ? KEPT : withUnit(num(v), unit);
  return (
    <Editable
      ctx={ctx}
      title={title}
      shown={shown}
      fields={[{ id: "v", label: title, unit: unit === "" ? undefined : unit }]}
      initial={{ v: typeof v === "number" ? String(v) : "" }}
      apply={(vals) => numberAt(ctx.policy, path, vals.v)}
      warn={(q) => {
        const n = valueAt(q, path);
        return typeof n === "number" ? warn?.(n) : undefined;
      }}
    />
  );
}

function Choice({
  ctx,
  title,
  path,
  options,
  describe,
}: {
  ctx: Ctx;
  title: string;
  path: string;
  options: { value: string; label: string }[];
  describe?: (value: string) => string | undefined;
}) {
  const v = valueAt(ctx.policy, path);
  const shown = options.find((o) => o.value === v)?.label ?? KEPT;
  return (
    <Editable
      ctx={ctx}
      title={title}
      shown={shown}
      fields={[{ id: "v", label: title, options: [...options, { value: "", label: "Not set" }] }]}
      initial={{ v: typeof v === "string" ? v : "" }}
      apply={(vals) =>
        withValue(ctx.policy, path, vals.v === "" || vals.v === undefined ? null : vals.v)
      }
      describe={(_q, vals) => ({ preview: describe?.(vals.v ?? "") })}
    />
  );
}

interface FormSpec {
  tag: string;
  label: string;
  unit: string;
}

/** A value with a portable and a fixed form, chosen by a Share / Fixed segment. */
function Dual({
  ctx,
  title,
  path,
  portable,
  fixed,
  shown,
  resolved,
  convert,
}: {
  ctx: Ctx;
  title: string;
  path: string;
  portable: FormSpec;
  fixed: FormSpec;
  shown: (form: { tag: string; amount: number | null }) => string;
  resolved: (candidate: TuningPolicy) => Verdict;
  /** The amount in the form switched to, where the preview gives what it is over. */
  convert?: (to: string, amount: number) => number | undefined;
}) {
  const form = formOf(valueAt(ctx.policy, path));
  const text = form === undefined ? KEPT : shown(form);
  const specOf = (tag: string | undefined) => (tag === fixed.tag ? fixed : portable);
  return (
    <Editable
      ctx={ctx}
      title={title}
      shown={text}
      fields={[{ id: "v", label: title }]}
      initial={{
        form: specOf(form?.tag).tag,
        v: form?.amount == null ? "" : String(form.amount),
      }}
      head={(values, set) => (
        <Tabs
          value={values.form ?? portable.tag}
          onValueChange={(tag) => {
            const amount = parseNumber(values.v ?? "");
            const moved =
              "value" in amount && amount.value !== null ? convert?.(tag, amount.value) : undefined;
            set({ ...values, form: tag, v: moved === undefined ? "" : num(moved) });
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value={portable.tag}>{portable.label}</TabsTrigger>
            <TabsTrigger value={fixed.tag}>{fixed.label}</TabsTrigger>
          </TabsList>
          <span className="mt-1 block text-xs text-text-3">
            {unitSymbol(specOf(values.form).unit)}
          </span>
        </Tabs>
      )}
      apply={(vals) => {
        const n = parseNumber(vals.v ?? "");
        if ("error" in n) return n;
        if (n.value !== null && !(n.value > 0)) return { error: "State a value over 0, or none" };
        const tag = specOf(vals.form).tag;
        return withValue(ctx.policy, path, n.value === null ? null : { [tag]: n.value });
      }}
      describe={(q) => resolved(q)}
    />
  );
}

function SpeedCeiling({ ctx }: { ctx: Ctx }) {
  const s = ctx.policy.protection?.speed_ceiling?.share_of_no_load;
  return (
    <Editable
      ctx={ctx}
      title="Speed ceiling"
      shown={s === undefined ? KEPT : `${shareText(s)} of the no-load speed`}
      fields={[
        { id: "v", label: "Share of the no-load speed", unit: "as 2/3 or 0.66", text: true },
      ]}
      initial={{ v: s === undefined ? "" : shareText(s) }}
      apply={(vals) => {
        const share = parseShare(vals.v ?? "");
        return share === undefined
          ? { error: "State a share over 0 and at most 1, such as 2/3" }
          : withValue(ctx.policy, "protection.speed_ceiling", { share_of_no_load: share });
      }}
      describe={(q) => {
        const r = previewOf(q, ctx.profile, ctx.rOhm).preview;
        const share = q.protection?.speed_ceiling?.share_of_no_load;
        const looser = share !== undefined && share[0] / share[1] > 2 / 3 + 1e-9;
        return {
          preview:
            r === undefined
              ? undefined
              : `= ${num(Math.round(r.speedCeilingDegS))}°/s with ${ctx.profile?.key ?? ""}`,
          warning: looser ? WARN.speedCeiling : undefined,
        };
      }}
    />
  );
}

function YieldValue({ ctx }: { ctx: Ctx }) {
  const y = ctx.policy.protection?.yield;
  const torque = y != null && "torque_kg_cm" in y ? y.torque_kg_cm : undefined;
  const ma = y != null && "ma" in y ? y.ma : undefined;
  const byGear =
    ctx.profile === undefined
      ? "the cap on metal, the plastic torque limit on plastic"
      : plastic(ctx.profile)
        ? "the plastic torque limit, not known yet"
        : "the cap, no fold";
  const shown =
    y == null
      ? KEPT
      : ma !== undefined
        ? `${num(ma)} mA`
        : torque == null
          ? byGear
          : `${num(torque)} kg cm, ${BY_RUN}`;
  return (
    <Editable
      ctx={ctx}
      title="Max yield torque"
      shown={shown}
      fields={[{ id: "v", label: "Max yield torque (blank for the default)" }]}
      initial={{ form: ma === undefined ? "torque_kg_cm" : "ma", v: String(ma ?? torque ?? "") }}
      head={(values, set) => (
        <Tabs
          value={values.form ?? "torque_kg_cm"}
          onValueChange={(tag) => {
            set({ ...values, form: tag, v: "" });
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="torque_kg_cm">Torque</TabsTrigger>
            <TabsTrigger value="ma">Fixed</TabsTrigger>
          </TabsList>
          <span className="mt-1 block text-xs text-text-3">
            {values.form === "ma" ? "mA" : `kg cm at the horn; blank: ${byGear}`}
          </span>
        </Tabs>
      )}
      apply={(vals) => {
        const n = parseNumber(vals.v ?? "");
        if ("error" in n) return n;
        if (n.value !== null && !(n.value > 0)) return { error: "State a value over 0, or none" };
        if (vals.form === "ma") {
          return n.value === null
            ? { error: "State the fixed current in mA" }
            : withValue(ctx.policy, "protection.yield", { ma: n.value });
        }
        return withValue(ctx.policy, "protection.yield", { torque_kg_cm: n.value });
      }}
      warn={(q) => {
        const t = formOf(q.protection?.yield);
        if (t?.tag !== "torque_kg_cm" || t.amount === null || !plastic(ctx.profile))
          return undefined;
        const limit = q.protection?.plastic_torque_limit_kg_cm;
        return limit == null || t.amount > limit ? WARN.yieldTorque : undefined;
      }}
    />
  );
}

function PositionError({ ctx }: { ctx: Ctx }) {
  const e = ctx.policy.protection?.position_error;
  const shown =
    e == null
      ? KEPT
      : `${e.deg == null ? "-" : num(e.deg)}° for ${e.time_ms == null ? "-" : num(e.time_ms)} ms`;
  return (
    <Editable
      ctx={ctx}
      title="Position error"
      shown={shown}
      fields={[
        { id: "deg", label: "Angle", unit: "deg" },
        { id: "ms", label: "For", unit: "ms" },
      ]}
      initial={{
        deg: e?.deg == null ? "" : String(e.deg),
        ms: e?.time_ms == null ? "" : String(e.time_ms),
      }}
      apply={(vals) => {
        const deg = parseNumber(vals.deg ?? "");
        const ms = parseNumber(vals.ms ?? "");
        if ("error" in deg) return deg;
        if ("error" in ms) return ms;
        const value =
          deg.value === null && ms.value === null ? null : { deg: deg.value, time_ms: ms.value };
        return withValue(ctx.policy, "protection.position_error", value);
      }}
      warn={(q) => {
        const n = q.protection?.position_error;
        return (n?.deg ?? 0) > 9.9 || (n?.time_ms ?? 0) > 100 ? WARN.positionError : undefined;
      }}
    />
  );
}
