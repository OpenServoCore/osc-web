import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Button } from "@/components/ui/button";
import {
  anchorOf,
  andText,
  degText,
  fillOf,
  frame,
  endLabelAt,
  HIT_PX,
  LABEL_R,
  markAt,
  paneOf,
  phiOf,
  point,
  R,
  readout,
  RINGS,
  ringOf,
  scaleTicks,
  sectorPath,
  shadeOf,
  spanOf,
  summary,
  tableRows,
  type Arc,
  type Mark,
} from "@/lib/health-arc";

interface Active {
  mark: Mark;
  /** Where the pane anchors, in the wrapper's px. */
  x: number;
  y: number;
  by: "pointer" | "key";
  pinned: boolean;
}

const PANE_GAP = 12;
const SMALL = "text-xs forced-colors:fill-[CanvasText]";

/** Swatch classes per mark; forced colors keep the shapes and patterns in system colors. */
const INK = {
  hole: "fill-pos-hole forced-colors:fill-[Highlight]",
  holeLine: "stroke-pos-hole forced-colors:stroke-[Highlight]",
  adc: "fill-adc-hole stroke-adc-hole forced-colors:fill-[Highlight] forced-colors:stroke-[Highlight]",
  unjudged: "stroke-border-strong forced-colors:stroke-[CanvasText]",
  cut: "fill-surface forced-colors:fill-[Canvas]",
  good: "fill-(--fill) stroke-(--fill) forced-colors:fill-[CanvasText] forced-colors:stroke-[CanvasText]",
  outline: "fill-none stroke-border-strong forced-colors:stroke-[CanvasText]",
  focus: "stroke-focus forced-colors:stroke-[Highlight]",
} as const;

function Patterns({ id }: { id: string }) {
  return (
    <defs>
      <pattern
        id={`${id}-hole`}
        width="4"
        height="4"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <line x1="0" y1="0" x2="0" y2="4" strokeWidth="2" className={INK.holeLine} />
      </pattern>
      <pattern
        id={`${id}-unjudged`}
        width="4"
        height="4"
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(135)"
      >
        <line x1="0" y1="0" x2="0" y2="4" strokeWidth="2" className={INK.unjudged} />
      </pattern>
    </defs>
  );
}

function Marks({ arc, id, focus }: { arc: Arc; id: string; focus: Mark | undefined }) {
  const S = arc.travelDeg;
  const [b0, b1] = [RINGS.band[0] * R, RINGS.band[1] * R];
  return (
    <>
      <g aria-hidden="true">
        {arc.good.map((m) => (
          <path
            key={m.key}
            d={sectorPath(m.fromDeg, m.toDeg, b0, b1, S)}
            className={INK.good}
            style={{ "--fill": fillOf(shadeOf(m.q)) } as CSSProperties}
            // A stroke in the sector's own fill closes the antialiased seam between neighbors.
            strokeWidth={0.75}
          />
        ))}
        {arc.good.length > 0 && (
          // The average's gray sits close to the surface: the outline keeps the band's edge.
          <path d={sectorPath(0, S, b0, b1, S)} strokeWidth={1} className={INK.outline} />
        )}
        {arc.unjudged.map((m) => (
          <g key={m.key} data-kind="not judged">
            <path d={sectorPath(m.fromDeg, m.toDeg, b0, b1, S)} className={INK.cut} />
            <path d={sectorPath(m.fromDeg, m.toDeg, b0, b1, S)} fill={`url(#${id}-unjudged)`} />
          </g>
        ))}
        {arc.pot.map((m) => {
          const [a, b] = spanOf(m);
          return (
            <g key={m.key} data-kind="pot" data-raw={`${String(m.fromRaw)}..${String(m.toRaw)}`}>
              <path d={sectorPath(a, b, b0, b1, S)} className={INK.cut} />
              <path
                d={sectorPath(a, b, b0, b1, S)}
                fill={`url(#${id}-hole)`}
                strokeWidth={1.5}
                className={INK.holeLine}
              />
              <path
                d={sectorPath(a, b, RINGS.pot[0] * R, RINGS.pot[1] * R, S)}
                className={INK.hole}
              />
            </g>
          );
        })}
        {scaleTicks(S).map((d) => {
          const phi = phiOf(d, S);
          const p0 = point(RINGS.scale[0] * R, phi);
          const p1 = point(RINGS.scale[1] * R, phi);
          const l = point(LABEL_R * R, phi);
          return (
            <g key={d}>
              <line
                x1={p0.x}
                y1={p0.y}
                x2={p1.x}
                y2={p1.y}
                strokeWidth={1}
                className="stroke-axis forced-colors:stroke-[CanvasText]"
              />
              <text
                x={l.x}
                y={l.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-text-3 text-xs forced-colors:fill-[CanvasText]"
              >
                {d}°
              </text>
            </g>
          );
        })}
        {arc.adc.map((m) => {
          const [a, b] = spanOf(m);
          const [r0, r1] = ringOf("adc");
          return (
            <path
              key={m.key}
              data-kind="adc"
              data-carry={m.carry}
              data-stored={m.slot === 0 ? "no" : "yes"}
              d={sectorPath(a, b, r0, r1, S)}
              strokeWidth={m.slot === 0 ? 1.5 : 0}
              className={m.slot === 0 ? `${INK.adc} fill-none!` : INK.adc}
            />
          );
        })}
        {focus !== undefined && (
          <path
            d={focusPath(focus, S)}
            fill="none"
            strokeWidth={2}
            className={INK.focus}
            data-focus=""
          />
        )}
      </g>
      <Ends travelDeg={S} />
      <Readout arc={arc} />
    </>
  );
}

function focusPath(m: Mark, travelDeg: number): string {
  const [a, b] = spanOf(m);
  const [r0, r1] = ringOf(m.kind);
  const pad = 3;
  const grow = ((pad / R) * 180) / Math.PI;
  return sectorPath(a - grow, b + grow, r0 - pad, r1 + pad, travelDeg);
}

function Ends({ travelDeg }: { travelDeg: number }) {
  const cw = endLabelAt("cw", travelDeg);
  const ccw = endLabelAt("ccw", travelDeg);
  const cls = "fill-text-2 text-xs forced-colors:fill-[CanvasText]";
  return (
    <g>
      <text x={cw.x} y={cw.y} textAnchor="middle" dominantBaseline="hanging" className={cls}>
        CW stop 0°
      </text>
      <text x={ccw.x} y={ccw.y} textAnchor="middle" dominantBaseline="hanging" className={cls}>
        CCW stop {degText(travelDeg)}
      </text>
    </g>
  );
}

function Readout({ arc }: { arc: Arc }) {
  const lines = readout(arc);
  const top = -0.42 * R;
  return (
    <g aria-hidden="true">
      <text
        x={0}
        y={top}
        textAnchor="middle"
        className="fill-text text-xl font-semibold tabular-nums forced-colors:fill-[CanvasText]"
      >
        {degText(arc.travelDeg)}
      </text>
      <text x={0} y={top + 20} textAnchor="middle" className={`fill-text-3 ${SMALL}`}>
        travel
      </text>
      {lines.map((l, i) => (
        <g key={l.label}>
          <text x={0} y={top + 50 + i * 38} textAnchor="middle" className={`fill-text-3 ${SMALL}`}>
            {l.label}
          </text>
          <text
            x={0}
            y={top + 66 + i * 38}
            textAnchor="middle"
            className={`fill-text-2 tabular-nums ${SMALL}`}
          >
            {l.value}
          </text>
        </g>
      ))}
    </g>
  );
}

function Swatch({ kind, id }: { kind: Mark["kind"] | "adc-hollow"; id: string }) {
  return (
    <svg width="22" height="14" aria-hidden="true" className="shrink-0">
      {kind === "good" && (
        <>
          {SCALE_STEPS.map((t, i) => (
            <rect
              key={t}
              x={i * 4.4}
              width="4.4"
              height="14"
              className={INK.good}
              style={{ "--fill": fillOf(t) } as CSSProperties}
            />
          ))}
          <rect x="0.5" y="0.5" width="21" height="13" strokeWidth={1} className={INK.outline} />
        </>
      )}
      {kind === "pot" && (
        <>
          <rect x="1" y="1" width="20" height="9" className={INK.cut} />
          <rect
            x="1"
            y="1"
            width="20"
            height="9"
            fill={`url(#${id}-hole)`}
            strokeWidth={1.5}
            className={INK.holeLine}
          />
          <rect x="1" y="11" width="20" height="3" className={INK.hole} />
        </>
      )}
      {kind === "adc" && <rect x="9" y="1" width="4" height="12" className={INK.adc} />}
      {kind === "adc-hollow" && (
        <rect
          x="9"
          y="1"
          width="4"
          height="12"
          strokeWidth={1.5}
          className={`${INK.adc} fill-none!`}
        />
      )}
      {kind === "not judged" && <rect width="22" height="14" fill={`url(#${id}-unjudged)`} />}
    </svg>
  );
}

const SCALE_STEPS = [-1, -0.5, 0, 0.5, 1] as const;

/** The good travel's scale: coarse 0.5× to fine 2× the average counts a degree, 1× neutral. */
function DensityScale() {
  const w = 24;
  const at = (i: number) => i * w + w / 2;
  return (
    <svg width={SCALE_STEPS.length * w} height="30" aria-hidden="true" className="shrink-0">
      {SCALE_STEPS.map((t, i) => (
        <rect
          key={t}
          x={i * w}
          width={w}
          height="12"
          className={INK.good}
          style={{ "--fill": fillOf(t) } as CSSProperties}
        />
      ))}
      <rect
        x="0.5"
        y="0.5"
        width={SCALE_STEPS.length * w - 1}
        height="11"
        strokeWidth={1}
        className={INK.outline}
      />
      {(
        [
          [0, "0.5×"],
          [2, "1×"],
          [4, "2×"],
        ] as const
      ).map(([i, label]) => (
        <text key={label} x={at(i)} y="26" textAnchor="middle" className={`fill-text-3 ${SMALL}`}>
          {label}
        </text>
      ))}
    </svg>
  );
}

function Legend({ id }: { id: string }) {
  return (
    <ul aria-label="Legend" className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-text-2">
      <li className="flex items-center gap-2">
        <DensityScale />
        good travel: counts a degree against the average, coarser (ochre) to finer (blue), gray at
        the average
      </li>
      <li className="flex items-center gap-1.5">
        <Swatch kind="pot" id={id} />
        position hole
      </li>
      <li className="flex items-center gap-1.5">
        <Swatch kind="adc" id={id} />
        <Swatch kind="adc-hollow" id={id} />
        ADC wide code, hollow where no slot is stored
      </li>
      <li className="flex items-center gap-1.5">
        <Swatch kind="not judged" id={id} />
        no wide code judged
      </li>
    </ul>
  );
}

function PaneCard({
  arc,
  id,
  active,
  wrapW,
  wrapH,
}: {
  arc: Arc;
  id: string;
  active: Active;
  wrapW: number;
  wrapH: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number }>();
  const pane = paneOf(active.mark, arc);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const [w, h] = [el.offsetWidth, el.offsetHeight];
    let left = active.x + PANE_GAP;
    let top = active.y + PANE_GAP;
    if (left + w > wrapW) left = Math.max(0, active.x - PANE_GAP - w);
    if (top + h > wrapH) top = Math.max(0, active.y - PANE_GAP - h);
    setAt({ left, top });
  }, [active, wrapW, wrapH]);
  return (
    <div
      ref={ref}
      role="tooltip"
      aria-label="Mark details"
      aria-live="polite"
      style={{
        left: at?.left ?? active.x + PANE_GAP,
        top: at?.top ?? active.y + PANE_GAP,
        visibility: at === undefined ? "hidden" : "visible",
      }}
      className="pointer-events-none absolute z-10 flex w-80 flex-col gap-1 rounded-md border bg-popover p-3 text-sm text-text shadow-el-2"
    >
      <div className="flex items-center gap-2 font-medium">
        <Swatch
          kind={
            active.mark.kind === "adc" && active.mark.slot === 0 ? "adc-hollow" : active.mark.kind
          }
          id={id}
        />
        {pane.title}
      </div>
      {pane.lines.map((l) => (
        <p key={l} className="tabular-nums">
          {l}
        </p>
      ))}
      <p className="text-text-2">{pane.says}</p>
      {pane.more.map((l) => (
        <p key={l} className="text-xs text-text-2">
          {l}
        </p>
      ))}
    </div>
  );
}

function TableView({ arc }: { arc: Arc }) {
  const rows = tableRows(arc);
  return (
    <table aria-label="Travel map as a table" className="w-full text-sm tabular-nums">
      <thead className="text-left text-text-3">
        <tr>
          <th className="py-1 font-normal">Kind</th>
          <th className="py-1 font-normal">From, °</th>
          <th className="py-1 font-normal">To, °</th>
          <th className="py-1 font-normal">Raw from</th>
          <th className="py-1 font-normal">Raw to</th>
          <th className="py-1 font-normal">Counts</th>
          <th className="py-1 font-normal">Note</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t">
            <td className="py-1 pr-4">{r.kind}</td>
            <td className="py-1 pr-4">{r.fromDeg}</td>
            <td className="py-1 pr-4">{r.toDeg}</td>
            <td className="py-1 pr-4">{r.fromRaw}</td>
            <td className="py-1 pr-4">{r.toRaw}</td>
            <td className="py-1 pr-4">{r.counts}</td>
            <td className="py-1">{r.note}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HealthArc({ arc }: { arc: Arc }) {
  const id = `arc${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const box = frame(arc.travelDeg);
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<Active>();
  const [table, setTable] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = wrap.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    if (active?.pinned !== true) return;
    const away = (e: globalThis.PointerEvent) => {
      if (wrap.current?.contains(e.target as Node) !== true) setActive(undefined);
    };
    document.addEventListener("pointerdown", away);
    return () => {
      document.removeEventListener("pointerdown", away);
    };
  }, [active?.pinned]);

  /** The arc's units under a client point, and px per unit. */
  const toArc = (clientX: number, clientY: number) => {
    const el = svg.current;
    if (el === null) return undefined;
    const rect = el.getBoundingClientRect();
    const scale = rect.width / box.w;
    return {
      x: box.x + (clientX - rect.left) / scale,
      y: box.y + (clientY - rect.top) / scale,
      scale,
    };
  };

  /** The wrapper's px of a point in the arc's units. */
  const toWrap = (x: number, y: number) => {
    const el = svg.current;
    const w = wrap.current;
    if (el === null || w === null) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const outer = w.getBoundingClientRect();
    const scale = rect.width / box.w;
    return {
      x: rect.left - outer.left + (x - box.x) * scale,
      y: rect.top - outer.top + (y - box.y) * scale,
    };
  };

  const hit = (e: PointerEvent<SVGSVGElement>): Active | undefined => {
    const p = toArc(e.clientX, e.clientY);
    const w = wrap.current;
    if (p === undefined || w === null) return undefined;
    const mark = markAt(arc, p.x, p.y, HIT_PX / p.scale);
    if (mark === undefined) return undefined;
    const outer = w.getBoundingClientRect();
    return {
      mark,
      x: e.clientX - outer.left,
      y: e.clientY - outer.top,
      by: "pointer",
      pinned: false,
    };
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (active?.pinned === true) return;
    const next = hit(e);
    if (next === undefined) {
      if (active?.by === "pointer") setActive(undefined);
      return;
    }
    if (next.mark !== active?.mark || active.by !== "pointer") setActive(next);
    else setActive({ ...active, x: next.x, y: next.y });
  };

  const onClick = (e: PointerEvent<SVGSVGElement>) => {
    const next = hit(e);
    setActive(next === undefined ? undefined : { ...next, pinned: true });
  };

  const select = (mark: Mark | undefined, pinned = false) => {
    if (mark === undefined) return;
    const a = anchorOf(mark, arc.travelDeg);
    const p = toWrap(a.x, a.y);
    setActive({ mark, x: p.x, y: p.y, by: "key", pinned });
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const stops = arc.stops;
    const i = active === undefined ? -1 : stops.indexOf(active.mark);
    switch (e.key) {
      // The CW stop is on the right and the travel grows leftward on screen.
      case "ArrowLeft":
        select(stops[i < 0 ? 0 : Math.min(i + 1, stops.length - 1)]);
        break;
      case "ArrowRight":
        select(stops[i < 0 ? stops.length - 1 : Math.max(i - 1, 0)]);
        break;
      case "Home":
        select(stops[0]);
        break;
      case "End":
        select(stops[stops.length - 1]);
        break;
      case "Enter":
      case " ":
        if (active !== undefined) setActive({ ...active, pinned: true });
        else select(stops[0], true);
        break;
      case "Escape":
        setActive(undefined);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onFocus = (e: FocusEvent<SVGSVGElement>) => {
    if (active === undefined && e.currentTarget.matches(":focus-visible")) select(arc.stops[0]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div ref={wrap} className="relative">
        <svg
          ref={svg}
          role="img"
          aria-label={summary(arc)}
          tabIndex={0}
          viewBox={`${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)}`}
          width={box.w}
          className="mx-auto block h-auto max-w-full cursor-crosshair rounded-md outline-none focus-visible:ring-2 focus-visible:ring-focus forced-colors:forced-color-adjust-none"
          onPointerMove={onMove}
          onPointerLeave={() => {
            if (active?.by === "pointer" && !active.pinned) setActive(undefined);
          }}
          onPointerDown={onClick}
          onKeyDown={onKey}
          onFocus={onFocus}
          onBlur={() => {
            if (active?.by === "key" && !active.pinned) setActive(undefined);
          }}
        >
          <Patterns id={id} />
          <Marks arc={arc} id={id} focus={active?.by === "key" ? active.mark : undefined} />
        </svg>
        {active !== undefined && (
          <PaneCard arc={arc} id={id} active={active} wrapW={size.w} wrapH={size.h} />
        )}
      </div>
      <Legend id={id} />
      <p className="text-xs text-text-3">
        Holes and ticks are drawn at least 2 px wide; the pane gives their true size.
      </p>
      {arc.notRead.length > 0 && (
        <ul aria-label="Slow rungs the pot rule did not read" className="text-sm text-text-2">
          {arc.notRead.map((n) => (
            <li key={n.why}>
              {n.rungs.length === 1
                ? `Slow rung ${String(n.rungs[0])}, which the pot rule did not read: ${n.why}.`
                : `Slow rungs ${andText(n.rungs.map(String))}, which the pot rule did not read; for each: ${n.why}.`}
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={table}
          onClick={() => {
            setTable(!table);
          }}
        >
          {table ? "Hide the table" : "Show as table"}
        </Button>
      </div>
      {table && <TableView arc={arc} />}
      {arc.potSource !== undefined && (
        <p className="text-xs text-text-3">Position holes found by: {arc.potSource}</p>
      )}
      {arc.adcSource !== undefined && (
        <p className="text-xs text-text-3">ADC wide codes found by: {arc.adcSource}</p>
      )}
    </div>
  );
}
