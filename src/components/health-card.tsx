import { CircleAlert, CircleCheck, HeartPulse, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useBus, useRegisters } from "@/lib/bus/hooks";
import { healthFrom, HEALTH_REGISTERS } from "@/lib/bus/spans";
import { countersLine, statements, trimLine, type Level } from "@/lib/health";

const icons = { fault: CircleAlert, warn: TriangleAlert, ok: CircleCheck };
const tone: Record<Level, string> = {
  fault: "text-danger",
  warn: "text-warning",
  ok: "text-success",
};

export function HealthCard({ id }: { id: number }) {
  const bus = useBus();
  const snapshot = useRegisters(id, HEALTH_REGISTERS, "slow");
  const [error, setError] = useState<string>();
  const [clearing, setClearing] = useState(false);

  // A stale snapshot carries what the cache still holds, which may be nothing.
  const complete =
    snapshot !== undefined && HEALTH_REGISTERS.every((name) => snapshot.values.has(name));
  const health = complete ? healthFrom(snapshot.read) : undefined;
  const problem = error ?? (snapshot?.stale === true ? snapshot.error : undefined);

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
            {statements(health).map(({ level, text }) => {
              const Icon = icons[level];
              return (
                <div key={text} className="flex items-start gap-2">
                  <Icon className={`mt-0.5 size-4 shrink-0 ${tone[level]}`} />
                  <span>{text}</span>
                </div>
              );
            })}
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
