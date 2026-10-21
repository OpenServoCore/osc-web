import {
  parseImage,
  unpackVersion,
  type BaudRate,
  type BootRow,
  type Found,
  type OscClient,
  type Version,
} from "@openservocore/client";
import { useBlocker } from "@tanstack/react-router";
import {
  CircleCheck,
  CircleX,
  Cog,
  HardDriveUpload,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useBus } from "@/lib/bus/hooks";
import { isDisconnect } from "@/lib/bus/stats";
import {
  canEnter,
  COMPAT_UNSET,
  deviceLabel,
  fileRefusal,
  hex32,
  installedVersion,
  leaveWarning,
  locked,
  matching,
  preselect,
  progressText,
  restartResult,
  shortUid,
  stepIndex,
  STEPS,
  UPDATE_RATE_DEFAULT,
  updatingText,
  verdictText,
  type AppReport,
  type LoadedFile,
  type Phase,
  type RestartResult,
} from "@/lib/firmware-update";
import { BAUD_RATES, formatBaud, formatVersion } from "@/lib/format";
import { useSession } from "@/lib/session";

interface Device {
  row: BootRow;
  version: Version | null;
  checked: boolean;
  file: string | undefined;
  progress: [number, number] | undefined;
  result: { text: string; ok: boolean } | undefined;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function FirmwareItem() {
  const { status, baud, discover } = useSession();
  // The rate is kept from the click: a lost adapter clears the session's.
  const [fleetRate, setFleetRate] = useState<BaudRate>();
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip="Update firmware"
        disabled={status !== "ready" || baud === undefined}
        onClick={() => {
          setFleetRate(baud);
        }}
      >
        <HardDriveUpload />
        <span>Update firmware</span>
      </SidebarMenuButton>
      {fleetRate !== undefined && (
        <FirmwareDialog
          fleetRate={fleetRate}
          onClosed={(ran) => {
            setFleetRate(undefined);
            if (ran) void discover();
          }}
        />
      )}
    </SidebarMenuItem>
  );
}

interface Held {
  client: OscClient | undefined;
  error: string | undefined;
  /** Ends the turn with this failure, so the bus reports a gone adapter to the session. */
  fail: (e: unknown) => void;
}

/** Holds the bus as one exclusive turn for as long as the dialog is mounted. */
function useHeldClient(): Held {
  const bus = useBus();
  const [client, setClient] = useState<OscClient>();
  const [error, setError] = useState<string>();
  const failure = useRef<Error>(undefined);
  useEffect(() => {
    let live = true;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    bus
      .exclusive(async (c) => {
        if (live) setClient(c);
        await released;
        if (failure.current !== undefined) throw failure.current;
      })
      .catch((e: unknown) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
      release();
    };
  }, [bus]);
  const fail = (e: unknown) => {
    failure.current = e instanceof Error ? e : new Error(message(e));
  };
  return { client, error, fail };
}

function FirmwareDialog({
  fleetRate,
  onClosed,
}: {
  fleetRate: BaudRate;
  onClosed: (ran: boolean) => void;
}) {
  const held = useHeldClient();
  const client = held.client;
  const { status, servos } = useSession();
  const rateId = useId();
  const filesId = useId();
  const nextKey = useRef(0);
  const [phase, setPhase] = useState<Phase>("prepare");
  const [rate, setRate] = useState<BaudRate>(UPDATE_RATE_DEFAULT);
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [roster, setRoster] = useState<Found[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [listed, setListed] = useState(false);
  const [installed, setInstalled] = useState<ReadonlySet<string>>(new Set());
  const [turn, setTurn] = useState<{ index: number; count: number }>();
  const [result, setResult] = useState<RestartResult>();
  const [error, setError] = useState<string>();
  const [warned, setWarned] = useState(false);
  const [dropped, setDropped] = useState(false);
  const lost = dropped || status === "lost";
  const isLocked = locked(phase, lost);
  const warning = leaveWarning(phase, lost, warned);
  const busy = phase === "entering" || phase === "flashing" || phase === "restarting";

  useBlocker({
    shouldBlockFn: () => {
      setWarned(true);
      return true;
    },
    enableBeforeUnload: isLocked,
    disabled: !isLocked,
  });

  function leave() {
    if (isLocked) {
      setWarned(true);
      return;
    }
    onClosed(phase === "done");
  }

  /** A call's failure; true when the adapter itself is gone. */
  function failed(e: unknown): boolean {
    if (!isDisconnect(e)) return false;
    held.fail(e);
    setDropped(true);
    return true;
  }

  function update(uid: string, patch: Partial<Device>) {
    setDevices((ds) => ds.map((d) => (d.row.uid === uid ? { ...d, ...patch } : d)));
  }

  async function load(list: FileList | null) {
    if (list === null) return;
    const added = await Promise.all(
      [...list].map(async (f) => {
        const bytes = new Uint8Array(await f.arrayBuffer());
        return { key: String(nextKey.current++), name: f.name, bytes, check: parseImage(bytes) };
      }),
    );
    setFiles((fs) => [...fs, ...added]);
  }

  async function enter(c: OscClient) {
    setPhase("entering");
    setError(undefined);
    const apps: AppReport[] = servos.flatMap((s) =>
      s.ping === undefined ? [] : [{ uid: s.uid, version: unpackVersion(s.ping.fw) }],
    );
    try {
      setRoster(await c.bootEnter(rate));
      const rows = await c.bootList(rate);
      setListed(true);
      setDevices(
        rows.map((row) => ({
          row,
          version: installedVersion(row, apps),
          checked: false,
          file: preselect(row.compat, files),
          progress: undefined,
          result: undefined,
        })),
      );
    } catch (e) {
      failed(e);
      setError(message(e));
    }
    setPhase("devices");
  }

  async function flash(c: OscClient) {
    const queue = devices.filter((d) => d.checked && d.file !== undefined);
    setPhase("flashing");
    setError(undefined);
    for (const [index, d] of queue.entries()) {
      setTurn({ index, count: queue.length });
      const uid = d.row.uid;
      const image = files.find((f) => f.key === d.file);
      if (image === undefined) continue;
      update(uid, { progress: [0, image.bytes.length], result: undefined });
      try {
        const verdict = await c.bootInstall(uid, image.bytes, (written, total) => {
          update(uid, { progress: [written, total] });
        });
        const ok = verdict.kind === "installed";
        update(uid, {
          progress: undefined,
          result: { text: verdictText(verdict), ok },
          checked: !ok,
        });
        if (ok) setInstalled((s) => new Set(s).add(uid));
      } catch (e) {
        update(uid, { progress: undefined, result: { text: message(e), ok: false } });
        if (failed(e)) break;
      }
    }
    setTurn(undefined);
    setPhase("flashed");
  }

  async function restart(c: OscClient) {
    const before = phase;
    setPhase("restarting");
    setError(undefined);
    try {
      const rows = listed ? devices.map((d) => d.row) : await c.bootList(rate);
      await c.bootResetAll(fleetRate);
      const found = await c.discover();
      const counts = new Map<number, number>();
      for (const f of found) counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
      const back = [];
      // An id two nodes answer at would garble the identity read.
      for (const f of found.filter((f) => counts.get(f.id) === 1)) {
        back.push({ ...f, version: unpackVersion((await c.identity(f.id)).fw) });
      }
      setResult(restartResult(back, rows, installed));
      setWarned(false);
      setPhase("done");
    } catch (e) {
      failed(e);
      setError(message(e));
      setPhase(before === "restarting" ? "flashed" : before);
    }
  }

  const queued = devices.filter((d) => d.checked && d.file !== undefined).length;
  const description =
    phase === "flashing" && turn !== undefined
      ? updatingText(turn.index, turn.count)
      : {
          prepare: "Load the firmware files, then put every servo in its bootloader.",
          entering: "Putting every servo in its bootloader ..",
          devices: "Pick the boards to update and the file for each.",
          flashing: "Updating ..",
          flashed: "Restart all to bring every board back to its app.",
          restarting: "Restarting every board ..",
          done: "Every board with an app is running it again.",
        }[phase];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) leave();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] flex-col sm:max-w-[calc(100vw-2rem)]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <HardDriveUpload className="size-5" />
            Update firmware
          </DialogTitle>
          <DialogDescription className="text-base">{description}</DialogDescription>
        </DialogHeader>

        <ol className="flex gap-6 text-sm">
          {STEPS.map((label, i) => (
            <li
              key={label}
              aria-current={i === stepIndex(phase) ? "step" : undefined}
              className="flex items-center gap-2 text-text-3 aria-[current=step]:font-medium aria-[current=step]:text-foreground"
            >
              <Badge variant={i < stepIndex(phase) ? "default" : "outline"}>{i + 1}</Badge>
              {label}
            </li>
          ))}
        </ol>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto">
          {phase === "prepare" ? (
            <>
              <Alert className="border-warning bg-warning-soft text-warning">
                <TriangleAlert />
                <AlertTitle>Rest the robot first: every servo goes limp.</AlertTitle>
              </Alert>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={rateId}>Update speed</Label>
                <Select
                  value={rate}
                  onValueChange={(v) => {
                    setRate(v as BaudRate);
                  }}
                >
                  <SelectTrigger id={rateId} className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BAUD_RATES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {formatBaud(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-text-3">Slower is safer on long or unknown wiring.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={filesId}>Firmware files</Label>
                <Input
                  id={filesId}
                  type="file"
                  accept=".bin"
                  multiple
                  className="w-96"
                  onChange={(e) => {
                    void load(e.target.files);
                    e.target.value = "";
                  }}
                />
                <ul className="flex flex-col gap-1">
                  {files.map((f) => (
                    <FileLine key={f.key} file={f} />
                  ))}
                </ul>
              </div>
            </>
          ) : phase === "done" && result !== undefined ? (
            <RestartView result={result} roster={roster} />
          ) : (
            <DeviceTable
              devices={devices}
              files={files}
              roster={roster}
              busy={busy}
              onChange={update}
            />
          )}
          {held.error !== undefined && <p className="text-danger">{held.error}</p>}
          {error !== undefined && <p className="text-danger">{error}</p>}
        </div>

        <DialogFooter className="items-center">
          {warning !== undefined && (
            <p className="mr-auto flex items-center gap-2 text-danger">
              <TriangleAlert className="size-4 shrink-0" />
              {warning}
            </p>
          )}
          {phase === "prepare" && (
            <>
              <Button variant="outline" onClick={leave}>
                Cancel
              </Button>
              <Button
                disabled={!canEnter(files, client !== undefined && !lost)}
                onClick={() => {
                  if (client !== undefined) void enter(client);
                }}
              >
                Enter bootloaders
              </Button>
            </>
          )}
          {isLocked && (
            <>
              {(phase === "devices" || phase === "flashed" || phase === "flashing") && (
                <Button
                  variant="outline"
                  disabled={busy || queued === 0}
                  onClick={() => {
                    if (client !== undefined) void flash(client);
                  }}
                >
                  {phase === "flashing" && <LoaderCircle className="animate-spin" />}
                  Flash selected
                </Button>
              )}
              <Button
                disabled={busy}
                onClick={() => {
                  if (client !== undefined) void restart(client);
                }}
              >
                {phase === "restarting" && <LoaderCircle className="animate-spin" />}
                Restart all
              </Button>
            </>
          )}
          {(phase === "done" || (lost && phase !== "prepare")) && (
            <Button onClick={leave}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileLine({ file }: { file: LoadedFile }) {
  const refusal = fileRefusal(file.check);
  return (
    <li className="flex items-baseline gap-3">
      <span className="font-medium">{file.name}</span>
      {file.check.kind === "ok" ? (
        <>
          <span>Version {formatVersion(file.check.version)}</span>
          <span className="font-mono text-xs text-text-3">
            board key {hex32(file.check.compat)}
          </span>
        </>
      ) : (
        <span className="text-danger">{refusal}</span>
      )}
    </li>
  );
}

function rowStatus(d: Device): { text: string; ok: boolean | undefined } | undefined {
  if (d.progress !== undefined) return { text: progressText(...d.progress), ok: undefined };
  return d.result;
}

function DeviceTable({
  devices,
  files,
  roster,
  busy,
  onChange,
}: {
  devices: Device[];
  files: LoadedFile[];
  roster: Found[];
  busy: boolean;
  onChange: (uid: string, patch: Partial<Device>) => void;
}) {
  if (devices.length === 0) return null;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-text-3">
        <tr className="border-b">
          <th className="w-10 px-3 py-2" />
          <th className="px-3 py-2 font-medium">Device</th>
          <th className="px-3 py-2 font-medium">Board key</th>
          <th className="px-3 py-2 font-medium">Installed</th>
          <th className="px-3 py-2 font-medium">File</th>
          <th className="px-3 py-2 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {devices.map((d) => {
          const label = deviceLabel(d.row, roster);
          const options = matching(d.row.compat, files);
          const status = rowStatus(d);
          return (
            <tr key={d.row.uid} className="border-b align-top">
              <td className="px-3 py-3">
                <Checkbox
                  aria-label={`Update ${label} ${shortUid(d.row.uid)}`}
                  checked={d.checked}
                  disabled={busy || d.file === undefined}
                  onCheckedChange={(v) => {
                    onChange(d.row.uid, { checked: v === true });
                  }}
                />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2 font-medium">
                  <Cog className="size-4" />
                  {label}
                  <span className="font-mono font-normal">{shortUid(d.row.uid)}</span>
                </div>
                <div className="font-mono text-xs text-text-3">{d.row.uid}</div>
              </td>
              <td className="px-3 py-2 font-mono">
                {d.row.compat === COMPAT_UNSET ? "none" : hex32(d.row.compat)}
              </td>
              <td className="px-3 py-2">
                {d.version === null ? "None" : formatVersion(d.version)}
              </td>
              <td className="px-3 py-2">
                {options.length === 0 ? (
                  <span className="text-text-3">No loaded file is for this board</span>
                ) : (
                  <Select
                    value={d.file ?? ""}
                    disabled={busy}
                    onValueChange={(file) => {
                      onChange(d.row.uid, { file });
                    }}
                  >
                    <SelectTrigger aria-label={`File for ${label}`} className="w-64">
                      <SelectValue placeholder="Pick a file" />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.name}
                          {f.check.kind === "ok" && ` (${formatVersion(f.check.version)})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </td>
              <td className="px-3 py-2">
                {status !== undefined && (
                  <span
                    className="flex items-center gap-2 data-[ok=false]:text-danger data-[ok=true]:text-success"
                    data-ok={status.ok}
                  >
                    {status.ok === undefined ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : status.ok ? (
                      <CircleCheck className="size-4" />
                    ) : (
                      <CircleX className="size-4" />
                    )}
                    {status.text}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RestartView({ result, roster }: { result: RestartResult; roster: Found[] }) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Back on the bus" className="flex flex-col gap-2">
        <h3 className="font-medium">Back on the bus</h3>
        <ul className="flex flex-col gap-1">
          {result.back.map((s) => (
            <li key={s.id} className="flex items-center gap-3">
              <Cog className="size-4" />
              <span className="w-16 font-medium">ID {s.id}</span>
              <span>{formatVersion(s.version)}</span>
              {s.updated && <Badge className="bg-success-soft text-success">new</Badge>}
            </li>
          ))}
        </ul>
      </section>
      {result.waiting.length > 0 && (
        <section aria-label="Waiting for firmware" className="flex flex-col gap-2">
          <h3 className="font-medium">Waiting for firmware</h3>
          <ul className="flex flex-col gap-1">
            {result.waiting.map((r) => (
              <li key={r.uid} className="flex items-center gap-3">
                <Cog className="size-4" />
                <span className="font-medium">{deviceLabel(r, roster)}</span>
                <span className="font-mono">{shortUid(r.uid)}</span>
                <span className="text-text-3">still in its bootloader</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
