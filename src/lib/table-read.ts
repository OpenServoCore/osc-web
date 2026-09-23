import type { Descriptor } from "@openservocore/client";
import type { EditValue } from "./edit";
import { hexAddr } from "./format";
import type { Row } from "./table-model";

/** A READ payload is at most 252 bytes (protocol sec 5.1). */
export const MAX_READ = 252;

export interface Span {
  addr: number;
  count: number;
}

export type Values = ReadonlyMap<string, EditValue>;

/**
 * The reads covering `rows`: fields in address order, each joined to the
 * span before it when it starts inside or right after that span and keeps
 * it within MAX_READ. A gap between fields starts a new span.
 */
export function readSpans(rows: readonly Row[]): Span[] {
  const fields = rows.map((r) => r.field).sort((a, b) => a.addr - b.addr);
  const spans: Span[] = [];
  for (const f of fields) {
    const last = spans.at(-1);
    const end = f.addr + f.width;
    if (last !== undefined && f.addr <= last.addr + last.count && end - last.addr <= MAX_READ) {
      last.count = Math.max(last.count, end - last.addr);
    } else {
      spans.push({ addr: f.addr, count: f.width });
    }
  }
  return spans;
}

/** The rows one span's bytes hold, decoded through the descriptor's codec. */
export function decodeSpan(
  descriptor: Pick<Descriptor, "decode">,
  rows: readonly Row[],
  span: Span,
  bytes: Uint8Array,
): Map<string, EditValue> {
  if (bytes.length !== span.count) {
    throw new Error(
      `read at ${hexAddr(span.addr)} returned ${bytes.length} of ${span.count} bytes`,
    );
  }
  const values = new Map<string, EditValue>();
  for (const { field } of rows) {
    const at = field.addr - span.addr;
    if (at < 0 || at + field.width > span.count) continue;
    values.set(
      field.name,
      descriptor.decode(field.name, bytes.subarray(at, at + field.width)).value,
    );
  }
  return values;
}

/** Every row's value, one span read after another. */
export async function readRows(
  rows: readonly Row[],
  descriptor: Pick<Descriptor, "decode">,
  read: (addr: number, count: number) => Promise<Uint8Array>,
): Promise<Values> {
  const values = new Map<string, EditValue>();
  for (const span of readSpans(rows)) {
    const bytes = await read(span.addr, span.count);
    for (const [name, value] of decodeSpan(descriptor, rows, span, bytes)) values.set(name, value);
  }
  return values;
}
