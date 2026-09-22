import init, { OscClient, requestDevice, type Descriptor, type Found } from "@openservocore/client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { fetchDescriptor } from "./descriptor";

export interface Session {
  client: OscClient | undefined;
  servos: Found[];
  selected: number | undefined;
  descriptor: Descriptor | undefined;
  descriptorError: string | undefined;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  discover: () => Promise<void>;
  select: (id: number | undefined) => Promise<void>;
}

const SessionContext = createContext<Session | undefined>(undefined);

let wasmReady: Promise<void> | undefined;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<OscClient>();
  const [servos, setServos] = useState<Found[]>([]);
  const [selected, setSelected] = useState<number>();
  const [descriptor, setDescriptor] = useState<Descriptor>();
  const [descriptorError, setDescriptorError] = useState<string>();

  async function connect() {
    wasmReady ??= init();
    await wasmReady;
    const device = await requestDevice();
    setClient(await OscClient.connect(device));
  }

  async function disconnect() {
    if (client === undefined) return;
    setClient(undefined);
    setServos([]);
    setSelected(undefined);
    setDescriptor(undefined);
    setDescriptorError(undefined);
    await client.close();
  }

  async function discover() {
    if (client === undefined) return;
    setServos(await client.discover());
  }

  async function select(id: number | undefined) {
    setSelected(id);
    setDescriptor(undefined);
    setDescriptorError(undefined);
    const servo = servos.find((s) => s.id === id);
    if (servo === undefined) return;
    try {
      setDescriptor(await fetchDescriptor(servo.model, servo.fw));
    } catch (e) {
      setDescriptorError(e instanceof Error ? e.message : String(e));
    }
  }

  const value: Session = {
    client,
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
