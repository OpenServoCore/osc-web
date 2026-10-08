import { CircleAlert, CircleCheck, HeartPulse, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useBus, useRegisters } from "@/lib/bus/hooks";
import { healthFrom, HEALTH_REGISTERS } from "@/lib/bus/spans";
import { ackFault } from "@/lib/fault-ack";
import { formatQuantity } from "@/lib/format";
import { countersLine, statements, trimLine, type Level } from "@/lib/health";
import { useSession } from "@/lib/session";
import {
  celsius,
  THERMAL_REGISTERS,
  thermalFrom,
  thermOff,
  thermStates,
  type ThermLevel,
} from "@/lib/thermal";
import { currentMa, DISPLAY, type Sense } from "@/lib/units";

const icons = { fault: CircleAlert, warn: TriangleAlert, ok: CircleCheck };
const tone: Record<Level, string> = {
  fault: "text-danger",
  warn: "text-warning",
  ok: "text-success",
};
const stateTone: Record<ThermLevel, string> = {
  warn: "bg-warning-soft text-warning",
  notice: "border-border text-text-3",
};

export function HealthCard({ id }: { id: number }) {
  const bus = useBus();
  const { servos, descriptorFor, values } = useSession();
  const snapshot = useRegisters(id, HEALTH_REGISTERS, "slow");
  const [error, setError] = useState<string>();
  const [clearing, setClearing] = useState(false);
  const [acking, setAcking] = useState(false);

  // A stale snapshot carries what the cache still holds, which may be nothing.
  const complete =
    snapshot !== undefined && HEALTH_REGISTERS.every((name) => snapshot.values.has(name));
  const health = complete ? healthFrom(snapshot.read) : undefined;
  const problem = error ?? (snapshot?.stale === true ? snapshot.error : undefined);
  const servo = servos.find((s) => s.id === id);
  const descriptor = servo === undefined ? undefined : descriptorFor(servo);
  const card = servo === undefined ? undefined : values.get(servo.uid);
  const data = card?.data;
  const faulted = health !== undefined && health.faultFlags !== 0;

  /** One turn, so nothing interleaves with the ack. */
  async function ack() {
    if (descriptor === undefined) return;
    setAcking(true);
    try {
      await bus.command((c) => ackFault(c, id, descriptor));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAcking(false);
    }
  }

  async function clear() {
    setClearing(true);
    try {
      // The counters come back on the subscription's next read.
      await bus.command((c) => c.clearCounters(id));
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearing(false);
    }
  }

  return (
    <Card role="region" aria-label="Health">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartPulse className="size-4" />
          Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        {problem !== undefined && <p className="text-danger">{problem}</p>}
        {health === undefined ? (
          <>
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </>
        ) : (
          <>
            {statements(health, data).map(({ level, text }) => {
              const Icon = icons[level];
              return (
                <div key={text} className="flex items-start gap-2">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${tone[level]}`} />
                  <span>{text}</span>
                </div>
              );
            })}
            {faulted && (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={acking}
                onClick={() => void ack()}
              >
                Clear fault
              </Button>
            )}
            <WindingRow id={id} sense={card?.constants.sense} />
            <Separator />
            <div className="flex items-baseline justify-between gap-4 text-text-3">
              <span>{trimLine(health)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-4 text-text-3">
              <span>{countersLine(health)}</span>
              <Button variant="link" size="sm" disabled={clearing} onClick={() => void clear()}>
                Clear counters
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const temp = (cc: number) => formatQuantity(celsius(cc), DISPLAY.temperature);
/** i_lim and current_limit are bias-free magnitudes, like the kernel's own current. */
const mA = (counts: number, sense: Sense) =>
  formatQuantity(currentMa(counts, 0, sense), DISPLAY.current);

function WindingRow({ id, sense }: { id: number; sense: Sense | undefined }) {
  const snapshot = useRegisters(id, THERMAL_REGISTERS, "slow");
  if (snapshot === undefined || !THERMAL_REGISTERS.every((name) => snapshot.values.has(name))) {
    return <Skeleton className="h-5 w-full" />;
  }
  const t = thermalFrom(snapshot.read);
  const off = thermOff(t);
  const states = thermStates(t);
  const derating = states.some((s) => s.word === "derating");
  return (
    <div role="group" aria-label="Winding" className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        <span>Winding</span>
        <span className="flex items-center gap-2">
          {!off && (
            <span aria-label="Winding temperature" className="font-mono tabular-nums">
              {temp(t.windingCc)}
            </span>
          )}
          {states.map((s) => (
            <Badge key={s.word} variant="outline" className={stateTone[s.level]}>
              {s.word}
            </Badge>
          ))}
        </span>
      </div>
      {derating && sense !== undefined && (
        <span aria-label="Derated limit" className="self-end text-sm text-warning">
          limit {mA(t.iLimCounts, sense)} of {mA(t.currentLimitCounts, sense)}
        </span>
      )}
      <div className="flex flex-col text-sm text-text-3">
        {!off && <span aria-label="Board temperature">Board {temp(t.ntcCc)}</span>}
        <span aria-label="Thresholds">
          Derate at {temp(t.derateStartCc)}, cutoff at {temp(t.cutoffCc)}, recover at{" "}
          {temp(t.recoverCc)}
        </span>
      </div>
    </div>
  );
}
