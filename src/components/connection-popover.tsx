import type { BaudRate } from "@openservocore/client";
import { LoaderCircle, Plug, RefreshCw, Unplug } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { formatBaud } from "@/lib/format";
import { useSession, type Status } from "@/lib/session";

const rates: BaudRate[] = ["b500000", "b1000000", "b2000000", "b3000000"];

function chip(status: Status): { text: string; className: string } {
  switch (status) {
    case "ready":
    case "scanning":
      return { text: "connected", className: "bg-success-soft text-success" };
    case "connecting":
      return { text: "connecting", className: "bg-surface-3 text-text-2" };
    case "disconnected":
    case "error":
      return { text: "not connected", className: "bg-surface-3 text-text-2" };
  }
}

function servos(n: number): string {
  return n === 1 ? "1 servo" : `${n} servos`;
}

export function ConnectionPopover({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const session = useSession();
  const { status, client, simulated, baud, rails, missing, error } = session;
  const [confirming, setConfirming] = useState(false);
  const [choice, setChoice] = useState<BaudRate>();
  const [railsError, setRailsError] = useState<string>();
  const rate = choice ?? baud ?? "b1000000";
  const connected = client !== undefined;
  const ready = status === "ready";
  const badge = chip(status);

  function reset() {
    setConfirming(false);
    setChoice(undefined);
  }

  function toggle(patch: { v3v3?: boolean; v5?: boolean }) {
    setRailsError(undefined);
    session.setRails(patch).catch((e: unknown) => {
      setRailsError(e instanceof Error ? e.message : String(e));
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        className="w-80"
        onEscapeKeyDown={(e) => {
          if (!confirming) return;
          e.preventDefault();
          setConfirming(false);
        }}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Plug className="size-4 shrink-0" />
            <span className="font-medium">{simulated ? "Simulated adapter" : "osc-adapter"}</span>
            <Badge className={badge.className}>{badge.text}</Badge>
          </div>
          {connected && (
            <span className="text-xs text-text-3">Firmware {client.linkInfo().version}</span>
          )}
        </div>

        {connected ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                reset();
                void session.disconnect();
              }}
            >
              <Unplug />
              Disconnect
            </Button>
            <Button variant="outline" disabled={!ready} onClick={() => void session.discover()}>
              {status === "scanning" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              Rescan
            </Button>
          </div>
        ) : (
          <>
            <Button
              size="lg"
              className="w-full"
              disabled={status === "connecting"}
              onClick={() => {
                reset();
                void session.connect();
              }}
            >
              <Plug />
              Connect adapter
            </Button>
            {error !== undefined && <p className="text-danger">{error}</p>}
          </>
        )}

        {connected && (
          <>
            <Separator />
            <div className="flex flex-col gap-2">
              <span className="font-medium">Power</span>
              <div className="flex items-center justify-between">
                <Label htmlFor="rail-3v3">3V3 logic</Label>
                <Switch
                  id="rail-3v3"
                  checked={rails?.v3v3 ?? false}
                  disabled={!ready || rails === undefined}
                  onCheckedChange={(v3v3) => {
                    toggle({ v3v3 });
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="rail-5v">5V servo</Label>
                <Switch
                  id="rail-5v"
                  checked={rails?.v5 ?? false}
                  disabled={!ready || rails === undefined}
                  onCheckedChange={(v5) => {
                    toggle({ v5 });
                  }}
                />
              </div>
              {railsError !== undefined && <p className="text-danger">{railsError}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="bus-speed" className="font-medium">
                Speed
              </Label>
              <div className="flex gap-2">
                <Select
                  value={rate}
                  onValueChange={(v) => {
                    setChoice(v as BaudRate);
                  }}
                >
                  <SelectTrigger id="bus-speed" className="flex-1" disabled={!ready}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {rates.map((r) => (
                      <SelectItem key={r} value={r}>
                        {formatBaud(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  disabled={!ready}
                  onClick={() => {
                    setConfirming(true);
                  }}
                >
                  Apply
                </Button>
              </div>
              {confirming && ready && (
                <div className="flex flex-col gap-2 rounded-md border-l-4 border-danger bg-danger-soft p-3">
                  <p>
                    Every servo on the bus will switch to{" "}
                    <b className="whitespace-nowrap">{formatBaud(rate)}</b>.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      autoFocus
                      className="bg-danger text-white hover:bg-danger/90"
                      onClick={() => {
                        setConfirming(false);
                        void session.setBaud(rate);
                      }}
                    >
                      Change speed
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
              {ready && (
                <p className="text-xs text-text-3">
                  {missing.length > 0 ? (
                    <>
                      {servos(missing.length)} not answering after the change{" "}
                      <Button
                        variant="link"
                        size="xs"
                        className="h-auto p-0 text-xs"
                        onClick={() => void session.discover()}
                      >
                        Rescan
                      </Button>
                    </>
                  ) : baud === undefined ? (
                    "No servos answering"
                  ) : (
                    `${servos(session.servos.length)} answering at ${formatBaud(baud)}`
                  )}
                </p>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
