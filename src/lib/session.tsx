import type { BaudRate, Descriptor, Found, OscClient } from "@openservocore/client";
import { useNavigate } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { openClient, simRequested } from "./backend";
import { fetchDescriptor } from "./descriptor";
import {
  idle,
  reduce,
  type Servo,
  type SessionEvent,
  type SessionState,
  type Status,
} from "./session-state";

export type { Servo, Status } from "./session-state";

export interface Session {
  status: Status;
  error: string | undefined;
  baud: BaudRate | undefined;
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

interface Snapshot {
  state: SessionState;
  client: OscClient | undefined;
  simulated: boolean;
  descriptor: Descriptor | undefined;
  descriptorError: string | undefined;
}

const initial: Snapshot = {
  state: idle,
  client: undefined,
  simulated: false,
  descriptor: undefined,
  descriptorError: undefined,
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// The adapter takes one command at a time, so the pings run in sequence.
async function pingAll(client: OscClient, found: Found[]): Promise<Servo[]> {
  const count = new Map<number, number>();
  for (const f of found) count.set(f.id, (count.get(f.id) ?? 0) + 1);
  const servos: Servo[] = [];
  for (const f of found) {
    servos.push({ ...f, ping: count.get(f.id) === 1 ? await client.ping(f.id) : undefined });
  }
  return servos;
}

async function release(client: OscClient): Promise<void> {
  try {
    await client.close();
  } finally {
    client.free();
  }
}

/** Owns the wasm client and its commands; `reduce` owns every state change. */
class Controller {
  private snap = initial;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly snapshot = (): Snapshot => this.snap;

  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const listener of this.listeners) listener();
  }

  private dispatch(event: SessionEvent): void {
    this.set({ state: reduce(this.snap.state, event) });
  }

  private clearDescriptor(): void {
    this.snap.descriptor?.free();
    this.set({ descriptor: undefined, descriptorError: undefined });
  }

  async connect(): Promise<void> {
    const { status } = this.snap.state;
    if (status !== "disconnected" && status !== "error") return;
    this.dispatch({ type: "connect" });
    let client: OscClient;
    try {
      client = await openClient();
    } catch (e) {
      this.dispatch({ type: "fail", error: message(e) });
      return;
    }
    this.set({ client, simulated: simRequested() });
    await this.scan(client);
  }

  private async scan(client: OscClient): Promise<void> {
    this.dispatch({ type: "scan" });
    try {
      const baud = await client.findBusBaud();
      const servos = await pingAll(client, await client.discover());
      if (this.snap.client !== client) return;
      this.dispatch({ type: "found", servos, baud });
      if (this.snap.state.selected === undefined) this.clearDescriptor();
    } catch (e) {
      if (this.snap.client !== client) return;
      this.set({ client: undefined, simulated: false });
      this.clearDescriptor();
      this.dispatch({ type: "fail", error: message(e) });
      await release(client);
    }
  }

  async discover(): Promise<void> {
    const { client } = this.snap;
    if (client === undefined || this.snap.state.status !== "ready") return;
    await this.scan(client);
  }

  async disconnect(): Promise<void> {
    const { client } = this.snap;
    if (client === undefined) return;
    this.set({ client: undefined, simulated: false });
    this.clearDescriptor();
    this.dispatch({ type: "disconnect" });
    await release(client);
  }

  async select(id: number | undefined): Promise<void> {
    if (this.snap.state.status !== "ready") return;
    this.dispatch({ type: "select", id });
    this.clearDescriptor();
    const ping = this.snap.state.servos.find((s) => s.id === id)?.ping;
    if (ping === undefined) return;
    try {
      const descriptor = await fetchDescriptor(ping.model, ping.fw);
      if (this.snap.state.selected === id && this.snap.descriptor === undefined) {
        this.set({ descriptor });
      } else {
        descriptor.free();
      }
    } catch (e) {
      if (this.snap.state.selected === id) this.set({ descriptorError: message(e) });
    }
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ctl] = useState(() => new Controller());
  const snap = useSyncExternalStore(ctl.subscribe, ctl.snapshot, ctl.snapshot);
  const navigate = useNavigate();

  useEffect(() => {
    if (simRequested()) void ctl.connect();
  }, [ctl]);

  const value: Session = {
    status: snap.state.status,
    error: snap.state.error,
    baud: snap.state.baud,
    client: snap.client,
    simulated: snap.simulated,
    servos: snap.state.servos,
    selected: snap.state.selected,
    descriptor: snap.descriptor,
    descriptorError: snap.descriptorError,
    connect: () => ctl.connect(),
    disconnect: async () => {
      await Promise.all([ctl.disconnect(), navigate({ to: "/" })]);
    },
    discover: () => ctl.discover(),
    select: (id) => ctl.select(id),
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (s === undefined) throw new Error("useSession outside SessionProvider");
  return s;
}
