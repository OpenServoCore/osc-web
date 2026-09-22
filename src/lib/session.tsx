import type { BaudRate, Descriptor, Found, OscClient, Rails } from "@openservocore/client";
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
  rails: Rails | undefined;
  client: OscClient | undefined;
  simulated: boolean;
  servos: Servo[];
  selected: number | undefined;
  /** Ids the last speed change lost, per its reunion roster. */
  missing: number[];
  descriptor: Descriptor | undefined;
  descriptorError: string | undefined;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  discover: () => Promise<void>;
  setRails: (patch: Partial<Rails>) => Promise<void>;
  setBaud: (rate: BaudRate) => Promise<void>;
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
  private railsJob: Promise<unknown> = Promise.resolve();
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

  /** With `rate`, migrates the fleet first (servos, then the host, then the reunion sweep). */
  private async scan(client: OscClient, rate?: BaudRate): Promise<void> {
    this.dispatch({ type: "scan" });
    try {
      if (rate !== undefined) {
        const ids = [...new Set(this.snap.state.servos.map((s) => s.id))];
        const roster = await client.setBaud(ids, rate);
        this.dispatch({ type: "migrated", roster });
      }
      const baud = await client.findBusBaud();
      const servos = await pingAll(client, await client.discover());
      const rails = await client.rails();
      if (this.snap.client !== client) return;
      this.dispatch({ type: "found", servos, baud, rails });
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

  async setBaud(rate: BaudRate): Promise<void> {
    const { client } = this.snap;
    if (client === undefined || this.snap.state.status !== "ready") return;
    await this.scan(client, rate);
  }

  // Queued so two quick toggles reach the adapter one at a time, each merged
  // over the state the previous one acked.
  async setRails(patch: Partial<Rails>): Promise<void> {
    const { client } = this.snap;
    if (client === undefined || this.snap.state.status !== "ready") return;
    const job = this.railsJob.then(() => {
      const cur = this.snap.state.rails ?? { v3v3: false, v5: false };
      return client.setRails(patch.v3v3 ?? cur.v3v3, patch.v5 ?? cur.v5);
    });
    this.railsJob = job.catch(() => undefined);
    const rails = await job;
    if (this.snap.client === client) this.dispatch({ type: "rails", rails });
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
    rails: snap.state.rails,
    client: snap.client,
    simulated: snap.simulated,
    servos: snap.state.servos,
    selected: snap.state.selected,
    missing: snap.state.missing,
    descriptor: snap.descriptor,
    descriptorError: snap.descriptorError,
    connect: () => ctl.connect(),
    disconnect: async () => {
      await Promise.all([ctl.disconnect(), navigate({ to: "/", search: true })]);
    },
    discover: () => ctl.discover(),
    setRails: (patch) => ctl.setRails(patch),
    setBaud: (rate) => ctl.setBaud(rate),
    select: (id) => ctl.select(id),
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (s === undefined) throw new Error("useSession outside SessionProvider");
  return s;
}
