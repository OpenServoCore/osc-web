import { unpackVersion, type BaudRate, type Rails } from "@openservocore/client";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatBaud, formatVersion, hex16 } from "../lib/format";
import { useSession } from "../lib/session";

export const Route = createFileRoute("/")({ component: ConnectPage });

interface BusStatus {
  rails: Rails;
  baud: BaudRate | undefined;
}

function ConnectPage() {
  const { client, servos, selected, connect, disconnect, discover, select } = useSession();
  const [error, setError] = useState<string>();
  const [bus, setBus] = useState<BusStatus>();

  useEffect(() => {
    if (client === undefined) return;
    let live = true;
    void Promise.all([client.rails(), client.findBusBaud()])
      .then(([rails, baud]) => {
        if (live) setBus({ rails, baud });
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [client]);

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
        <h1>Connect</h1>
        <button onClick={() => void run(connect)}>Connect adapter</button>
        {error !== undefined && <p className="error">{error}</p>}
      </>
    );
  }

  const link = client.linkInfo();
  return (
    <>
      <h1>Connect</h1>
      <dl>
        <dt>Adapter firmware</dt>
        <dd>{link.version}</dd>
        <dt>Ticks per us</dt>
        <dd>{link.ticksPerUs}</dd>
        <dt>Rails</dt>
        <dd>
          {bus === undefined
            ? "..."
            : `3V3 ${bus.rails.v3v3 ? "on" : "off"}, 5V ${bus.rails.v5 ? "on" : "off"}`}
        </dd>
        <dt>Bus baud</dt>
        <dd>
          {bus === undefined ? "..." : bus.baud === undefined ? "no bus" : formatBaud(bus.baud)}
        </dd>
      </dl>
      <p>
        <button onClick={() => void run(discover)}>Discover</button>{" "}
        <button onClick={() => void run(disconnect)}>Disconnect</button>
      </p>
      {error !== undefined && <p className="error">{error}</p>}
      {servos.length > 0 && (
        <table>
          <thead>
            <tr>
              <th></th>
              <th>ID</th>
              <th>UID</th>
              <th>Model</th>
              <th>Firmware</th>
            </tr>
          </thead>
          <tbody>
            {servos.map((s) => (
              <tr key={s.uid}>
                <td>
                  <input
                    type="radio"
                    name="selected"
                    checked={selected === s.id}
                    onChange={() => void run(() => select(s.id))}
                  />
                </td>
                <td>{s.id}</td>
                <td className="mono">{s.uid}</td>
                {s.ping === undefined ? (
                  <td colSpan={2}>duplicate id</td>
                ) : (
                  <>
                    <td className="mono">{hex16(s.ping.model)}</td>
                    <td>{formatVersion(unpackVersion(s.ping.fw))}</td>
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
