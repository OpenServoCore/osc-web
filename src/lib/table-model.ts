import type { Descriptor, Field } from "@openservocore/client";
import { fieldKind, formatValue, type EditValue, type FieldKind } from "./edit";
import { hexAddr } from "./format";

export type TabName = "Settings" | "Calibration" | "Board" | "Live values";

export type Link = "connection" | "servo";

export interface Row {
  field: Field;
  label: string;
  hint?: string;
  kind: FieldKind;
  editable: boolean;
  link?: Link;
  blob: boolean;
}

export interface Group {
  label: string;
  help: boolean;
  expanded: boolean;
  rows: Row[];
}

export interface Tab {
  name: TabName;
  groups: Group[];
}

export interface TableModel {
  tabs: Tab[];
}

export interface SearchEntry {
  label: string;
  name: string;
  tab: TabName;
  group: string;
  addr: number;
}

export const SEARCH_LIMIT = 20;

interface GroupSpec {
  label: string;
  help?: true;
  collapsed?: true;
  link?: Link;
  blocks: readonly number[];
}

interface TabSpec {
  name: TabName;
  groups: readonly GroupSpec[];
}

// Start addresses of the firmware blocks (regions/*.rs). A block runs to
// the next block's start, so a region's reserved tail follows the block in
// front of it and every address has a home.
const CONFIG_COMMON = 0x000;
const POS_LIMITS = 0x020;
const LOOP_CURRENT = 0x030;
const LOOP_VELOCITY = 0x038;
const LOOP_POSITION = 0x040;
const LIMITS = 0x048;
const THERMAL = 0x05c;
const FUSION = 0x068;
const FAULT_CFG = 0x06e;
const POT_LUT = 0x080;
const SENSE = 0x0f2;
const WINDING = 0x102;
const MOTOR = 0x10a;
const KINEMATICS = 0x11a;
const SENSE_EXT = 0x120;
const LIFECYCLE = 0x180;
const SYSTEM = 0x194;
const BURST_REQUEST = 0x196;
const TEL_COMMON = 0x200;
const TEL_MODE = 0x220;
const ESTIMATES = 0x224;
const SENSORS = 0x240;
const IDENT = 0x25a;
const PROFILE = 0x280;
const BURST_WINDOW = 0x2c0;

const IDENTITY: GroupSpec = { label: "Identity and bus", collapsed: true, blocks: [CONFIG_COMMON] };

const TABS: readonly TabSpec[] = [
  {
    name: "Settings",
    groups: [
      IDENTITY,
      { label: "Motion limits", blocks: [POS_LIMITS] },
      // The observer gains close the same loops the PI gains do.
      {
        label: "Control loops",
        help: true,
        collapsed: true,
        blocks: [LOOP_CURRENT, LOOP_VELOCITY, LOOP_POSITION, FUSION],
      },
      // Fault thresholds are the other half of the stall and trip policy.
      { label: "Safety", help: true, blocks: [LIMITS, FAULT_CFG] },
      { label: "Thermal", help: true, collapsed: true, blocks: [THERMAL] },
    ],
  },
  {
    name: "Calibration",
    groups: [{ label: "Calibration", link: "servo", blocks: [POT_LUT, KINEMATICS] }],
  },
  {
    name: "Board",
    groups: [
      { label: "Board constants", blocks: [SENSE, SENSE_EXT] },
      { label: "Motor model", help: true, collapsed: true, blocks: [WINDING, MOTOR] },
    ],
  },
  {
    name: "Live values",
    groups: [
      // Mode detail is the fault code's neighbour, not an estimate.
      { label: "Status", blocks: [TEL_COMMON, TEL_MODE] },
      { label: "Estimates", blocks: [ESTIMATES] },
      // Identification aggregates are windowed raw counts, not estimator output.
      { label: "Raw samples", blocks: [SENSORS, IDENT] },
      { label: "Commands", blocks: [LIFECYCLE, SYSTEM, BURST_REQUEST] },
      { label: "Profile/capture", help: true, collapsed: true, blocks: [PROFILE, BURST_WINDOW] },
    ],
  },
];

const LINKS: ReadonlyMap<string, Link> = new Map([
  ["id", "servo"],
  ["baud_rate_idx", "connection"],
]);

const UNITS: ReadonlyMap<string, string> = new Map([
  ["uvs_per_rad", "uV.s/rad"],
  ["counts", "counts"],
  ["cps", "counts/s"],
  ["cdeg", "0.01 deg"],
  ["centi", "x0.01"],
  ["cc", "0.01 C"],
  ["mohm", "mOhm"],
  ["ohm", "ohm"],
  ["milli", "x0.001"],
  ["mv", "mV"],
  ["us", "us"],
  ["ms", "ms"],
  ["hz", "Hz"],
  ["ticks", "ticks"],
  ["raw", "raw counts"],
  ["q88", "Q8.8"],
  ["q412", "Q4.12"],
  ["q15", "Q15"],
  ["q016", "Q0.16"],
  ["q12", "Q4.12"],
  ["q313", "Q3.13"],
  ["q16", "Q16"],
  ["q", "fixed point"],
]);

export function labelParts(name: string): { label: string; hint?: string } {
  let suffix = "";
  for (const key of UNITS.keys()) {
    if (key.length > suffix.length && name.endsWith(`_${key}`)) suffix = key;
  }
  const hint = UNITS.get(suffix);
  const stem = hint === undefined ? name : name.slice(0, -suffix.length - 1);
  const words = stem.replaceAll("_", " ");
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return hint === undefined ? { label } : { label, hint };
}

interface Slot {
  start: number;
  spec: GroupSpec;
}

const SLOTS: readonly Slot[] = TABS.flatMap((tab) =>
  tab.groups.flatMap((spec) => spec.blocks.map((start) => ({ start, spec }))),
).sort((a, b) => a.start - b.start);

function locate(addr: number): GroupSpec {
  return SLOTS.reduce((hit, slot) => (slot.start <= addr ? slot.spec : hit), IDENTITY);
}

function toRow(field: Field, spec: GroupSpec): Row {
  const link = spec.link ?? LINKS.get(field.name);
  const { label, hint } = labelParts(field.name);
  return {
    field,
    label,
    ...(hint !== undefined && { hint }),
    kind: fieldKind(field),
    editable: field.access === "rw" && link === undefined,
    ...(link !== undefined && { link }),
    blob: field.kind === "bytes",
  };
}

export function buildTable(descriptor: Pick<Descriptor, "fields">): TableModel {
  const fields = [...descriptor.fields()].sort((a, b) => a.addr - b.addr);
  const owner = new Map(fields.map((field) => [field, locate(field.addr)]));
  const tabs = TABS.map((tab) => ({
    name: tab.name,
    groups: tab.groups.map((spec) => ({
      label: spec.label,
      help: spec.help === true,
      expanded: spec.collapsed !== true,
      rows: fields.filter((field) => owner.get(field) === spec).map((field) => toRow(field, spec)),
    })),
  }));
  return { tabs };
}

export function summarizeBlob(bytes: Uint8Array): string {
  const size = `${bytes.length} byte${bytes.length === 1 ? "" : "s"}`;
  if (bytes.length === 0) return size;
  const head = Array.from(bytes.subarray(0, 4), (b) => b.toString(16).padStart(2, "0")).join(" ");
  return `${size}, ${head}${bytes.length > 4 ? " .." : ""}`;
}

export function formatRow(row: Row, value: EditValue): string {
  return row.blob && value instanceof Uint8Array
    ? summarizeBlob(value)
    : formatValue(row.kind, value);
}

export function searchIndex(model: TableModel): SearchEntry[] {
  return model.tabs.flatMap((tab) =>
    tab.groups.flatMap((group) =>
      group.rows.map((row) => ({
        label: row.label,
        name: row.field.name,
        tab: tab.name,
        group: group.label,
        addr: row.field.addr,
      })),
    ),
  );
}

export function matchRows(index: readonly SearchEntry[], query: string): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const hits: SearchEntry[] = [];
  for (const entry of index) {
    const hex = hexAddr(entry.addr);
    if (
      entry.label.toLowerCase().includes(q) ||
      entry.name.toLowerCase().includes(q) ||
      hex === q ||
      hex.slice(2) === q
    ) {
      hits.push(entry);
      if (hits.length === SEARCH_LIMIT) break;
    }
  }
  return hits;
}
