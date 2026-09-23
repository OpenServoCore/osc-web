import { useSyncExternalStore } from "react";
import { Card } from "@/components/ui/card";
import { useBusStats } from "@/lib/bus/hooks";
import type { Quantiles } from "@/lib/bus/manager";

const never = () => () => undefined;

/** `?debug` only: the numbers the hardware procedure records. */
export function BusDebug() {
  const wanted = useSyncExternalStore(
    never,
    () => new URLSearchParams(location.search).has("debug"),
    () => false,
  );
  return wanted ? <Panel /> : null;
}

function n(value: number, digits = 0): string {
  return value.toFixed(digits);
}

function q(value: Quantiles): string {
  return `${n(value.p50, 1)}/${n(value.p95, 1)}`;
}

function Panel() {
  const stats = useBusStats();
  const rows: [string, string][] = [
    ["exchanges", `${stats.exchanges}`],
    ["per second", n(stats.perSecond, 1)],
    ["bytes/s", n(stats.bytesPerSecond)],
    ["wait p50/p95", q(stats.wait)],
    ["run small", q(stats.run.small)],
    ["run medium", q(stats.run.medium)],
    ["run large", q(stats.run.large)],
    ["lag p50/p95", q(stats.lag)],
    ["timeouts", `${stats.timeouts}`],
    ["stalled", `${stats.stalled}`],
    ["errors", `${stats.errors}`],
    ["coalesced", `${stats.coalesced}`],
    ["grouped", `${stats.grouped}`],
    ["utilisation", n(stats.utilisation, 2)],
    ["period fast/slow", `${n(stats.effectivePeriodMs.fast)}/${n(stats.effectivePeriodMs.slow)}`],
  ];
  return (
    <Card
      size="sm"
      role="region"
      aria-label="Bus statistics"
      className="fixed right-2 bottom-2 z-50 w-56 font-mono text-xs"
    >
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-(--card-spacing)">
        {rows.map(([label, value]) => (
          <div key={label} className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-text-3">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {[...stats.perServo].map(([id, s]) => (
        <p key={id} className="px-(--card-spacing) text-text-3">
          ID {id} fails {s.consecutiveFailures}
          {s.probing ? " probing" : ""}
        </p>
      ))}
    </Card>
  );
}
