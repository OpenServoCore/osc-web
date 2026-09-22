import { unpackVersion } from "@openservocore/client";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { formatVersion, hex16 } from "../lib/format";
import { useSession } from "../lib/session";

export const Route = createFileRoute("/")({ component: ConnectPage });

const cell = "border-b border-border px-3 py-1 text-left";

function ConnectPage() {
  const { servos, selected, select } = useSession();
  const [error, setError] = useState<string>();

  async function run(action: () => Promise<void>) {
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Connect</h1>
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
