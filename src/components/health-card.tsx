import type { Health } from "@openservocore/client";
import { CircleAlert, CircleCheck, HeartPulse, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { countersLine, statements, trimLine, type Level } from "@/lib/health";
import { useSession } from "@/lib/session";

const POLL_MS = 1000;

const icons = { fault: CircleAlert, warn: TriangleAlert, ok: CircleCheck };
const tone: Record<Level, string> = {
  fault: "text-danger",
  warn: "text-warning",
  ok: "text-success",
};

export function HealthCard({ id }: { id: number }) {
  const { run } = useSession();
  const [health, setHealth] = useState<Health>();
  const [error, setError] = useState<string>();
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let live = true;
    // One read in flight at a time: a poll that outlasts its period is skipped
    // rather than queued behind itself.
    let busy = false;
    async function poll() {
      if (busy || !live) return;
      busy = true;
      try {
        const read = await run((c) => c.health(id));
        if (live) {
          setHealth(read);
          setError(undefined);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      } finally {
        busy = false;
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [run, id]);

  async function clear() {
    setClearing(true);
    try {
      await run((c) => c.clearCounters(id));
      setHealth(await run((c) => c.health(id)));
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
        {error !== undefined && <p className="text-danger">{error}</p>}
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
