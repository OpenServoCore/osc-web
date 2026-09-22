import type { Field, Variant } from "@openservocore/client";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  buildTable,
  formatRow,
  labelParts,
  matchRows,
  searchIndex,
  summarizeBlob,
  SEARCH_LIMIT,
  type Row,
  type TabName,
} from "./table-model";

interface RawDescriptor {
  fields: (Omit<Field, "variants"> & { variants?: Variant[] })[];
}

const raw = JSON.parse(
  readFileSync(
    new URL("../../../open-servo-core/descriptors/osc-servo/0.1.json", import.meta.url),
    "utf8",
  ),
) as RawDescriptor;
const fields: Field[] = raw.fields.map((f) => ({ ...f, variants: f.variants ?? [] }));

const model = buildTable({ fields: () => fields });

function rowOf(name: string): Row {
  for (const tab of model.tabs)
    for (const group of tab.groups)
      for (const row of group.rows) if (row.field.name === name) return row;
  throw new Error(`no row ${name}`);
}

function placement(name: string): [TabName, string] {
  for (const tab of model.tabs)
    for (const group of tab.groups)
      if (group.rows.some((r) => r.field.name === name)) return [tab.name, group.label];
  throw new Error(`no row ${name}`);
}

describe("buildTable", () => {
  test("four tabs with the spec's groups in order", () => {
    expect(model.tabs.map((t) => t.name)).toEqual([
      "Settings",
      "Calibration",
      "Board",
      "Live values",
    ]);
    expect(model.tabs.map((t) => t.groups.map((g) => g.label))).toEqual([
      ["Identity and bus", "Motion limits", "Control loops", "Safety", "Thermal"],
      ["Calibration"],
      ["Board constants", "Motor model"],
      ["Status", "Estimates", "Raw samples", "Commands", "Profile/capture"],
    ]);
  });

  test("every field lands in exactly one row, in address order within a group", () => {
    const rows = model.tabs.flatMap((t) => t.groups.flatMap((g) => g.rows));
    expect(rows).toHaveLength(fields.length);
    expect(new Set(rows.map((r) => r.field.addr)).size).toBe(fields.length);
    for (const group of model.tabs.flatMap((t) => t.groups)) {
      const addrs = group.rows.map((r) => r.field.addr);
      expect(addrs).toEqual([...addrs].sort((a, b) => a - b));
    }
  });

  test("help only on the five groups the spec allows", () => {
    const withHelp = model.tabs.flatMap((t) => t.groups.filter((g) => g.help).map((g) => g.label));
    expect(withHelp).toEqual([
      "Control loops",
      "Safety",
      "Thermal",
      "Motor model",
      "Profile/capture",
    ]);
  });

  test("collapsed by default where the spec says so", () => {
    const collapsed = model.tabs.flatMap((t) =>
      t.groups.filter((g) => !g.expanded).map((g) => g.label),
    );
    expect(collapsed).toEqual([
      "Identity and bus",
      "Control loops",
      "Thermal",
      "Motor model",
      "Profile/capture",
    ]);
  });

  test("settings follow the config blocks", () => {
    expect(placement("model_number")).toEqual(["Settings", "Identity and bus"]);
    expect(placement("response_deadline_us")).toEqual(["Settings", "Identity and bus"]);
    expect(placement("pos_max_soft_counts")).toEqual(["Settings", "Motion limits"]);
    expect(placement("i_kp_q88")).toEqual(["Settings", "Control loops"]);
    expect(placement("j_ff_q88")).toEqual(["Settings", "Control loops"]);
    expect(placement("accel_limit_q88")).toEqual(["Settings", "Control loops"]);
    expect(placement("l1_q016")).toEqual(["Settings", "Control loops"]);
    expect(placement("current_limit_counts")).toEqual(["Settings", "Safety"]);
    expect(placement("openloop_zero_brake")).toEqual(["Settings", "Safety"]);
    expect(placement("pos_error_counts")).toEqual(["Settings", "Safety"]);
    expect(placement("sensor_bad_count")).toEqual(["Settings", "Safety"]);
    expect(placement("cutoff_cc")).toEqual(["Settings", "Thermal"]);
    expect(placement("rtherm_omega_max_cps")).toEqual(["Settings", "Thermal"]);
  });

  test("id and baud are read-only with links; the deadline is editable", () => {
    expect(rowOf("id")).toMatchObject({ editable: false, link: "servo" });
    expect(rowOf("baud_rate_idx")).toMatchObject({ editable: false, link: "connection" });
    expect(rowOf("response_deadline_us")).toMatchObject({ editable: true });
    expect(rowOf("response_deadline_us").link).toBeUndefined();
    expect(rowOf("model_number")).toMatchObject({ editable: false });
    expect(rowOf("model_number").link).toBeUndefined();
  });

  test("calibration is the six host-facing rows, read-only with a servo link", () => {
    const [group] = model.tabs[1]?.groups ?? [];
    expect(group?.rows.map((r) => r.field.name)).toEqual([
      "raw_min",
      "raw_max",
      "lut_corr",
      "angle_min_cdeg",
      "angle_max_cdeg",
      "gear_ratio_centi",
    ]);
    for (const row of group?.rows ?? []) {
      expect(row.editable).toBe(false);
      expect(row.link).toBe("servo");
    }
    expect(rowOf("lut_corr").blob).toBe(true);
  });

  test("board facts and the motor model", () => {
    expect(placement("shunt_r_mohm")).toEqual(["Board", "Board constants"]);
    expect(placement("v_window_min_ticks")).toEqual(["Board", "Board constants"]);
    expect(placement("ntc_beta")).toEqual(["Board", "Board constants"]);
    expect(placement("vmotor_bias_nom_counts")).toEqual(["Board", "Board constants"]);
    expect(rowOf("shunt_r_mohm").editable).toBe(false);
    expect(rowOf("vdd_mv").editable).toBe(true);
    expect(placement("r0_q12")).toEqual(["Board", "Motor model"]);
    expect(placement("mu_q016")).toEqual(["Board", "Motor model"]);
    expect(placement("ke_uvs_per_rad")).toEqual(["Board", "Motor model"]);
    expect(placement("ke_vpc_q")).toEqual(["Board", "Motor model"]);
    expect(rowOf("r0_q12").editable).toBe(true);
  });

  test("live values follow the telemetry, control, profile and burst blocks", () => {
    expect(placement("fault_flags")).toEqual(["Live values", "Status"]);
    expect(placement("trim_steps")).toEqual(["Live values", "Status"]);
    expect(placement("framing_drop_count")).toEqual(["Live values", "Status"]);
    expect(placement("fault_code")).toEqual(["Live values", "Status"]);
    expect(placement("theta_hat_q16")).toEqual(["Live values", "Estimates"]);
    expect(placement("sample_tick")).toEqual(["Live values", "Estimates"]);
    expect(placement("pos")).toEqual(["Live values", "Raw samples"]);
    expect(placement("vmotor_bias_counts")).toEqual(["Live values", "Raw samples"]);
    expect(placement("agg_seq")).toEqual(["Live values", "Raw samples"]);
    expect(placement("torque_enable")).toEqual(["Live values", "Commands"]);
    expect(placement("goal_position")).toEqual(["Live values", "Commands"]);
    expect(placement("boot_mode")).toEqual(["Live values", "Commands"]);
    expect(placement("chans")).toEqual(["Live values", "Commands"]);
    expect(placement("words")).toEqual(["Live values", "Profile/capture"]);
    expect(placement("page_echo")).toEqual(["Live values", "Profile/capture"]);
    expect(placement("frame_len")).toEqual(["Live values", "Profile/capture"]);
    expect(rowOf("goal_position").editable).toBe(true);
    expect(rowOf("pos").editable).toBe(false);
    expect(rowOf("words")).toMatchObject({ blob: true, editable: true });
    expect(rowOf("samples")).toMatchObject({ blob: true, editable: false });
  });

  test("rows carry the field kind", () => {
    expect(rowOf("mode").kind).toMatchObject({ kind: "enum" });
    expect(rowOf("torque_enable").kind).toEqual({ kind: "bool" });
    expect(rowOf("goal_position").kind).toMatchObject({ kind: "number", signed: true, width: 4 });
    expect(rowOf("lut_corr").kind).toEqual({ kind: "raw", width: 110 });
  });
});

describe("labelParts", () => {
  test("splits a unit suffix into the hint", () => {
    expect(labelParts("pos_min_phys_counts")).toEqual({ label: "Pos min phys", hint: "counts" });
    expect(labelParts("velocity_limit_cps")).toEqual({
      label: "Velocity limit",
      hint: "counts/s",
    });
    expect(labelParts("i_kp_q88")).toEqual({ label: "I kp", hint: "Q8.8" });
    expect(labelParts("l1_q016")).toEqual({ label: "L1", hint: "Q0.16" });
    expect(labelParts("duty_max_q15")).toEqual({ label: "Duty max", hint: "Q15" });
    expect(labelParts("derate_start_cc")).toEqual({ label: "Derate start", hint: "0.01 C" });
    expect(labelParts("angle_min_cdeg")).toEqual({ label: "Angle min", hint: "0.01 deg" });
    expect(labelParts("vdd_mv")).toEqual({ label: "Vdd", hint: "mV" });
    expect(labelParts("response_deadline_us")).toEqual({
      label: "Response deadline",
      hint: "us",
    });
    expect(labelParts("ke_uvs_per_rad")).toEqual({ label: "Ke", hint: "uV.s/rad" });
    expect(labelParts("vbus_raw")).toEqual({ label: "Vbus", hint: "raw counts" });
    expect(labelParts("shunt_r_mohm")).toEqual({ label: "Shunt r", hint: "mOhm" });
  });

  test("leaves names without a unit suffix whole", () => {
    expect(labelParts("mode")).toEqual({ label: "Mode" });
    expect(labelParts("raw_min")).toEqual({ label: "Raw min" });
    expect(labelParts("fault_flags")).toEqual({ label: "Fault flags" });
    expect(labelParts("crc_fail_count")).toEqual({ label: "Crc fail count" });
    expect(labelParts("sensor_delta_max")).toEqual({ label: "Sensor delta max" });
  });

  test("a row keeps the raw register name beside the label", () => {
    const row = rowOf("stall_omega_max_cps");
    expect(row.field.name).toBe("stall_omega_max_cps");
    expect(row.label).toBe("Stall omega max");
    expect(row.hint).toBe("counts/s");
  });
});

describe("values", () => {
  test("summarizeBlob gives the size and a hex prefix", () => {
    expect(summarizeBlob(new Uint8Array(0))).toBe("0 bytes");
    expect(summarizeBlob(new Uint8Array([0xab]))).toBe("1 byte, ab");
    expect(summarizeBlob(new Uint8Array([1, 2, 3, 4]))).toBe("4 bytes, 01 02 03 04");
    expect(summarizeBlob(new Uint8Array(110))).toBe("110 bytes, 00 00 00 00 ..");
  });

  test("formatRow summarizes blobs and formats everything else", () => {
    expect(formatRow(rowOf("lut_corr"), new Uint8Array(110))).toBe("110 bytes, 00 00 00 00 ..");
    expect(formatRow(rowOf("goal_position"), -1200)).toBe("-1200");
    expect(formatRow(rowOf("mode"), 3)).toBe("Position");
    expect(formatRow(rowOf("torque_enable"), true)).toBe("On");
  });
});

describe("search", () => {
  const index = searchIndex(model);

  test("one entry per row in table order", () => {
    expect(index).toHaveLength(fields.length);
    expect(index[0]).toEqual({
      label: "Model number",
      name: "model_number",
      tab: "Settings",
      group: "Identity and bus",
      addr: 0,
    });
    const goalAt = index.findIndex((e) => e.name === "goal_position");
    const posAt = index.findIndex((e) => e.name === "pos");
    expect(goalAt).toBeGreaterThan(posAt);
  });

  test("matches label and register name case-insensitively", () => {
    expect(matchRows(index, "GOAL").map((e) => e.name)).toEqual([
      "goal_duty",
      "goal_position",
      "goal_velocity",
      "goal_current",
    ]);
    expect(matchRows(index, "shunt r").map((e) => e.name)).toEqual(["shunt_r_mohm"]);
    expect(matchRows(index, "  stall omega ").map((e) => e.name)).toEqual(["stall_omega_max_cps"]);
  });

  test("matches an exact hex address", () => {
    expect(matchRows(index, "0x020").map((e) => e.name)).toEqual(["pos_min_phys_counts"]);
    expect(matchRows(index, "020").map((e) => e.name)).toEqual(["pos_min_phys_counts"]);
    expect(matchRows(index, "0X188").map((e) => e.name)).toEqual(["goal_position"]);
    expect(matchRows(index, "0x20")).toEqual([]);
  });

  test("empty query and a hit cap", () => {
    expect(matchRows(index, "")).toEqual([]);
    expect(matchRows(index, "   ")).toEqual([]);
    const hits = matchRows(index, "counts");
    expect(hits).toHaveLength(SEARCH_LIMIT);
    expect(hits.map((e) => e.name)).toEqual(
      index
        .filter((e) => e.name.includes("counts"))
        .slice(0, SEARCH_LIMIT)
        .map((e) => e.name),
    );
  });
});
