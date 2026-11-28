import type { ServoProfile } from "@openservocore/client";
import { CircleQuestionMark, Download, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { HandTurn } from "@/components/hand-turn";
import { InputEditor, ValueButton, type Values, type Verdict } from "@/components/input-editor";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Stored } from "@/lib/library";
import {
  degPerS,
  fieldIssue,
  formatNumber,
  formatRatio,
  formatRpm,
  GEAR_TEXT,
  gearOf,
  HEAT_FIELDS,
  identifiable,
  missing,
  modelTitle,
  motorRpm,
  NO_HEAT_MODEL,
  NOT_METAL,
  parseNumber,
  parseStages,
  PLASTIC_STOPPER,
  pulsesPerTurn,
  RATED_TRAVEL,
  ratings,
  secondsPer60,
  stagesText,
  STOPPER_TEXT,
  stopperOf,
  teethProduct,
  withField,
  withoutRating,
  withRatedTravel,
  withRatio,
  withRating,
  withStages,
  type Required,
} from "@/lib/profile-form";

const NOT_SET = "not set";

export function ProfileStatus({ profile }: { profile: ServoProfile }) {
  const n = missing(profile).length;
  return n === 0 ? (
    <Badge className="bg-success-soft text-success">ready</Badge>
  ) : (
    <Badge className="bg-warning-soft text-warning">{n} missing</Badge>
  );
}

export function ProfileCard({
  entry,
  onSave,
  onExport,
}: {
  entry: Stored<ServoProfile>;
  onSave: (next: ServoProfile) => Promise<unknown>;
  onExport: () => void;
}) {
  const p = entry.value;
  const [all, setAll] = useState(false);
  const save = async (next: ServoProfile) => {
    await onSave(next);
  };
  const how = (key: string) => p.provenance?.fields?.[key]?.how;
  const grey = (key: string, extra?: string) =>
    all ? [key, how(key), extra].filter((s) => s !== undefined).join(" . ") : undefined;
  const pulses = pulsesPerTurn(p);

  return (
    <Card role="region" aria-label="Profile">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {modelTitle(p)}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="About profiles">
                <CircleQuestionMark />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start">
              A profile holds the facts about a servo model that no measurement gives: the gears,
              the motor's counts, the rated travel and the maker's ratings. One profile serves every
              servo of that model.
            </PopoverContent>
          </Popover>
        </CardTitle>
        <CardDescription className="font-mono text-xs">
          {p.key} . revision {p.revision}
        </CardDescription>
        <CardAction>
          <ProfileStatus profile={p} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <Section title="Gears">
          <Row
            label="Gear material"
            issue={fieldIssue(p, "gear_class")}
            note={p.gear_class != null && !identifiable(p) ? NOT_METAL : undefined}
            grey={grey("gear_class")}
          >
            <ChoiceEditor
              title="Gear material"
              value={p.gear_class ?? ""}
              shown={p.gear_class == null ? NOT_SET : GEAR_TEXT[p.gear_class]}
              options={[
                { value: "metal", label: "Metal" },
                { value: "plastic", label: "Plastic" },
                { value: "unknown", label: "Unknown" },
                { value: "", label: "Not set" },
              ]}
              onSave={(v) => save(withField(p, "gear_class", gearOf(v)))}
            />
          </Row>
          <Row
            label="Gear ratio"
            issue={fieldIssue(p, "gear_ratio")}
            grey={grey(
              "gear_ratio",
              p.gear_stages === undefined ? undefined : stagesText(p.gear_stages),
            )}
          >
            <NumberEditor
              title="Gear ratio"
              unit=": 1"
              value={p.gear_ratio}
              shown={p.gear_ratio == null ? NOT_SET : formatRatio(p.gear_ratio)}
              field="gear_ratio"
              apply={(v) => withRatio(p, v)}
              onSave={save}
            />
            <TeethEditor profile={p} onSave={save} />
          </Row>
          <Row
            label="End stops"
            note={p.output_stopper === "plastic" ? PLASTIC_STOPPER : undefined}
            grey={grey("output_stopper")}
          >
            <ChoiceEditor
              title="End stops"
              value={p.output_stopper ?? ""}
              shown={p.output_stopper === undefined ? NOT_SET : STOPPER_TEXT[p.output_stopper]}
              options={[
                { value: "plastic", label: "Plastic" },
                { value: "metal", label: "Metal" },
                { value: "none", label: "None" },
                { value: "", label: "Not stated" },
              ]}
              onSave={(v) => {
                const next = withField(p, "output_stopper", stopperOf(v));
                if (next.output_stopper === undefined) delete next.output_stopper;
                return save(next);
              }}
            />
          </Row>
        </Section>

        <Section title="Motor">
          <Row
            label="Brushes and segments"
            issue={fieldIssue(p, "counts")}
            note={pulses === undefined ? undefined : `${pulses} ripple pulses a motor turn`}
            noteTone="grey"
            grey={grey("brushes")}
          >
            <span className="text-sm">Brushes</span>
            <CountEditor
              title="Brushes"
              name="Brushes"
              value={p.brushes}
              onSave={(v) => save(withField(p, "brushes", v))}
            />
            <span className="ml-3 text-sm">Segments</span>
            <CountEditor
              title="Commutator segments"
              name="Segments"
              value={p.rotor_segments}
              onSave={(v) => save(withField(p, "rotor_segments", v))}
            />
          </Row>
        </Section>

        <Section title="Travel and direction">
          <Row
            label="Rated travel"
            issue={fieldIssue(p, "rated_travel_deg")}
            note={RATED_TRAVEL}
            noteTone="grey"
            grey={grey("rated_travel_deg")}
          >
            <NumberEditor
              title="Rated travel"
              unit="deg"
              value={p.rated_travel_deg}
              shown={p.rated_travel_deg == null ? NOT_SET : `${formatNumber(p.rated_travel_deg)}°`}
              field="rated_travel_deg"
              apply={(v) => withRatedTravel(p, v)}
              onSave={save}
            />
          </Row>
          <Row
            label="Counterclockwise raises the reading"
            issue={fieldIssue(p, "count_rises_ccw")}
            grey={grey("count_rises_ccw")}
          >
            <ChoiceEditor
              title="Counterclockwise raises the reading"
              value={p.count_rises_ccw == null ? "" : String(p.count_rises_ccw)}
              shown={p.count_rises_ccw == null ? NOT_SET : p.count_rises_ccw ? "Yes" : "No"}
              options={[
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
                { value: "", label: "Not set" },
              ]}
              onSave={(v) => save(withField(p, "count_rises_ccw", v === "" ? null : v === "true"))}
            />
            <HandTurn
              onSave={(risesCcw) =>
                save(withField(p, "count_rises_ccw", risesCcw, "measured by hand"))
              }
            />
          </Row>
        </Section>

        <Section title="Ratings">
          <Row
            label="Operating range"
            issue={fieldIssue(p, "operating_v")}
            grey={grey("operating_v")}
          >
            <RangeEditor profile={p} onSave={save} />
          </Row>
          {ratings(p).map((r) => (
            <div
              key={r.at_v}
              role="group"
              aria-label={`Rating at ${formatNumber(r.at_v)} V`}
              className="flex items-baseline gap-3 text-sm"
            >
              <span className="w-14 font-mono">{formatNumber(r.at_v)} V</span>
              {r.noLoad === undefined ? (
                <span className="text-text-3">no speed stated</span>
              ) : (
                <>
                  <span className="font-mono">{secondsPer60(r.noLoad).toFixed(2)} s/60°</span>
                  <span className="font-mono">
                    = {formatNumber(Math.round(degPerS(r.noLoad)))}°/s
                  </span>
                  {p.gear_ratio != null && p.gear_ratio > 0 && (
                    <span className="font-mono text-text-3">
                      {formatRpm(motorRpm(degPerS(r.noLoad), p.gear_ratio))} motor rpm
                    </span>
                  )}
                </>
              )}
              <span className="font-mono text-text-3">
                {r.stall?.torque_kg_cm === undefined
                  ? "no stall torque"
                  : `stall ${formatNumber(r.stall.torque_kg_cm)} kg cm`}
                {r.stall?.current_a !== undefined && `, ${formatNumber(r.stall.current_a)} A`}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                className="ml-auto"
                aria-label={`Remove the ${formatNumber(r.at_v)} V rating`}
                onClick={() => void save(withoutRating(p, r.at_v))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {fieldIssue(p, "no_load") !== undefined && (
            <p className="text-xs text-warning">{fieldIssue(p, "no_load")}</p>
          )}
          <RatingEditor profile={p} onSave={save} />
        </Section>

        <Section title="Heat model">
          <Row label="Heat model" issue={fieldIssue(p, "thermal")} grey={grey("thermal")}>
            <HeatEditor profile={p} onSave={save} />
          </Row>
        </Section>

        {all && (
          <>
            <Section title="Provenance">
              <Row label="Document" grey="provenance.document">
                <DocumentEditor profile={p} onSave={save} />
              </Row>
              <p className="font-mono text-xs break-all text-text-3">
                schema {p.schema} . sha256 {entry.sha256}
              </p>
            </Section>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download />
            Export
          </Button>
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
  issue,
  note,
  noteTone = "warning",
  grey,
  children,
}: {
  label: string;
  issue?: string;
  note?: string;
  noteTone?: "warning" | "grey";
  grey?: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="w-64 text-sm">{label}</span>
        {children}
      </div>
      {issue !== undefined && <p className="text-xs text-warning">{issue}</p>}
      {note !== undefined && (
        <p className={noteTone === "grey" ? "text-xs text-text-3" : "text-xs text-warning"}>
          {note}
        </p>
      )}
      {grey !== undefined && <p className="font-mono text-xs text-text-3">{grey}</p>}
    </div>
  );
}

function ChoiceEditor({
  title,
  value,
  shown,
  options,
  onSave,
}: {
  title: string;
  value: string;
  shown: string;
  options: { value: string; label: string }[];
  onSave: (value: string) => Promise<void>;
}) {
  return (
    <InputEditor
      title={title}
      current={shown}
      fields={[{ id: "v", label: title, options }]}
      initial={() => ({ v: value })}
      check={() => ({})}
      onSave={(v) => onSave(v.v ?? "")}
    >
      <ValueButton>{shown}</ValueButton>
    </InputEditor>
  );
}

/** A refused value is not stored; a blank clears the field and leaves the run's sentence under it. */
function verdictOf(
  text: string | undefined,
  candidate: (v: number | null) => string | undefined,
  preview?: (v: number) => string,
): Verdict {
  const parsed = parseNumber(text ?? "");
  if ("error" in parsed) return { error: parsed.error };
  const issue = candidate(parsed.value);
  if (parsed.value === null) return { warning: issue };
  if (issue !== undefined) return { error: issue };
  return { preview: preview?.(parsed.value) };
}

function NumberEditor({
  title,
  unit,
  value,
  shown,
  field,
  apply,
  onSave,
}: {
  title: string;
  unit: string;
  value: number | null | undefined;
  shown: string;
  field: Required;
  apply: (v: number | null) => ServoProfile;
  onSave: (next: ServoProfile) => Promise<void>;
}) {
  const parse = (v: Values) => {
    const parsed = parseNumber(v.v ?? "");
    return "error" in parsed ? null : parsed.value;
  };
  return (
    <InputEditor
      title={title}
      current={shown}
      fields={[{ id: "v", label: title, unit }]}
      initial={() => ({ v: value == null ? "" : String(value) })}
      check={(v) => verdictOf(v.v, (n) => fieldIssue(apply(n), field))}
      onSave={(v) => onSave(apply(parse(v)))}
    >
      <ValueButton>{shown}</ValueButton>
    </InputEditor>
  );
}

function CountEditor({
  title,
  name,
  value,
  onSave,
}: {
  title: string;
  name: string;
  value: number | null | undefined;
  onSave: (v: number | null) => Promise<void>;
}) {
  const shown = value == null ? NOT_SET : String(value);
  return (
    <InputEditor
      title={title}
      current={shown}
      fields={[{ id: "v", label: title }]}
      initial={() => ({ v: value == null ? "" : String(value) })}
      check={(v) =>
        verdictOf(v.v, (n) =>
          n !== null && !(Number.isInteger(n) && n >= 1)
            ? "Count whole parts, 1 or more"
            : undefined,
        )
      }
      onSave={(v) => {
        const parsed = parseNumber(v.v ?? "");
        return onSave("error" in parsed ? null : parsed.value);
      }}
    >
      <ValueButton aria-label={`${name}: ${shown}`}>{shown}</ValueButton>
    </InputEditor>
  );
}

function TeethEditor({
  profile,
  onSave,
}: {
  profile: ServoProfile;
  onSave: (next: ServoProfile) => Promise<void>;
}) {
  return (
    <InputEditor
      title="Count teeth"
      current={profile.gear_stages === undefined ? undefined : stagesText(profile.gear_stages)}
      fields={[
        {
          id: "stages",
          label: "Each stage's pinion and wheel teeth, from the motor out",
          placeholder: "9:48 12:48 10:38 10:38",
        },
      ]}
      initial={() => ({
        stages: (profile.gear_stages ?? []).map(([p, w]) => `${p}:${w}`).join(" "),
      })}
      check={(v) => {
        const parsed = parseStages(v.stages ?? "");
        if ("empty" in parsed) return { error: "Enter at least one stage" };
        if ("error" in parsed) return { error: parsed.error };
        const ratio = teethProduct(parsed.stages);
        return {
          preview:
            ratio === undefined
              ? undefined
              : `= ${formatRatio(ratio)} over ${parsed.stages.length} stages`,
        };
      }}
      onSave={(v) => {
        const parsed = parseStages(v.stages ?? "");
        return "stages" in parsed ? onSave(withStages(profile, parsed.stages)) : Promise.resolve();
      }}
    >
      <Button variant="link" size="sm" className="h-auto px-0">
        Count teeth
      </Button>
    </InputEditor>
  );
}

function RangeEditor({
  profile,
  onSave,
}: {
  profile: ServoProfile;
  onSave: (next: ServoProfile) => Promise<void>;
}) {
  const op = profile.operating_v;
  const shown = op == null ? NOT_SET : `${formatNumber(op.min)} to ${formatNumber(op.max)} V`;
  const candidate = (
    v: Values,
  ): { range: { min: number; max: number } | null } | { error: string } => {
    const min = parseNumber(v.min ?? "");
    const max = parseNumber(v.max ?? "");
    if ("error" in min) return min;
    if ("error" in max) return max;
    if (min.value === null && max.value === null) return { range: null };
    if (min.value === null || max.value === null) return { error: "Enter both ends, or neither" };
    return { range: { min: min.value, max: max.value } };
  };
  return (
    <InputEditor
      title="Operating range"
      current={shown}
      fields={[
        { id: "min", label: "Lowest", unit: "V" },
        { id: "max", label: "Highest", unit: "V" },
      ]}
      initial={() => ({
        min: op == null ? "" : String(op.min),
        max: op == null ? "" : String(op.max),
      })}
      check={(v) => {
        const c = candidate(v);
        if ("error" in c) return { error: c.error };
        const issue = fieldIssue({ ...profile, operating_v: c.range }, "operating_v");
        return c.range === null ? { warning: issue } : { error: issue };
      }}
      onSave={(v) => {
        const c = candidate(v);
        return "range" in c
          ? onSave(withField(profile, "operating_v", c.range))
          : Promise.resolve();
      }}
    >
      <ValueButton>{shown}</ValueButton>
    </InputEditor>
  );
}

function RatingEditor({
  profile,
  onSave,
}: {
  profile: ServoProfile;
  onSave: (next: ServoProfile) => Promise<void>;
}) {
  const read = (v: Values) => {
    const out: Record<string, number | null> = {};
    for (const id of ["volts", "seconds", "torque", "current"]) {
      const parsed = parseNumber(v[id] ?? "");
      if ("error" in parsed) return { error: parsed.error };
      if (parsed.value !== null && !(parsed.value > 0)) return { error: "Every value is over 0" };
      out[id] = parsed.value;
    }
    const { volts, seconds, torque, current } = out;
    if (volts == null || seconds == null) {
      return { error: "Enter the voltage and the no-load time the sheet states" };
    }
    return {
      rating: {
        at_v: volts,
        seconds_per_60: seconds,
        torque_kg_cm: torque ?? undefined,
        current_a: current ?? undefined,
      },
    };
  };
  return (
    <InputEditor
      title="Add a rating"
      fields={[
        { id: "volts", label: "At", unit: "V" },
        { id: "seconds", label: "No-load speed", unit: "s/60 deg" },
        { id: "torque", label: "Stall torque (optional)", unit: "kg cm" },
        { id: "current", label: "Stall current (optional)", unit: "A" },
      ]}
      initial={() => ({})}
      check={(v) => {
        const r = read(v);
        if (r.rating === undefined) return { error: r.error };
        const speed = 60 / r.rating.seconds_per_60;
        const ratio = profile.gear_ratio;
        const rpm =
          ratio != null && ratio > 0 ? `, ${formatRpm(motorRpm(speed, ratio))} motor rpm` : "";
        const replaces = ratings(profile).some((x) => x.at_v === r.rating.at_v)
          ? `; replaces the ${formatNumber(r.rating.at_v)} V rating`
          : "";
        return { preview: `= ${formatNumber(Math.round(speed))}°/s${rpm}${replaces}` };
      }}
      onSave={(v) => {
        const r = read(v);
        return r.rating === undefined ? Promise.resolve() : onSave(withRating(profile, r.rating));
      }}
    >
      <Button variant="outline" size="sm" className="self-start">
        <Plus />
        Add a rating
      </Button>
    </InputEditor>
  );
}

function HeatEditor({
  profile,
  onSave,
}: {
  profile: ServoProfile;
  onSave: (next: ServoProfile) => Promise<void>;
}) {
  const h = profile.thermal;
  const shown =
    h == null
      ? NOT_SET
      : `fast ${formatNumber(h.fast_tau_s)} s, ${formatNumber(h.fast_gain_c_per_w)} °C/W; slow ${formatNumber(h.slow_tau_s)} s, ${formatNumber(h.slow_gain_c_per_w)} °C/W`;
  const read = (v: Values) => {
    const nums = HEAT_FIELDS.map((f) => parseNumber(v[f.id] ?? ""));
    const bad = nums.find((n) => "error" in n);
    if (bad !== undefined && "error" in bad) return { error: bad.error };
    const values = nums.map((n) => ("value" in n ? n.value : null));
    if (values.every((n) => n === null)) return { thermal: null };
    if (values.some((n) => n === null)) return { error: "Enter all four heat values, or none" };
    const [fast_tau_s = 0, fast_gain_c_per_w = 0, slow_tau_s = 0, slow_gain_c_per_w = 0] =
      values.map((n) => n ?? 0);
    return { thermal: { fast_tau_s, fast_gain_c_per_w, slow_tau_s, slow_gain_c_per_w } };
  };
  return (
    <InputEditor
      title="Heat model"
      current={shown}
      fields={HEAT_FIELDS}
      initial={() =>
        Object.fromEntries(HEAT_FIELDS.map((f) => [f.id, h == null ? "" : String(h[f.id])]))
      }
      check={(v) => {
        const r = read(v);
        if ("error" in r) return { error: r.error };
        if (r.thermal === null) return { warning: NO_HEAT_MODEL };
        return { error: fieldIssue({ ...profile, thermal: r.thermal }, "thermal") };
      }}
      onSave={(v) => {
        const r = read(v);
        return "thermal" in r
          ? onSave(withField(profile, "thermal", r.thermal))
          : Promise.resolve();
      }}
    >
      <ValueButton>{shown}</ValueButton>
    </InputEditor>
  );
}

function DocumentEditor({
  profile,
  onSave,
}: {
  profile: ServoProfile;
  onSave: (next: ServoProfile) => Promise<void>;
}) {
  const doc = profile.provenance?.document;
  const shown = doc === undefined || doc === "" ? NOT_SET : doc;
  return (
    <InputEditor
      title="Document"
      fields={[{ id: "doc", label: "The sheet's title or link", text: true }]}
      initial={() => ({ doc: doc ?? "" })}
      check={() => ({})}
      onSave={(v) => {
        const text = (v.doc ?? "").trim();
        const provenance = { ...profile.provenance };
        if (text === "") delete provenance.document;
        else provenance.document = text;
        return onSave({ ...profile, provenance });
      }}
    >
      <ValueButton className="max-w-[40rem] truncate text-left font-sans">{shown}</ValueButton>
    </InputEditor>
  );
}
