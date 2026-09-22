import { unpackVersion, type Rails } from "@openservocore/client";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatBaud, formatVersion, hex16 } from "../lib/format";
import { useSession } from "../lib/session";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({ component: ConnectPage });

const cell = "border-b border-border px-3 py-1 text-left";

function ConnectPage() {
  const session = useSession();
  const { status, client, baud, servos, selected, connect, disconnect, select } = session;
  const [error, setError] = useState<string>();
  const [rails, setRails] = useState<Rails>();

  // The adapter takes one command at a time: wait for the scan to finish.
  useEffect(() => {
    if (client === undefined || status !== "ready") return;
    let live = true;
    client.rails().then(
      (r) => {
        if (live) setRails(r);
      },
      (e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [client, status]);

  async function run(action: () => Promise<void>) {
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (client === undefined) {
    return (
      <>
        <h1 className="mb-4 text-xl font-semibold">Connect</h1>
        {status === "connecting" ? (
          <p>Connecting ..</p>
        ) : (
          <Button onClick={() => void connect()}>Connect adapter</Button>
        )}
        {session.error !== undefined && <p className="mt-4 text-danger">{session.error}</p>}
      </>
    );
  }

  const link = client.linkInfo();
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Connect</h1>
      <dl className="mb-4 grid grid-cols-[max-content_auto] gap-x-4 gap-y-1">
        <dt>Adapter firmware</dt>
        <dd>{link.version}</dd>
        <dt>Ticks per us</dt>
        <dd>{link.ticksPerUs}</dd>
        <dt>Rails</dt>
        <dd>
          {rails === undefined
            ? "..."
            : `3V3 ${rails.v3v3 ? "on" : "off"}, 5V ${rails.v5 ? "on" : "off"}`}
        </dd>
        <dt>Bus baud</dt>
        <dd>{status !== "ready" ? "..." : baud === undefined ? "no bus" : formatBaud(baud)}</dd>
      </dl>
      <p className="mb-4">
        <Button variant="outline" onClick={() => void run(disconnect)}>
          Disconnect
        </Button>
      </p>
      {error !== undefined && <p className="mb-4 text-danger">{error}</p>}
      {servos.length > 0 && (
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className={cell}></th>
              <th className={cell}>ID</th>
              <th className={cell}>UID</th>
              <th className={cell}>Model</th>
              <th className={cell}>Firmware</th>
            </tr>
          </thead>
          <tbody>
            {servos.map((s) => (
              <tr key={s.uid}>
                <td className={cell}>
                  <input
                    type="radio"
                    name="selected"
                    checked={selected === s.id}
                    onChange={() => void run(() => select(s.id))}
                  />
                </td>
                <td className={cell}>{s.id}</td>
                <td className={`${cell} font-mono`}>{s.uid}</td>
                {s.ping === undefined ? (
                  <td className={cell} colSpan={2}>
                    duplicate id
                  </td>
                ) : (
                  <>
                    <td className={`${cell} font-mono`}>{hex16(s.ping.model)}</td>
                    <td className={cell}>{formatVersion(unpackVersion(s.ping.fw))}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
