// A diverging color scale for a signed quantity: the sign picks the hue, the
// magnitude the depth, and zero is the neutral tone. Pure, so the ends can be
// theme tokens and the mapping still pins in a unit test.

export interface Diverging {
  /** Negative end, at full magnitude. */
  low: string;
  zero: string;
  /** Positive end, at full magnitude. */
  high: string;
}

type Rgb = [number, number, number];

function parse(hex: string): Rgb | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (m?.[1] === undefined) return undefined;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function mix(a: Rgb, b: Rgb, t: number, alpha: number): string {
  const c = a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * t));
  return alpha === 1
    ? `rgb(${c[0]}, ${c[1]}, ${c[2]})`
    : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

/**
 * The color for `t` in -1..1 (clamped): `zero` at 0, `low` at -1, `high` at
 * +1, blended in between, at `alpha`. Ends that are not `#rrggbb` come back
 * unblended and opaque.
 */
export function diverging(t: number, scale: Diverging, alpha = 1): string {
  const u = Math.max(-1, Math.min(1, t));
  const end = u < 0 ? scale.low : u > 0 ? scale.high : scale.zero;
  const from = parse(scale.zero);
  const to = parse(end);
  if (from === undefined || to === undefined) return end;
  return mix(from, to, Math.abs(u), alpha);
}
