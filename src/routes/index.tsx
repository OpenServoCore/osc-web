import { unpackVersion } from "@openservocore/client";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, CircleAlert, CircleCheck, Cog, Pencil, Plug, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { faultText, type CardValues } from "@/lib/card-poll";
import { formatQuantity, formatVersion, hex16 } from "@/lib/format";
import { useSession, type Servo } from "@/lib/session";
import { busV, currentMa, DISPLAY, positionDeg, temperatureC } from "@/lib/units";
import { useConnectionPopover } from "@/lib/use-connection-popover";

export const Route = createFileRoute("/")({ component: Dashboard });

const SKELETONS = 3;

function Dashboard() {
  const { status, servos, values, select, discover } = useSession();
  const [, setConnectionOpen] = useConnectionPopover();
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Dashboard</h1>
      {status === "disconnected" || status === "error" ? (
        <Empty>
          <Button
            size="lg"
            onClick={() => {
              setConnectionOpen(true);
            }}
          >
            <Plug />
            Connect adapter
          </Button>
        </Empty>
      ) : status !== "ready" ? (
        <Grid>
          {Array.from({ length: SKELETONS }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </Grid>
      ) : servos.length === 0 ? (
        <Empty>
          <span className="text-text-3">No servos found</span>
          <Button variant="outline" onClick={() => void discover()}>
            <RefreshCw />
            Rescan
          </Button>
        </Empty>
      ) : (
        <Grid>
          {servos.map((servo) => (
            <ServoCard
              key={servo.uid}
              servo={servo}
              values={values.get(servo.uid)}
              onOpen={() => {
                select(servo.id);
              }}
            />
          ))}
        </Grid>
      )}
    </>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-3 gap-4">{children}</div>;
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong px-6 py-12">
      {children}
    </div>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-16" />
      </CardHeader>
      <CardContent>
        <Readouts>
          {Array.from({ length: 4 }, (_, i) => (
            <Readout key={i} label={<Skeleton className="h-4 w-14" />}>
              <Skeleton className="h-6 w-20" />
            </Readout>
          ))}
        </Readouts>
        <Skeleton className="h-5 w-24" />
      </CardContent>
      <CardFooter>
        <Skeleton className="h-4 w-full" />
      </CardFooter>
    </Card>
  );
}

function Readouts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>;
}

function Readout({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-text-3">{label}</dt>
      <dd className="font-mono text-base tabular-nums">{children}</dd>
    </div>
  );
}

function ServoCard({
  servo,
  values,
  onOpen,
}: {
  servo: Servo;
  values: CardValues | undefined;
  onOpen: () => void;
}) {
  const { ping } = servo;
  const fault = values === undefined ? undefined : faultText(values.health.faultFlags);
  const calibrated = values?.constants.calibrated.valid;
  return (
    <Link
      to="/servo"
      search={true}
      onClick={onOpen}
      className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-shadow hover:shadow-el-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cog className="size-5" />
            ID {servo.id}
            <span
              className="size-2.5 rounded-full bg-text-3 data-[health=fault]:bg-danger data-[health=ok]:bg-success"
              data-health={values === undefined ? undefined : fault === undefined ? "ok" : "fault"}
            />
          </CardTitle>
          <CardAction>
            {calibrated === true && (
              <Badge className="bg-success-soft text-success">
                <Check />
                calibrated
              </Badge>
            )}
            {calibrated === false && (
              <Badge variant="outline" className="border-dashed text-text-3">
                raw
              </Badge>
            )}
          </CardAction>
        </CardHeader>
        <CardContent>
          <Readouts>
            <Readout label="Position">
              {values === undefined ? (
                <Skeleton className="h-6 w-20" />
              ) : values.constants.calibrated.valid ? (
                formatQuantity(
                  positionDeg(values.live.pos, values.constants.calibration),
                  DISPLAY.position,
                )
              ) : (
                formatQuantity(values.live.pos, DISPLAY.raw)
              )}
            </Readout>
            <Readout label="Temperature">
              {values === undefined ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                formatQuantity(
                  temperatureC(values.live.ntcRaw, values.constants.sense),
                  DISPLAY.temperature,
                )
              )}
            </Readout>
            <Readout label="Current">
              {values === undefined ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                formatQuantity(
                  currentMa(
                    values.live.current,
                    values.live.biases.currentBiasCounts,
                    values.constants.sense,
                  ),
                  DISPLAY.current,
                )
              )}
            </Readout>
            <Readout label="Bus voltage">
              {values === undefined ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                formatQuantity(
                  busV(values.live.vbusRaw, values.constants.sense),
                  DISPLAY.busVoltage,
                )
              )}
            </Readout>
          </Readouts>
          {values === undefined ? (
            <Skeleton className="h-5 w-24" />
          ) : (
            <StatusLine values={values} fault={fault} />
          )}
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-x-4 font-mono text-xs text-text-3">
          <span>{servo.uid}</span>
          {ping === undefined ? (
            <span>duplicate id</span>
          ) : (
            <span>
              <span>{hex16(ping.model)}</span> <span>{formatVersion(unpackVersion(ping.fw))}</span>
            </span>
          )}
        </CardFooter>
      </Card>
    </Link>
  );
}

// The pane's priority rule: fault, then unsaved changes, then calibration.
function StatusLine({ values, fault }: { values: CardValues; fault: string | undefined }) {
  if (fault !== undefined) {
    return (
      <p className="flex items-center gap-1.5 text-danger">
        <CircleAlert className="size-4" />
        {fault}
      </p>
    );
  }
  if (values.health.configDirty) {
    return (
      <p className="flex items-center gap-1.5 text-warning">
        <Pencil className="size-4" />
        Unsaved changes
      </p>
    );
  }
  if (!values.constants.calibrated.valid) {
    return (
      <p className="flex items-center gap-1.5 text-text-3">
        <Cog className="size-4" />
        Not calibrated
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-success">
      <CircleCheck className="size-4" />
      No faults
    </p>
  );
}
