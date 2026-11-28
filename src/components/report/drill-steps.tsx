import { useEffect, useMemo, useState } from "react";
import type uPlot from "uplot";
import { Chart, type ChartOptions } from "@/components/uplot";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useChartTokens } from "@/lib/chart-theme";
import {
  acceptedTry,
  cellText,
  histogram,
  keyLines,
  level,
  meanBand,
  pointsBy,
  tries,
  tryDir,
  type TryRow,
} from "@/lib/drill";
import { readFile } from "@/lib/opfs";
import {
  at,
  list,
  moveCaptures,
  moveTrace,
  num,
  parseCsv,
  readRows,
  runAt,
  str,
  tablePoints,
  type MoveTrace,
} from "@/lib/report";
import { movesOf, type Moves, type Point } from "@/lib/report-cards";
import { readCapture, useCaptures, useRunFiles, type RunFiles } from "@/lib/use-drill";
import { storage } from "@/lib/use-library";
import { axis, Legend, seriesOf, type Series } from "./charts";
import {
  CapturesCard,
  ChecksTable,
  DrillCard,
  KeyTable,
  Lines,
  ListTable,
  Plot,
  type PlotSeries,
} from "./drill";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const LONG_LIST = 16;

/** An object's keys, nested ones dotted, without the long lists and lists of records left to their own tables. */
function scalars(obj: unknown) {
  return keyLines(obj).filter((l) => {
    const v = at(obj, l.key);
    return !(
      Array.isArray(v) &&
      (v.length > LONG_LIST || v.some((e) => typeof e === "object" && e !== null))
    );
  });
}

const KEPT_ASIDE: PlotSeries[] = [
  { label: "kept", mark: "dots", tone: "series1" },
  { label: "set aside", mark: "hollow", tone: "series2" },
];

function band(label: string): PlotSeries[] {
  return [
    { label, mark: "line", tone: "ctx" },
    { label: "- 1 sd", mark: "dashed", tone: "ctx" },
    { label: "+ 1 sd", mark: "dashed", tone: "ctx" },
  ];
}

// Ke, J and L/R drawn in units whose values read without an exponent.
const MILLI = 1e3;
const G_MM2 = 1e9;

function times(v: number | undefined, by: number): number | null {
  return v === undefined ? null : v * by;
}

function indexed(values: readonly unknown[]): Point[] {
  return values.flatMap((v, i) => (typeof v === "number" ? [{ x: i + 1, y: v }] : []));
}

export function RestView({ uid, utc, doc }: { uid: string; utc: string; doc: unknown }) {
  const channels = ["rest", "raw"].flatMap((row) => {
    const chans = at(doc, `channels.${row}`);
    if (typeof chans !== "object" || chans === null) return [];
    return Object.entries(chans).map(([channel, stats]) => ({
      row,
      channel,
      ...(stats as Record<string, unknown>),
    }));
  });
  const pattern = list(doc, "frame_ripple.pattern_counts").flatMap((v, i) =>
    typeof v === "number" ? [{ x: i, y: v }] : [],
  );
  return (
    <>
      <DrillCard
        title="Channels"
        says="Each channel of each row, read still: the spread raw and with the frame pattern taken out, and the pattern's size folded over 16 ticks."
      >
        <ListTable
          label="Channel statistics"
          rows={channels}
          cols={[
            "row",
            "channel",
            "n",
            "mean",
            "min",
            "max",
            "sd_raw",
            "sd",
            "fold_16_raw",
            "fold_16",
            "pattern_gain",
          ]}
        />
      </DrillCard>
      <RestHistogram uid={uid} utc={utc} doc={doc} />
      <DrillCard
        title="Frame pattern"
        says={`The pattern each channel less its gain times this is taken out by, ${str(doc, "frame_ripple.phase") ?? ""}.`}
      >
        <Plot
          series={[{ label: "pattern", mark: "line", tone: "series1" }]}
          sets={[pattern]}
          x={{ label: "tick modulo 16", unit: "" }}
          y={{ label: "counts", unit: "counts" }}
        />
        <KeyTable label="Frame ripple" lines={scalars(at(doc, "frame_ripple"))} />
      </DrillCard>
      <DrillCard
        title="Thermistor and slots"
        says="The thermistor words the step worked out, and the slots it read the pot through."
      >
        <KeyTable
          label="Thermistor"
          lines={[...keyLines(at(doc, "ntc_parts")), ...keyLines(at(doc, "ntc_words"))]}
        />
        <KeyTable label="Slots" lines={keyLines(at(doc, "pos_wide_slots"))} />
      </DrillCard>
    </>
  );
}

function RestHistogram({ uid, utc, doc }: { uid: string; utc: string; doc: unknown }) {
  const { data: captures } = useCaptures(uid, utc, "captures/rest");
  const [row, setRow] = useState("rest");
  const [channel, setChannel] = useState("pos");
  const [values, setValues] = useState<{ key: string; points?: Point[]; why?: string }>();
  const chans = at(doc, `channels.${row}`);
  const names = typeof chans === "object" && chans !== null ? Object.keys(chans) : [];
  const shownChannel = names.includes(channel) ? channel : (names[0] ?? "");
  const capture = captures?.find((c) => str(c.metaDoc, "row") === row);
  const key = `${row}/${shownChannel}/${capture?.rows ?? ""}`;

  useEffect(() => {
    if (capture === undefined) return;
    let live = true;
    void (async () => {
      try {
        if (!capture.kept) {
          if (live)
            setValues({
              key,
              why: `The rows were trimmed: the run folder does not hold ${capture.rows}.`,
            });
          return;
        }
        const read = await readCapture(uid, utc, capture.rows);
        const cols = read === undefined ? undefined : parseCsv(read.text);
        const col = cols?.get(shownChannel);
        if (live) {
          setValues(
            col === undefined
              ? { key, why: `${capture.rows} holds no ${shownChannel} column.` }
              : { key, points: histogram(col) },
          );
        }
      } catch (e) {
        if (live) setValues({ key, why: message(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [uid, utc, capture, shownChannel, key]);

  const shown = values?.key === key ? values : undefined;
  const sd = num(doc, `channels.${row}.${shownChannel}.sd_raw`);
  const n = num(doc, `channels.${row}.${shownChannel}.n`);
  return (
    <DrillCard
      title="Rest histogram"
      says="How often each code came up in the still row: the raw data behind the channel's spread."
    >
      <div className="flex flex-wrap gap-2">
        <Select value={row} onValueChange={setRow}>
          <SelectTrigger aria-label="Row" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rest">rest</SelectItem>
            <SelectItem value="raw">raw</SelectItem>
          </SelectContent>
        </Select>
        <Select value={shownChannel} onValueChange={setChannel}>
          <SelectTrigger aria-label="Channel" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {names.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {capture === undefined && captures !== undefined && (
        <p className="text-text-3">The run folder holds no capture of the {row} row.</p>
      )}
      {shown?.why !== undefined && <p className="text-text-3">{shown.why}</p>}
      {shown?.points !== undefined && (
        <Plot
          series={[{ label: "rows at the code", mark: "steps", tone: "series1" }]}
          sets={[shown.points]}
          x={{ label: `${shownChannel}, counts`, unit: "counts" }}
          y={{ label: "rows", unit: "rows" }}
        />
      )}
      {shown === undefined && capture !== undefined && <Skeleton className="h-56 w-full" />}
      <p aria-label="Histogram spread" className="text-sm">
        The step's spread of {shownChannel} in the {row} row: sd{" "}
        {sd === undefined ? "not written" : cellText(sd)} counts
        {n === undefined ? "" : `, n ${String(n)}`}.
      </p>
    </DrillCard>
  );
}

export function ProbeView({ doc }: { doc: unknown }) {
  const bursts = list(doc, "part_a.bursts");
  const [inFit, out] = pointsBy(bursts, "k", "fit.r_ohm", "in_fit");
  const pooledR = num(doc, "part_a.pooled.r_ohm");
  const resid = indexed(list(doc, "part_a.pooled.resid_v"));
  return (
    <>
      <DrillCard
        title="Part A: R per burst"
        says="Each burst's own period-pair fit R in the order the step drove them (the table gives each one's volts), and the pooled fit's R over the bursts in it."
      >
        <Plot
          series={[
            { label: "in the pooled fit", mark: "dots", tone: "series1" },
            { label: "not in it", mark: "hollow", tone: "series2" },
            { label: "pooled R", mark: "line", tone: "ctx" },
          ]}
          sets={[inFit, out, pooledR === undefined ? [] : level(pooledR, [inFit, out])]}
          x={{ label: "burst k", unit: "" }}
          y={{ label: "R, Ω", unit: "ohm" }}
        />
        <KeyTable label="Pooled fit" lines={scalars(at(doc, "part_a.pooled"))} />
      </DrillCard>
      <DrillCard
        title="Part A: pooled residuals"
        says={`The pooled fit's residual at each of its ${String(resid.length)} period pairs.`}
      >
        <Plot
          series={[{ label: "residual", mark: "dots", tone: "series1" }]}
          sets={[resid]}
          x={{ label: "period pair", unit: "" }}
          y={{ label: "residual, V", unit: "V" }}
        />
      </DrillCard>
      <DrillCard title="Part A: bursts" says="Each burst as the step wrote it.">
        <ListTable
          label="Bursts"
          rows={bursts}
          cols={[
            "k",
            "dir",
            "level",
            "volts",
            "duty_q15",
            "in_fit",
            "kept",
            "aside",
            "i_first_a",
            "i_late_a",
            "move_share",
            "fit.r_ohm",
            "fit.l_h",
            "fit.tau_s",
            "fit.pairs",
            "fit.resid_rms_v",
            "error",
          ]}
        />
        <KeyTable label="Part A scales" lines={keyLines(at(doc, "part_a.scales"))} />
      </DrillCard>
      <DrillCard
        title="Part B: pulses"
        says="The polarity pulses, each level's motion as the step read it."
      >
        <KeyTable
          label="Part B"
          lines={scalars(at(doc, "part_b")).filter((l) => !["pulses", "path"].includes(l.key))}
        />
        <ListTable
          label="Pulses"
          rows={list(doc, "part_b.pulses")}
          cols={[
            "n",
            "level",
            "dir",
            "duty_q15",
            "volts",
            "time_s",
            "start_counts",
            "peak_counts",
            "end_counts",
            "emf_counts",
            "emf_bound_counts",
            "emf_agrees",
            "current_peak_a",
            "motion",
          ]}
        />
        <Lines label="Part B path" doc={doc} path="part_b.path" />
        <KeyTable label="Drive polarity" lines={keyLines(at(doc, "drive_polarity"))} />
      </DrillCard>
    </>
  );
}

function groupRows(seated: unknown) {
  const groups: [string, unknown][] = [["all", at(seated, "all")]];
  for (const by of ["by_stop", "by_level"]) {
    const g = at(seated, by);
    if (typeof g === "object" && g !== null) {
      for (const [k, v] of Object.entries(g)) groups.push([`${by.slice(3)} ${k}`, v]);
    }
  }
  return groups.map(([group, g]) => ({ group, ...(g as Record<string, unknown>) }));
}

export function StopsView({ doc }: { doc: unknown }) {
  const bursts = list(doc, "seated.bursts");
  const byIndex = (_: unknown, i: number) => i + 1;
  const [keptR, asideR] = pointsBy(bursts, byIndex, "r_ohm", "kept");
  const [keptTau, asideTau] = pointsBy(bursts, byIndex, "tau_s", "kept", MILLI);
  const median = num(doc, "seated.all.r_ohm.median");
  const tauMedian = num(doc, "seated.tau_s.median");
  const kept = bursts.filter((b) => at(b, "kept") === true).length;
  return (
    <>
      <DrillCard title="Seats" says="Where the shaft came to rest at each stop on each approach.">
        <KeyTable
          label="Stops"
          lines={scalars(at(doc, "stops")).filter(
            (l) => !l.key.startsWith("seats") && !l.key.startsWith("legs"),
          )}
        />
        <ListTable
          label="Seat reads"
          rows={list(doc, "stops.seats")}
          cols={["n", "stop", "pos_counts", "range_counts", "walk_counts"]}
        />
        <ListTable
          label="Legs"
          rows={list(doc, "stops.legs")}
          cols={["n", "kind", "toward", "from_counts", "to_counts", "secs", "top_q15", "top_v"]}
        />
        <Lines label="Path" doc={doc} path="stops.path" />
      </DrillCard>
      <DrillCard
        title="Seated R per burst"
        says="Each seated burst's R in the order the step drove them, the ones it set aside hollow, and the median of the kept ones."
      >
        <p aria-label="Bursts kept">
          {kept} of {bursts.length} bursts kept.
        </p>
        <Plot
          series={[...KEPT_ASIDE, { label: "median", mark: "line", tone: "ctx" }]}
          sets={[keptR, asideR, median === undefined ? [] : level(median, [keptR, asideR])]}
          x={{ label: "burst", unit: "" }}
          y={{ label: "R, Ω", unit: "ohm" }}
        />
      </DrillCard>
      <DrillCard
        title="Seated L/R per burst"
        says="Each seated burst's time constant L/R, and the median of the kept ones."
      >
        <Plot
          series={[...KEPT_ASIDE, { label: "median", mark: "line", tone: "ctx" }]}
          sets={[
            keptTau,
            asideTau,
            tauMedian === undefined ? [] : level(tauMedian * MILLI, [keptTau, asideTau]),
          ]}
          x={{ label: "burst", unit: "" }}
          y={{ label: "L/R, ms", unit: "ms" }}
        />
      </DrillCard>
      <DrillCard
        title="Seated groups"
        says="The medians over all kept bursts, each stop and each level."
      >
        <ListTable
          label="Groups"
          rows={groupRows(at(doc, "seated"))}
          cols={[
            "group",
            { key: "r_ohm.median", label: "R median, Ω" },
            { key: "r_ohm.n", label: "n" },
            { key: "r_ohm.sd_share", label: "R sd share" },
            { key: "r_ohm.lo", label: "R lo" },
            { key: "r_ohm.hi", label: "R hi" },
            { key: "l_h.median", label: "L median, H" },
            { key: "r_25c_ohm.median", label: "R at 25 °C median, Ω" },
          ]}
        />
        <KeyTable
          label="Seated"
          lines={scalars(at(doc, "seated")).filter(
            (l) => !/^(all|by_stop|by_level|tau_s|scales)\./.test(l.key),
          )}
        />
      </DrillCard>
      <DrillCard title="Seated bursts" says="Each seated burst as the step wrote it.">
        <ListTable
          label="Seated bursts"
          rows={bursts}
          cols={[
            "seat",
            "stop",
            "level_share",
            "k",
            "duty_q15",
            "pos",
            "ntc_c",
            "permit",
            "i_first_a",
            "move_share",
            "r_ohm",
            "l_h",
            "tau_s",
            "resid_rms_v",
            "kept",
            "aside",
          ]}
        />
        <KeyTable label="Position reads" lines={keyLines(at(doc, "position_reads"))} />
      </DrillCard>
    </>
  );
}

export function TableView({ doc }: { doc: unknown }) {
  const points = tablePoints(doc).map((y, i) => ({ x: i * 16, y }));
  const cycles = list(doc, "table.report.cycles_with_a_slow_rung").flatMap((c) => {
    const [from, to, limit] = [num(c, "from_counts"), num(c, "to_counts"), num(c, "limit_cycles")];
    const [a, b] = list(c, "cycles");
    if (from === undefined || to === undefined || typeof a !== "number" || typeof b !== "number") {
      return [];
    }
    const x = (from + to) / 2;
    return [
      {
        apart: { x, y: Math.abs(a - b) },
        limit: limit === undefined ? undefined : { x, y: limit },
      },
    ];
  });
  const bands = list(doc, "table.report.directions.bands").flatMap((b) => {
    const [x, y] = [num(b, "from_counts"), num(b, "counts_rms")];
    return x === undefined || y === undefined ? [] : [{ x, y }];
  });
  const spread = list(doc, "table.report.speed_spread").flatMap((s) => {
    const [x, y] = [num(s, "rung"), num(s, "spread")];
    return x === undefined || y === undefined ? [] : [{ x, y }];
  });
  return (
    <>
      <DrillCard
        title="The table"
        says="The correction the table adds at each of its 256 points, over the raw pot code."
      >
        <Plot
          series={[{ label: "correction", mark: "line", tone: "series1" }]}
          sets={[points]}
          x={{ label: "raw pot code", unit: "counts" }}
          y={{ label: "correction, counts", unit: "counts" }}
        />
        <KeyTable
          label="Table scale"
          lines={[
            ...keyLines({ scale: at(doc, "scale") }),
            ...keyLines({ stops_used: at(doc, "stops_used") }),
          ]}
        />
      </DrillCard>
      <DrillCard
        title="The fit"
        says="The pooled fit of every rung's position on its ripple phase, as the step wrote it."
      >
        <KeyTable label="Fit" lines={scalars(at(doc, "table.fit"))} />
        <ListTable
          label="Pieces"
          rows={list(doc, "table.fit.pieces")}
          cols={["rung", "from_counts", "to_counts", "samples", "slow_only"]}
        />
        <ListTable
          label="One fast pass out"
          rows={list(doc, "table.one_fast_pass_out")}
          cols={["rung", "pass", "line_out_counts_rms", "judged_on_counts", "why"]}
        />
      </DrillCard>
      <DrillCard
        title="Ripple cycles per stretch"
        says="Over each stretch two rungs crossed, how many ripple cycles apart they counted, beside the step's limit for that stretch."
      >
        <Plot
          series={[
            { label: "cycles apart", mark: "dots", tone: "series1" },
            { label: "limit", mark: "hollow", tone: "series2" },
          ]}
          sets={[
            cycles.map((c) => c.apart),
            cycles.flatMap((c) => (c.limit === undefined ? [] : [c.limit])),
          ]}
          x={{ label: "middle of the stretch, counts", unit: "counts" }}
          y={{ label: "cycles", unit: "cycles" }}
        />
        <ListTable
          label="Stretches"
          rows={list(doc, "table.report.cycles_with_a_slow_rung")}
          cols={["from_counts", "to_counts", "cycles", "difference_pct", "limit_cycles", "holds"]}
        />
      </DrillCard>
      <div className="grid grid-cols-2 items-start gap-4">
        <DrillCard
          title="Up against down"
          says="How far the up and down passes differ, rms per 256 raw counts."
        >
          <Plot
            series={[{ label: "up less down, rms", mark: "steps", tone: "series1" }]}
            sets={[bands]}
            x={{ label: "raw pot code", unit: "counts" }}
            y={{ label: "counts rms", unit: "counts" }}
          />
          <KeyTable
            label="Directions"
            lines={scalars(at(doc, "table.report.directions")).filter(
              (l) => !l.key.startsWith("bands"),
            )}
          />
        </DrillCard>
        <DrillCard
          title="Speed spread per rung"
          says="Each rung's (max - min) / mean of its speed over its counted stretch."
        >
          <Plot
            series={[{ label: "spread", mark: "dots", tone: "series1" }]}
            sets={[spread]}
            x={{ label: "rung", unit: "" }}
            y={{ label: "share", unit: "" }}
          />
        </DrillCard>
      </div>
      <DrillCard
        title="Passes and rungs"
        says="Each pass and each rung as the step drove and read it."
      >
        <ListTable
          label="Passes"
          rows={list(doc, "passes")}
          cols={["n", "kind", "dir", "start_counts", "end_counts"]}
        />
        <ListTable
          label="Rungs"
          rows={list(doc, "rungs")}
          cols={[
            "n",
            "pass",
            "pass_kind",
            "kind",
            "dir",
            "attempt",
            "duty_q15",
            "start_counts",
            "end_counts",
            "travel_counts",
            "pot_speed_cps",
            "on_s",
            "reach",
          ]}
        />
        <ListTable
          label="Rungs as read"
          rows={list(doc, "table.rungs")}
          cols={[
            "n",
            "pass",
            "dir",
            "read",
            "samples",
            "cycles",
            "crossings",
            "line_hz",
            "counted_over_expected",
            "speed_spread",
          ]}
        />
        <Lines label="Path" doc={doc} path="path" />
      </DrillCard>
      <DrillCard
        title="Wide codes and holes"
        says="The converter's wide-code carries the slow passes read, and the holes the step listed."
      >
        <ListTable
          label="Carries"
          rows={list(doc, "wide_codes.all.carries")}
          cols={["slot", "code", "state", "skipped", "ratio", "rows_ref", "slot_q4", "why_zero"]}
        />
        <ListTable
          label="Position holes"
          rows={list(doc, "holes.pot.holes")}
          cols={[
            "from_counts",
            "to_counts",
            "counts",
            "deg",
            "cycles",
            "shaft_deg",
            "r_max",
            "rungs",
            "dirs",
          ]}
        />
        <ListTable
          label="ADC wide-code runs"
          rows={list(doc, "holes.adc.runs")}
          cols={["from_counts", "to_counts", "counts", "deg", "above_carry"]}
        />
        <KeyTable label="Hole sources" lines={keyLines(at(doc, "holes.source"))} />
      </DrillCard>
    </>
  );
}

export function WindowView({ doc }: { doc: unknown }) {
  const h = list(doc, "fit.h_ticks");
  const r = list(doc, "fit.resid_ma");
  const resid = h.flatMap((x, i) => {
    const y = r[i];
    return typeof x === "number" && typeof y === "number" ? [{ x, y }] : [];
  });
  const onsets = list(doc, "fit.profiles").flatMap((p) => {
    const [x, y] = [num(p, "onset"), num(p, "g_pinned_ms")];
    return x === undefined || y === undefined ? [] : [{ x, y }];
  });
  const g = num(doc, "fit.g_ms");
  return (
    <>
      <DrillCard
        title="Window residuals"
        says={`The fit's current residual at each of its ${String(r.length)} window lengths (h_ticks: ${String(h.length)}).`}
      >
        <Plot
          series={[{ label: "residual", mark: "dots", tone: "series1" }]}
          sets={[resid]}
          x={{ label: "window, ticks", unit: "ticks" }}
          y={{ label: "residual, mA", unit: "mA" }}
        />
        <p aria-label="Residual count">
          {r.length} residuals over {h.length} window lengths.
        </p>
      </DrillCard>
      <DrillCard
        title="g per onset"
        says="Each onset's g with the nuisance terms pinned, and the fit's g over them all."
      >
        <Plot
          series={[
            { label: "onset", mark: "dots", tone: "series1" },
            { label: "fit g", mark: "line", tone: "ctx" },
          ]}
          sets={[onsets, g === undefined ? [] : level(g, [onsets])]}
          x={{ label: "onset", unit: "" }}
          y={{ label: "g, mS", unit: "mS" }}
        />
        <KeyTable
          label="Fit"
          lines={scalars(at(doc, "fit")).filter((l) => !/^(h_ticks|resid_ma|profiles)/.test(l.key))}
        />
        <ListTable
          label="Split"
          rows={["forward", "reverse"].map((d) => ({
            dir: d,
            ...(at(doc, `fit.split.${d}`) as object),
          }))}
          cols={["dir", "n", "g_free_ms", "g_pinned_ms"]}
        />
      </DrillCard>
      <DrillCard
        title="Onsets"
        says="Each onset as the step drove it, and which ones the gate let through."
      >
        <ListTable
          label="Onsets"
          rows={list(doc, "onsets")}
          cols={[
            "n",
            "set",
            "duty_q15",
            "start_counts",
            "on_s",
            "rows",
            "pre_rows",
            "pre_vd_max",
            "moved",
            "same_sign",
            "gated",
          ]}
        />
        <KeyTable label="Gate" lines={scalars(at(doc, "gate")).filter((l) => l.key !== "aside")} />
        <Lines label="Set aside" doc={doc} path="gate.aside" />
        <KeyTable
          label="Band and fence"
          lines={[...keyLines({ band: at(doc, "band") }), ...keyLines({ fence: at(doc, "fence") })]}
        />
      </DrillCard>
    </>
  );
}

export function SpinsView({ doc }: { doc: unknown }) {
  const coasts = list(doc, "fits.coasts");
  const [inKe, outKe] = pointsBy(coasts, "n", "ke_v_s_per_rad", "in_ke", MILLI);
  const ke = meanBand(
    (num(doc, "fits.ke.v_s_per_rad.mean") ?? 0) * MILLI,
    times(num(doc, "fits.ke.v_s_per_rad.sd"), MILLI),
    [inKe, outKe],
  );
  const runs = indexed(list(doc, "fits.inertia.runs").map((r) => times(num(r, "j_kg_m2"), G_MM2)));
  const j = meanBand(
    (num(doc, "fits.inertia.j_kg_m2.mean") ?? 0) * G_MM2,
    times(num(doc, "fits.inertia.j_kg_m2.sd"), G_MM2),
    [runs],
  );
  const open = list(doc, "fits.open_loop_line.points").flatMap((p) => {
    const [x, y] = [num(p, "rad_s"), num(p, "current_ma")];
    return x === undefined || y === undefined ? [] : [{ x, y }];
  });
  const [coulomb, viscous] = [
    num(doc, "fits.open_loop_line.coulomb_ma"),
    num(doc, "fits.open_loop_line.viscous_ma_s_per_rad"),
  ];
  const top = Math.max(0, ...open.map((p) => p.x));
  const line =
    coulomb === undefined || viscous === undefined
      ? []
      : [0, top].map((x) => ({ x, y: coulomb + viscous * x }));
  return (
    <>
      <DrillCard
        title="Ke per coast"
        says="Each coast's Ke, the ones the mean leaves out hollow, and the mean with one sd either side."
      >
        <Plot
          series={[
            { label: "in the mean", mark: "dots", tone: "series1" },
            { label: "left out", mark: "hollow", tone: "series2" },
            ...band("mean"),
          ]}
          sets={[inKe, outKe, ke.mean, ke.lo, ke.hi]}
          x={{ label: "coast", unit: "" }}
          y={{ label: "Ke, mV s/rad", unit: "mV s/rad" }}
        />
        <ListTable
          label="Coasts"
          rows={coasts}
          cols={[
            "n",
            "dir",
            "in_ke",
            "held_ticks",
            "cut",
            "e_first_v",
            "spin_rev_s",
            "rev_s",
            "decel_frac",
            "cycles",
            "ke_v_s_per_rad",
            "ke_cut_v_s_per_rad",
            "gated",
          ]}
        />
        <ListTable
          label="Ke by direction"
          rows={list(doc, "fits.ke.by_dir")}
          cols={["dir", "v_s_per_rad.mean", "v_s_per_rad.sd", "v_s_per_rad.n"]}
        />
        <ListTable
          label="Ke by held ticks"
          rows={list(doc, "fits.ke.by_held_ticks")}
          cols={["held_ticks", "v_s_per_rad.mean", "v_s_per_rad.sd", "v_s_per_rad.n"]}
        />
        <KeyTable label="Ke zero" lines={keyLines(at(doc, "fits.ke_zero"))} />
      </DrillCard>
      <div className="grid grid-cols-2 items-start gap-4">
        <DrillCard
          title="J per run-up"
          says="Each run-up's inertia, and the mean with one sd either side."
        >
          <Plot
            series={[{ label: "run-up", mark: "dots", tone: "series1" }, ...band("mean")]}
            sets={[runs, j.mean, j.lo, j.hi]}
            x={{ label: "run-up", unit: "" }}
            y={{ label: "J, g mm²", unit: "g mm^2" }}
          />
          <ListTable
            label="Run-ups"
            rows={list(doc, "fits.inertia.runs")}
            cols={["dir", "j_kg_m2", "fits_kept", "windows_flagged"]}
          />
        </DrillCard>
        <DrillCard
          title="Open-loop friction"
          says="The steady winding current at each level and direction's steady speed, and the step's line through them."
        >
          <Plot
            series={[
              { label: "steady", mark: "dots", tone: "series1" },
              { label: "line", mark: "line", tone: "ctx" },
            ]}
            sets={[open, line]}
            x={{ label: "motor speed, rad/s", unit: "rad/s" }}
            y={{ label: "current, mA", unit: "mA" }}
          />
          <ListTable
            label="Coast friction"
            rows={list(doc, "fits.inertia.coast_friction")}
            cols={["dir", "a0_rad_s2", "a1_per_s", "tc_n_m", "b_n_m_s_per_rad", "rms_n_m", "bins"]}
          />
        </DrillCard>
      </div>
      <DrillCard title="Spins" says="Each spin as the step drove it.">
        <ListTable
          label="Spins"
          rows={list(doc, "spins")}
          cols={[
            "n",
            "pilot",
            "level_share",
            "dir",
            "attempt",
            "duty_q15",
            "volts",
            "start_counts",
            "end_counts",
            "travel_counts",
            "pot_speed_cps",
            "t90_s",
            "coast_counts",
            "coast_s",
          ]}
        />
        <ListTable
          label="Steady spins"
          rows={list(doc, "fits.steady_spins")}
          cols={[
            "n",
            "level_share",
            "dir",
            "rows",
            "line_hz",
            "rev_s",
            "pot_cps",
            "current_raw_ma",
            "current_ma",
          ]}
        />
        <Lines label="Path" doc={doc} path="path" />
      </DrillCard>
    </>
  );
}

export function CruiseView({ doc }: { doc: unknown }) {
  const up: Point[] = [];
  const down: Point[] = [];
  const aside: Point[] = [];
  for (const l of list(doc, "legs")) {
    const [goal, held] = [num(l, "goal_cps"), num(l, "current_held_ma")];
    if (goal === undefined || held === undefined) continue;
    const p = { x: Math.abs(goal), y: held };
    (at(l, "valid") !== true ? aside : goal >= 0 ? up : down).push(p);
  }
  const [coulomb, perK] = [num(doc, "line.coulomb_ma"), num(doc, "line.viscous_ma_per_kcps")];
  const top = Math.max(0, ...[...up, ...down, ...aside].map((p) => p.x));
  const line =
    coulomb === undefined || perK === undefined
      ? []
      : [0, top].map((x) => ({ x, y: coulomb + (perK * x) / 1000 }));
  const speeds = list(doc, "line.speeds");
  const of = (key: string) =>
    speeds.flatMap((s) => {
      const [x, y] = [num(s, "goal_cps"), num(s, key)];
      return x === undefined || y === undefined ? [] : [{ x, y }];
    });
  const resid = of("residual_ma");
  return (
    <>
      <DrillCard
        title="Held current per leg"
        says="Each cruise leg's held current against its goal speed, up and down, the legs set aside hollow, and the step's line."
      >
        <Plot
          series={[
            { label: "up", mark: "dots", tone: "series1" },
            { label: "down", mark: "dots", tone: "series2" },
            { label: "set aside", mark: "hollow", tone: "series3" },
            { label: "line", mark: "line", tone: "ctx" },
          ]}
          sets={[up, down, aside, line]}
          x={{ label: "goal speed, counts/s", unit: "counts/s" }}
          y={{ label: "held current, mA", unit: "mA" }}
        />
        <KeyTable
          label="Line"
          lines={scalars(at(doc, "line")).filter((l) => !/^(speeds|goal_cps)/.test(l.key))}
        />
      </DrillCard>
      <div className="grid grid-cols-2 items-start gap-4">
        <DrillCard
          title="Residual per speed"
          says="The mean held current at each speed less the line."
        >
          <Plot
            series={[
              { label: "residual", mark: "dots", tone: "series1" },
              { label: "zero", mark: "line", tone: "ctx" },
            ]}
            sets={[resid, level(0, [resid])]}
            x={{ label: "goal speed, counts/s", unit: "counts/s" }}
            y={{ label: "residual, mA", unit: "mA" }}
          />
        </DrillCard>
        <DrillCard title="Up against down" says="The mean held current up and down at each speed.">
          <Plot
            series={[
              { label: "up", mark: "dots", tone: "series1" },
              { label: "down", mark: "hollow", tone: "series2" },
            ]}
            sets={[of("up_ma"), of("down_ma")]}
            x={{ label: "goal speed, counts/s", unit: "counts/s" }}
            y={{ label: "current, mA", unit: "mA" }}
          />
        </DrillCard>
      </div>
      <DrillCard title="Legs" says="Each leg as the step drove and read it.">
        <ListTable
          label="Speeds"
          rows={speeds}
          cols={["goal_cps", "legs", "current_ma", "residual_ma", "up_ma", "down_ma"]}
        />
        <ListTable
          label="Legs"
          rows={list(doc, "legs")}
          cols={[
            "goal_cps",
            "capture",
            "valid",
            "set_aside",
            "rows",
            "held_in_ms",
            "read_share",
            "sd_in_ma",
            "current_read_ma",
            "current_held_ma",
            "line_installed_ma",
            "integrator_ma",
            "speed_cps",
          ]}
        />
        <KeyTable
          label="Cruise plan"
          lines={[
            ...keyLines({ travel: at(doc, "travel") }),
            ...keyLines({ bounds: at(doc, "bounds") }),
            ...keyLines({ fault: at(doc, "fault"), recovered: at(doc, "recovered") }),
          ]}
        />
      </DrillCard>
    </>
  );
}

function SmallMove({
  moves,
  name,
  trace,
  why,
}: {
  moves: Moves;
  name: string;
  trace?: MoveTrace;
  why?: string;
}) {
  const tokens = useChartTokens();
  const options = useMemo<ChartOptions>(
    () => ({
      legend: { show: false },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false } },
      axes: [axis(tokens, "s"), axis(tokens, "°", { size: 48 })],
      series: [
        {},
        seriesOf({ label: "position", mark: "line", color: tokens.series1 }, tokens.surface),
        seriesOf({ label: "goal", mark: "steps", color: tokens.ctx }, tokens.surface),
      ],
    }),
    [tokens],
  );
  const data = useMemo<uPlot.AlignedData | undefined>(
    () => (trace === undefined ? undefined : [trace.t, trace.deg, trace.goal]),
    [trace],
  );
  const score = moves.moves.find((m) => m.name === name);
  return (
    <figure role="group" aria-label={`Move ${name}`} className="flex flex-col gap-1">
      <figcaption className="text-sm font-medium">{name}</figcaption>
      {data !== undefined ? (
        <Chart options={options} data={data} className="h-36" />
      ) : why !== undefined ? (
        <p className="text-sm text-text-3">{why}</p>
      ) : (
        <Skeleton className="h-36 w-full" />
      )}
      {score !== undefined && (
        <p className="text-xs text-text-2 tabular-nums">
          overshoot {score.overshootDeg?.toFixed(2) ?? "-"}°, rest error{" "}
          {score.restErrorDeg?.toFixed(2) ?? "-"}°, settle {score.settleS?.toFixed(3) ?? "-"} s
        </p>
      )}
    </figure>
  );
}

function SmallMoves({
  uid,
  utc,
  moves,
  folder,
}: {
  uid: string;
  utc: string;
  moves: Moves;
  folder: string;
}) {
  const [traces, setTraces] = useState<{
    key: string;
    by: Map<string, { trace?: MoveTrace; why?: string }>;
  }>();
  const key = `${runAt(uid, utc)}/${folder}`;
  useEffect(() => {
    let live = true;
    void (async () => {
      const by = new Map<string, { trace?: MoveTrace; why?: string }>();
      try {
        const root = await storage();
        const files = await moveCaptures(root, uid, utc, folder);
        for (const m of moves.moves) {
          const mine = files.filter((f) => f.move === m.name);
          const first = mine[0];
          if (first === undefined) {
            by.set(m.name, { why: "The run folder holds no capture of this move." });
            continue;
          }
          const rows = new Map<string, (number | null)[]>();
          const missing: string[] = [];
          for (const f of mine) {
            const bytes = await readFile(root, f.file);
            if (bytes === null) {
              missing.push(f.file.slice(runAt(uid, utc).length + 1));
              continue;
            }
            for (const [k, v] of await readRows(bytes)) rows.set(k, [...(rows.get(k) ?? []), ...v]);
          }
          if (missing.length > 0) {
            by.set(m.name, { why: `Trimmed: the run folder does not hold ${missing.join(", ")}.` });
            continue;
          }
          by.set(m.name, {
            trace: moveTrace(rows, {
              cal: moves.cal,
              points: moves.points,
              slots: moves.slots,
              currentZeroCounts: moves.currentZeroCounts,
              countsPerA: moves.countsPerA,
              tickHz: first.tickHz,
              fromCounts: m.fromCounts,
              goalCounts: m.goalCounts,
            }),
          });
        }
      } catch (e) {
        for (const m of moves.moves) if (!by.has(m.name)) by.set(m.name, { why: message(e) });
      }
      if (live) setTraces({ key, by });
    })();
    return () => {
      live = false;
    };
  }, [uid, utc, folder, moves, key]);
  const shown = traces?.key === key ? traces.by : undefined;
  const tokens = useChartTokens();
  const legend = useMemo<Series[]>(
    () => [
      { label: "position", mark: "line", color: tokens.series1 },
      { label: "goal", mark: "steps", color: tokens.ctx },
    ],
    [tokens],
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
        {moves.moves.map((m) => (
          <SmallMove
            key={m.name}
            moves={moves}
            name={m.name}
            trace={shown?.get(m.name)?.trace}
            why={shown?.get(m.name)?.why}
          />
        ))}
      </div>
      <Legend series={legend} />
    </div>
  );
}

/** A self-test's results: its moves drawn, its scores and its checks as the tool wrote them. */
export function VerifyView({
  uid,
  utc,
  verify,
  set,
  posLut,
  at0,
}: {
  uid: string;
  utc: string;
  verify: unknown;
  set: unknown;
  posLut: unknown;
  /** The folder the self-test wrote into: `final/` or a try's `tune/tries/NN/`. */
  at0: string;
}) {
  const moves = useMemo(() => movesOf(set, verify, posLut, at0), [set, verify, posLut, at0]);
  return (
    <>
      <DrillCard
        title="Moves"
        says={`The self-test's moves: the horn's angle against its goal, from ${at0}captures/verify/.`}
      >
        {typeof moves === "string" ? (
          <p className="text-text-3">{moves}</p>
        ) : (
          <SmallMoves uid={uid} utc={utc} moves={moves} folder={`${at0}captures/verify`} />
        )}
      </DrillCard>
      <DrillCard
        title="Scores"
        says="Each move's scores and each small step, as the self-test wrote them."
      >
        <ListTable
          label="Move scores"
          rows={list(verify, "moves")}
          cols={[
            "name",
            "from_counts",
            "goal_counts",
            "step_deg",
            "overshoot_deg",
            "overshoot_bound_deg",
            "settle_s",
            "tail_driven_share",
            "quiet",
            "rest_error_deg",
            "current_peak_a",
            "follow_peak_deg",
          ]}
        />
        <ListTable
          label="Small steps"
          rows={list(verify, "small_steps")}
          cols={[
            "move",
            "goal_counts",
            "step_counts",
            "error_start_counts",
            "error_end_counts",
            "travel_counts",
            "fault",
            "failed",
          ]}
        />
        <KeyTable
          label="Bounds and units"
          lines={[
            ...keyLines({ bounds: at(verify, "bounds") }),
            ...keyLines({ units: at(verify, "units") }),
          ]}
        />
      </DrillCard>
    </>
  );
}

function tryFiles(rows: readonly TryRow[]): string[] {
  return rows.flatMap((t) => [`${tryDir(t.n)}/results/verify.json`, `${tryDir(t.n)}/set.json`]);
}

export function TuneView({ uid, utc, files }: { uid: string; utc: string; files: RunFiles }) {
  const tune = files.get("tune/tune.json");
  const backOff = files.get("tune/back-off.json");
  const rows = useMemo(() => tries(tune, backOff), [tune, backOff]);
  const accepted = acceptedTry(tune, backOff);
  const paths = useMemo(() => ["inputs/pos_lut.json", ...tryFiles(rows)], [rows]);
  const { data: tryDocs } = useRunFiles(uid, utc, paths);
  const [chosen, setChosen] = useState<string>();
  const shownTry = chosen ?? String(accepted ?? rows.at(-1)?.n ?? "");
  const point = (t: TryRow, y: number | undefined) => (y === undefined ? [] : [{ x: t.n, y }]);
  const restBound = num(
    tryDocs?.get(`${tryDir(rows[0]?.n ?? 1)}/results/verify.json`),
    "bounds.rest_deg",
  );
  const others = rows.filter((t) => t.n !== accepted);
  const mine = rows.filter((t) => t.n === accepted);
  const rest = [
    others.flatMap((t) => point(t, t.restErrorDeg)),
    mine.flatMap((t) => point(t, t.restErrorDeg)),
  ];
  const over = [
    others.flatMap((t) => point(t, t.overshootShare)),
    mine.flatMap((t) => point(t, t.overshootShare)),
  ];
  const marks: PlotSeries[] = [
    { label: "try", mark: "dots", tone: "series1" },
    { label: "the try the run ended on", mark: "hollow", tone: "series2" },
  ];
  const n = Number(shownTry);
  return (
    <>
      <DrillCard
        title="Tries"
        says="Each try of the speed gain the tune installed and checked, then the back-off's after the final check, as the tool wrote them."
      >
        <ListTable
          label="Tries"
          rows={rows}
          cols={[
            { key: "n", label: "try" },
            { key: "from", label: "from" },
            { key: "vKp", label: "v_kp_q88" },
            { key: "kp", label: "kp" },
            { key: "shareOfStart", label: "share of start" },
            { key: "verdict", label: "the tool's word" },
            { key: "failedOn", label: "failed on" },
            { key: "restErrorDeg", label: "worst rest error, °" },
            { key: "overshootShare", label: "worst overshoot, share of bound" },
            { key: "followPeakCounts", label: "worst follow peak, counts" },
            { key: "next", label: "next" },
            { key: "why", label: "why" },
            { key: "after", label: "after" },
          ]}
        />
        <p aria-label="Accepted try">
          {accepted === undefined
            ? "No try was accepted."
            : `The run ended on try ${String(accepted)}, at v_kp_q88 ${rows.find((t) => t.n === accepted)?.vKp ?? "?"}.`}
        </p>
        <KeyTable
          label="Tune"
          lines={[
            ...keyLines({
              starting_gain: at(tune, "starting_gain"),
              starting_gain_nominal: at(tune, "starting_gain_nominal"),
              share: at(tune, "share"),
              tries_allowed: at(tune, "tries_allowed"),
              accepted: at(tune, "accepted"),
              ended: at(tune, "ended"),
              put_back: at(tune, "put_back"),
            }),
            ...(backOff === undefined
              ? []
              : keyLines({
                  back_off: { after: at(backOff, "after"), accepted: at(backOff, "accepted") },
                })),
          ]}
        />
      </DrillCard>
      <div className="grid grid-cols-2 items-start gap-4">
        <DrillCard
          title="Rest error per try"
          says="Each try's worst rest error, and the self-test's bound on it."
        >
          <Plot
            series={[...marks, { label: "bound", mark: "dashed", tone: "ctx" }]}
            sets={[...rest, restBound === undefined ? [] : level(restBound, rest)]}
            x={{ label: "try", unit: "" }}
            y={{ label: "rest error, °", unit: "deg" }}
          />
        </DrillCard>
        <DrillCard
          title="Overshoot per try"
          says="Each try's worst overshoot as a share of its bound."
        >
          <Plot
            series={marks}
            sets={over}
            x={{ label: "try", unit: "" }}
            y={{ label: "share of bound", unit: "" }}
          />
        </DrillCard>
      </div>
      <DrillCard title="One try" says="A try's self-test: its checks, moves and scores.">
        <Select value={shownTry} onValueChange={setChosen}>
          <SelectTrigger aria-label="Try" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {rows.map((t) => (
              <SelectItem key={t.n} value={String(t.n)}>
                try {t.n}, v_kp_q88 {t.vKp}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tryDocs === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <ChecksTable doc={tryDocs.get(`${tryDir(n)}/results/verify.json`)} />
        )}
      </DrillCard>
      {tryDocs !== undefined && Number.isFinite(n) && (
        <>
          <VerifyView
            uid={uid}
            utc={utc}
            verify={tryDocs.get(`${tryDir(n)}/results/verify.json`)}
            set={tryDocs.get(`${tryDir(n)}/set.json`)}
            posLut={tryDocs.get("inputs/pos_lut.json")}
            at0={`${tryDir(n)}/`}
          />
          <CapturesCard uid={uid} utc={utc} dir={`${tryDir(n)}/captures/verify`} />
        </>
      )}
    </>
  );
}
