import type { Field } from "@openservocore/client";
import { Check, CircleQuestionMark, Ruler } from "lucide-react";
import { useId } from "react";
import { ValueEditor } from "@/components/value-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBus } from "@/lib/bus/hooks";
import { CALIBRATION_REGISTERS, editReason, type CalibrationRegister } from "@/lib/calibration";
import { hexAddr } from "@/lib/format";
import { useSession } from "@/lib/session";
import { calibrationStatus, type Calibration } from "@/lib/units";

export function CalibrationCard({ id, uid }: { id: number; uid: string }) {
  const { descriptor, descriptorError, values, refreshConstants } = useSession();
  const bus = useBus();
  const cal = values.get(uid)?.constants.calibration;
  const fields = descriptor?.fields();

  async function apply(field: Field, raw: number) {
    await bus.write(id, field.name, { kind: field.kind === "int" ? "int" : "uint", value: raw });
    // The write dirties the CALIB span; the session re-reads the constants
    // every card on the page shows.
    refreshConstants(uid);
  }

  return (
    <Card role="region" aria-label="Calibration" className="col-span-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ruler className="size-4" />
          Calibration
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="About calibration">
                <CircleQuestionMark />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start">
              Five numbers map the sensor's counts to degrees at the output shaft. Click a value to
              edit it; degrees appear everywhere once all five make sense.
            </PopoverContent>
          </Popover>
        </CardTitle>
        {cal !== undefined && (
          <CardAction>
            <StatusChip cal={cal} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {descriptorError !== undefined && <p className="text-danger">{descriptorError}</p>}
        {cal === undefined || fields === undefined ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {CALIBRATION_REGISTERS.map((reg) => (
              <Skeleton key={reg.name} className="h-12 w-40" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {CALIBRATION_REGISTERS.map((reg) => (
              <Row
                key={reg.name}
                reg={reg}
                field={fieldNamed(fields, reg.name)}
                cal={cal}
                onApply={apply}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function fieldNamed(fields: readonly Field[], name: string): Field {
  const f = fields.find((f) => f.name === name);
  if (f === undefined) throw new Error(`descriptor has no ${name}`);
  return f;
}

function StatusChip({ cal }: { cal: Calibration }) {
  const status = calibrationStatus(cal);
  if (status.valid) {
    return (
      <Badge className="bg-success-soft text-success">
        <Check />
        Calibrated
      </Badge>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge variant="outline" className="text-text-3">
          Not calibrated
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{status.reason}</TooltipContent>
    </Tooltip>
  );
}

function Row({
  reg,
  field,
  cal,
  onApply,
}: {
  reg: CalibrationRegister;
  field: Field;
  cal: Calibration;
  onApply: (field: Field, raw: number) => Promise<void>;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-0.5">
      <span id={labelId} className="text-xs text-text-3">
        {reg.label}
      </span>
      <span className="self-start text-base">
        <ValueEditor
          field={field}
          value={cal[reg.key]}
          display={reg.display}
          validate={(raw) => (typeof raw === "number" ? editReason(cal, reg.name, raw) : undefined)}
          onApply={(raw) => (typeof raw === "number" ? onApply(field, raw) : Promise.resolve())}
        />
      </span>
      <span className="font-mono text-xs text-text-3">
        {field.name} {hexAddr(field.addr)}
      </span>
    </div>
  );
}
