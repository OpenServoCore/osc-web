import type { OscClient } from "@openservocore/client";
import { LoaderCircle, RotateCcw, Save, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBus, useRegisters } from "@/lib/bus/hooks";
import { ID_MAX, ID_MIN, idIssue, rescans, selectAfter, type ManageAction } from "@/lib/manage";
import { useSession } from "@/lib/session";

const NOTE_MS = 4000;
/** Inside the cards' span on every servo, so the gate costs no exchange. */
const TORQUE_REGISTERS: readonly string[] = ["torque_enable"];

const HELP = {
  id: "Addressed by serial, so it also fixes two servos sharing an id. Ids 1 to 249.",
  settings: "Save keeps changes across power off.",
  danger: "Erases settings and calibration; comes back as ID 1 at 1 M.",
};

/** Protocol sec 9.4: flash programming, not the data, is what torque gates. */
const TORQUE_ON = "Turn torque off first: saving stalls the servo while it writes flash.";

type Row = keyof typeof HELP;

interface Note {
  row: Row;
  text: string;
  bad: boolean;
}

export function ManageCard({ id, uid }: { id: number; uid: string }) {
  const { servos, discover, select } = useSession();
  const bus = useBus();
  const inputId = useId();
  const [text, setText] = useState(String(id));
  const [busy, setBusy] = useState<ManageAction>();
  const [note, setNote] = useState<Note>();
  const [confirming, setConfirming] = useState(false);
  const torque = useTorque(id);

  useEffect(() => {
    if (note === undefined || note.bad) return;
    const timer = window.setTimeout(() => {
      setNote(undefined);
    }, NOTE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [note]);

  const next = Number(text);
  // Untouched, the field holds this servo's own id: no point saying so.
  const issue =
    text === String(id)
      ? undefined
      : idIssue(
          next,
          id,
          servos.map((s) => s.id),
        );

  async function act(
    row: Row,
    action: ManageAction,
    fn: (client: OscClient) => Promise<void>,
    done: string,
    newId: number,
  ) {
    setBusy(action);
    setNote(undefined);
    try {
      await bus.command(fn);
      if (rescans(action)) await discover();
      const pick = selectAfter(action, newId);
      if (pick !== undefined) select(pick);
      setNote({ row, text: done, bad: false });
    } catch (e) {
      setNote({ row, text: e instanceof Error ? e.message : String(e), bad: true });
    } finally {
      setBusy(undefined);
    }
  }

  function hint(row: Row): Note {
    if (row === "id" && issue !== undefined) return { row, text: issue, bad: true };
    if (note?.row === row) return note;
    return { row, text: HELP[row], bad: false };
  }

  const saveButton = (
    <Button
      disabled={torque === true || busy !== undefined}
      onClick={() => void act("settings", "save", (c) => c.save(id), "Settings saved.", id)}
    >
      {busy === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}
      Save settings
    </Button>
  );

  return (
    <Card role="region" aria-label="Manage" className="col-span-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="size-4" />
          Manage
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId}>Servo id</Label>
          <div className="flex items-center gap-2">
            <Input
              id={inputId}
              type="number"
              min={ID_MIN}
              max={ID_MAX}
              autoComplete="off"
              className="w-24 font-mono"
              value={text}
              aria-invalid={issue !== undefined}
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
            <Button
              variant="outline"
              disabled={issue !== undefined || text === String(id) || busy !== undefined}
              onClick={() =>
                void act(
                  "id",
                  "assign",
                  (c) => c.assign(uid, next),
                  `This servo is now ID ${next}.`,
                  next,
                )
              }
            >
              {busy === "assign" && <LoaderCircle className="animate-spin" />}
              Assign
            </Button>
          </div>
          <Hint note={hint("id")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {torque === true ? (
              // The disabled button drops pointer events, so the wrapper hosts the tooltip.
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>{saveButton}</div>
                </TooltipTrigger>
                <TooltipContent>{TORQUE_ON}</TooltipContent>
              </Tooltip>
            ) : (
              saveButton
            )}
            <Button
              variant="outline"
              disabled={busy !== undefined}
              onClick={() =>
                void act(
                  "settings",
                  "reboot",
                  (c) => c.reboot(id),
                  "Rebooting .. back in a moment.",
                  id,
                )
              }
            >
              {busy === "reboot" ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
              Reboot
            </Button>
          </div>
          <Hint note={hint("settings")} />
        </div>

        <Separator />

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide text-text-3 uppercase">
            Danger zone
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="border-danger text-danger hover:bg-danger-soft hover:text-danger"
              disabled={busy !== undefined}
              onClick={() => {
                setConfirming(true);
              }}
            >
              {busy === "factory" ? <LoaderCircle className="animate-spin" /> : <TriangleAlert />}
              Factory reset
            </Button>
          </div>
          <Hint note={hint("danger")} />
          {confirming && (
            <div
              className="flex flex-col gap-2 rounded-md border-l-4 border-danger bg-danger-soft p-3"
              onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key !== "Escape") return;
                e.stopPropagation();
                setConfirming(false);
              }}
            >
              <p>
                <b>ID {id}</b> loses its settings and calibration, then comes back as ID 1 at 1 M.
              </p>
              <div className="flex gap-2">
                <Button
                  autoFocus
                  className="bg-danger text-white hover:bg-danger/90"
                  onClick={() => {
                    setConfirming(false);
                    void act(
                      "danger",
                      "factory",
                      (c) => c.factory(id),
                      "Erased. It comes back as ID 1 at 1 M.",
                      id,
                    );
                  }}
                >
                  Erase
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Hint({ note }: { note: Note }) {
  return <p className={`text-xs ${note.bad ? "text-danger" : "text-text-3"}`}>{note.text}</p>;
}

/**
 * The Save gate: `torque_enable` on the cards' cadence. A stale snapshot still
 * carries the last reading; Health reports a servo gone quiet.
 */
function useTorque(id: number): boolean | undefined {
  const value = useRegisters(id, TORQUE_REGISTERS, "slow")?.values.get("torque_enable");
  return value?.kind === "bool" ? value.value : undefined;
}
