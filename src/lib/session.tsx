import type { Descriptor, Found, OscClient, Ping } from "@openservocore/client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { openClient, simRequested } from "./backend";
import { fetchDescriptor } from "./descriptor";

/** `ping` is undefined only when the id was answered by more than one node. */
export interface Servo extends Found {
  ping: Ping | undefined;
}

export interface Session {
  client: OscClient | undefined;
  simulated: boolean;
  servos: Servo[];
  selected: number | undefined;
  descriptor: Descriptor | undefined;
  descriptorError: string | undefined;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  discover: () => Promise<void>;
  select: (id: number | undefined) => Promise<void>;
}

const SessionContext = createContext<Session | undefined>(undefined);

async function pingAll(client: OscClient, found: Found[]): Promise<Servo[]> {
  const count = new Map<number, number>();
  for (const f of found) count.set(f.id, (count.get(f.id) ?? 0) + 1);
  return Promise.all(
    found.map(async (f) => ({
      ...f,
      ping: count.get(f.id) === 1 ? await client.ping(f.id) : undefined,
    })),
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<OscClient>();
  const [simulated, setSimulated] = useState(false);
  const [servos, setServos] = useState<Servo[]>([]);
  const [selected, setSelected] = useState<number>();
  const [descriptor, setDescriptor] = useState<Descriptor>();
  const [descriptorError, setDescriptorError] = useState<string>();

  function clearDescriptor() {
    descriptor?.free();
    setDescriptor(undefined);
    setDescriptorError(undefined);
  }

  async function connect() {
    setClient(await openClient());
    setSimulated(simRequested());
  }

  useEffect(() => {
    if (!simRequested()) return;
    void openClient().then((c) => {
      setClient(c);
      setSimulated(true);
    });
  }, []);

  async function disconnect() {
    if (client === undefined) return;
    setClient(undefined);
    setSimulated(false);
    setServos([]);
    setSelected(undefined);
    clearDescriptor();
    await client.close();
    client.free();
  }

  async function discover() {
    if (client === undefined) return;
    setServos(await pingAll(client, await client.discover()));
  }

  async function select(id: number | undefined) {
    setSelected(id);
    clearDescriptor();
    const ping = servos.find((s) => s.id === id)?.ping;
    if (ping === undefined) return;
    try {
      setDescriptor(await fetchDescriptor(ping.model, ping.fw));
    } catch (e) {
      setDescriptorError(e instanceof Error ? e.message : String(e));
    }
  }

  const value: Session = {
    client,
    simulated,
    servos,
    selected,
    descriptor,
    descriptorError,
    connect,
    disconnect,
    discover,
    select,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (s === undefined) throw new Error("useSession outside SessionProvider");
  return s;
}
