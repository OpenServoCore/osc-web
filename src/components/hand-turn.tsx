import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBus, useRegisters } from "@/lib/bus/hooks";
import { countDirection, MIN_TURN_COUNTS } from "@/lib/ident-setup";
import { useSession } from "@/lib/session";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The count direction read off the selected servo while the user turns its horn by hand. */
export function HandTurn({ onSave }: { onSave: (risesCcw: boolean) => Promise<void> }) {
  const { status, servos, selected } = useSession();
  const [open, setOpen] = useState(false);
  const live = status === "ready" || status === "scanning";
  const servo = live ? servos.find((s) => s.id === selected) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="link" size="sm" className="h-auto px-0">
          Turn the horn
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-88 gap-2" aria-label="Turn the horn">
        <span className="font-medium">Turn the horn</span>
        {servo === undefined ? (
          <p className="text-xs text-text-3">
            Connect the servo and pick it in the left pane: its reading tells the direction.
          </p>
        ) : (
          open && (
            <Reading
              key={servo.uid}
              id={servo.id}
              onSave={async (risesCcw) => {
                await onSave(risesCcw);
                setOpen(false);
              }}
              onCancel={() => {
                setOpen(false);
              }}
            />
          )
        )}
      </PopoverContent>
    </Popover>
  );
}

function Reading({
  id,
  onSave,
  onCancel,
}: {
  id: number;
  onSave: (risesCcw: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const bus = useBus();
  const snapshot = useRegisters(id, ["pos"], "fast");
  const pos = snapshot?.values.has("pos") === true ? snapshot.read("pos") : undefined;
  const [before, setBefore] = useState<number>();
  const [problem, setProblem] = useState<string>();
  const [pending, setPending] = useState(false);

  async function start() {
    if (pos === undefined) return;
    setPending(true);
    try {
      await bus.write(id, "torque_enable", { kind: "bool", value: false });
      setBefore(pos);
      setProblem(undefined);
    } catch (e) {
      setProblem(message(e));
    } finally {
      setPending(false);
    }
  }

  async function done() {
    if (before === undefined || pos === undefined) return;
    const found = countDirection(before, pos);
    if ("short" in found) {
      setProblem(
        `The reading moved ${found.short} counts: turn the horn further, at least ${MIN_TURN_COUNTS}`,
      );
      return;
    }
    setPending(true);
    try {
      await onSave(found.risesCcw);
    } catch (e) {
      setProblem(message(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <p className="text-xs text-text-3">
        {before === undefined
          ? `Start switches ID ${id}'s torque off. Then, facing the horn, turn it counterclockwise by hand, a quarter turn or so, and press Done.`
          : "Facing the horn, turn it counterclockwise by hand, then press Done."}
      </p>
      <p className="font-mono text-sm">
        reading {pos ?? "-"}
        {before !== undefined &&
          pos !== undefined &&
          ` (from ${before}, ${pos - before >= 0 ? "+" : ""}${pos - before})`}
      </p>
      <p
        role={problem === undefined ? undefined : "status"}
        className="min-h-[1.125rem] text-xs text-warning"
      >
        {problem}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {before === undefined ? (
          <Button
            type="button"
            size="sm"
            disabled={pos === undefined || pending}
            onClick={() => void start()}
          >
            {pending && <LoaderCircle className="animate-spin" />}
            Start
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={pos === undefined || pending}
            onClick={() => void done()}
          >
            {pending && <LoaderCircle className="animate-spin" />}
            Done
          </Button>
        )}
      </div>
    </>
  );
}
