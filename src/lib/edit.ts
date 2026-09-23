import type { Field } from "@openservocore/client";

/** `min`/`max` are the descriptor's bounds in counts; `scale` is display units per count. */
export interface NumberKind {
  kind: "number";
  signed: boolean;
  width: number;
  min?: number;
  max?: number;
  scale?: number;
  unit?: string;
}

export interface EnumKind {
  kind: "enum";
  options: { label: string; value: number }[];
}

export interface BoolKind {
  kind: "bool";
}

export interface RawKind {
  kind: "raw";
  width: number;
}

export type FieldKind = NumberKind | EnumKind | BoolKind | RawKind;

/** What a page knows and the descriptor does not: how a register reads in real units. */
export type NumberDisplay = Pick<NumberKind, "scale" | "unit">;

export type EditValue = number | boolean | Uint8Array;

export type ValueOf<K extends FieldKind> = K extends BoolKind
  ? boolean
  : K extends RawKind
    ? Uint8Array
    : number;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

export function fieldKind(field: Field): FieldKind {
  switch (field.kind) {
    case "uint":
    case "int":
      return {
        kind: "number",
        signed: field.kind === "int",
        width: field.width,
        ...(field.min !== undefined && { min: field.min }),
        ...(field.max !== undefined && { max: field.max }),
      };
    case "enum":
      return {
        kind: "enum",
        options: field.variants.map((v) => ({ label: v.name, value: v.value })),
      };
    case "bool":
      return { kind: "bool" };
    case "bytes":
      return { kind: "raw", width: field.width };
  }
}

function widthRange(kind: NumberKind): [number, number] {
  const span = 2 ** (8 * kind.width);
  return kind.signed ? [-span / 2, span / 2 - 1] : [0, span - 1];
}

function decimals(scale: number): number {
  const [mantissa = "", exponent = "0"] = scale.toString().split("e");
  const fraction = mantissa.split(".")[1]?.length ?? 0;
  return Math.max(0, fraction - Number(exponent));
}

export function fromRaw(kind: NumberKind, raw: number): number {
  return kind.scale === undefined ? raw : raw * kind.scale;
}

export function toRaw(kind: NumberKind, display: number): number {
  return kind.scale === undefined ? display : Math.round(display / kind.scale);
}

function formatNumber(kind: NumberKind, display: number): string {
  return kind.scale === undefined ? String(display) : display.toFixed(decimals(kind.scale));
}

function withUnit(kind: NumberKind, text: string): string {
  return kind.unit === undefined ? text : `${text} ${kind.unit}`;
}

export function formatValue(kind: FieldKind, value: EditValue): string {
  switch (kind.kind) {
    case "number":
      return typeof value === "number"
        ? withUnit(kind, formatNumber(kind, fromRaw(kind, value)))
        : String(value);
    case "enum":
      return kind.options.find((o) => o.value === value)?.label ?? String(value);
    case "bool":
      return value === true ? "On" : "Off";
    case "raw":
      return value instanceof Uint8Array ? toHex(value) : String(value);
  }
}

/** The text the input starts from: what `parseInput` turns back into `value`. */
export function editText(kind: FieldKind, value: EditValue): string {
  switch (kind.kind) {
    case "number":
      return typeof value === "number" ? formatNumber(kind, fromRaw(kind, value)) : "";
    case "enum":
    case "bool":
      return String(value);
    case "raw":
      return value instanceof Uint8Array ? toHex(value) : "";
  }
}

export function rangeHint(kind: NumberKind): string | undefined {
  const lo =
    kind.min === undefined
      ? undefined
      : withUnit(kind, formatNumber(kind, fromRaw(kind, kind.min)));
  const hi =
    kind.max === undefined
      ? undefined
      : withUnit(kind, formatNumber(kind, fromRaw(kind, kind.max)));
  if (lo !== undefined && hi !== undefined) return `${lo} to ${hi}`;
  if (lo !== undefined) return `at least ${lo}`;
  if (hi !== undefined) return `at most ${hi}`;
  return undefined;
}

export function parseInput<K extends FieldKind>(kind: K, text: string): ParseResult<ValueOf<K>> {
  switch (kind.kind) {
    case "number":
      return parseNumber(kind, text) as ParseResult<ValueOf<K>>;
    case "enum":
      return parseEnum(kind, text) as ParseResult<ValueOf<K>>;
    case "bool":
      return parseBool(text) as ParseResult<ValueOf<K>>;
    case "raw":
      return parseRaw(kind, text) as ParseResult<ValueOf<K>>;
  }
}

/** Accepts a display-unit number; the value returned is still in display units. */
function parseNumber(kind: NumberKind, text: string): ParseResult<number> {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, reason: "enter a number" };
  const display = Number(trimmed);
  if (!Number.isFinite(display)) return { ok: false, reason: "not a number" };
  const raw = kind.scale === undefined ? display : display / kind.scale;
  if (Math.abs(raw - Math.round(raw)) > 1e-6) {
    return kind.scale === undefined
      ? { ok: false, reason: "whole numbers only" }
      : { ok: false, reason: `steps of ${withUnit(kind, formatNumber(kind, kind.scale))}` };
  }
  const [wlo, whi] = widthRange(kind);
  const lo = kind.min ?? wlo;
  const hi = kind.max ?? whi;
  const rounded = Math.round(raw);
  if (rounded < lo || rounded > hi) {
    const fmt = (n: number) => formatNumber(kind, fromRaw(kind, n));
    return { ok: false, reason: withUnit(kind, `between ${fmt(lo)} and ${fmt(hi)}`) };
  }
  return { ok: true, value: display };
}

function parseEnum(kind: EnumKind, text: string): ParseResult<number> {
  const option = kind.options.find((o) => String(o.value) === text);
  return option === undefined
    ? { ok: false, reason: "pick an option" }
    : { ok: true, value: option.value };
}

function parseBool(text: string): ParseResult<boolean> {
  if (text === "true") return { ok: true, value: true };
  if (text === "false") return { ok: true, value: false };
  return { ok: false, reason: "on or off" };
}

function parseRaw(kind: RawKind, text: string): ParseResult<Uint8Array> {
  const digits = text.replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(digits)) return { ok: false, reason: "hex digits only" };
  if (digits.length !== kind.width * 2) return { ok: false, reason: `${kind.width} bytes as hex` };
  const bytes = new Uint8Array(kind.width);
  for (let i = 0; i < kind.width; i++) bytes[i] = parseInt(digits.slice(2 * i, 2 * i + 2), 16);
  return { ok: true, value: bytes };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
}
