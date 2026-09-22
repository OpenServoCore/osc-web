import {
  unpackVersion,
  type BaudRate,
  type Descriptor,
  type Found,
  type OscClient,
  type Ping,
  type Rails,
} from "@openservocore/client";
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
import { faultText, plan, POLL_MS, readCard, type CardValues, type Plan } from "./card-poll";
import { CommandQueue } from "./command-queue";
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
  /** The selected servo's descriptor. */
  descriptor: Descriptor | undefined;
  descriptorError: string | undefined;
  descriptorFor: (servo: Servo) => Descriptor | undefined;
  /** Per uid, the values the cards poll about once a second. */
  values: ReadonlyMap<string, CardValues>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  discover: () => Promise<void>;
  setRails: (patch: Partial<Rails>) => Promise<void>;
  setBaud: (rate: BaudRate) => Promise<void>;
  select: (id: number | undefined) => void;
  /**
   * The only way to talk to the adapter from a page: every command (scan,
   * rails, this and other pages' reads) waits its turn on one queue, so
   * nothing overlaps and the client's "busy" never surfaces.
   */
  run: <T>(fn: (client: OscClient) => Promise<T>) => Promise<T>;
  /** Re-reads a servo's CALIB constants on the next poll, after a calibration write. */
  refreshConstants: (uid: string) => void;
}

const SessionContext = createContext<Session | undefined>(undefined);

/** One descriptor and the card reads planned over it, shared by every servo of that model and firmware. */
interface Layout {
  descriptor: Descriptor;
  plan: Plan;
}

interface Snapshot {
  state: SessionState;
  client: OscClient | undefined;
  simulated: boolean;
  layouts: ReadonlyMap<string, Layout>;
  layoutErrors: ReadonlyMap<string, string>;
  values: ReadonlyMap<string, CardValues>;
}

const initial: Snapshot = {
  state: idle,
  client: undefined,
  simulated: false,
  layouts: new Map(),
  layoutErrors: new Map(),
  values: new Map(),
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Descriptors are published per model and major.minor. */
function layoutKey(ping: Ping): string {
  const [major, minor] = unpackVersion(ping.fw);
  return `${ping.model}/${major}.${minor}`;
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
  private readonly queue = new CommandQueue<OscClient>(() => this.snap.client);
  private pollGen = 0;
  private readonly stale = new Set<string>();
  private readonly fetching = new Set<string>();
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

  // Stable so a card's effect can depend on it.
  readonly run = <T,>(fn: (client: OscClient) => Promise<T>): Promise<T> => this.queue.run(fn);

  refreshConstants(uid: string): void {
    this.stale.add(uid);
  }

  layoutFor(servo: Servo): Layout | undefined {
    return servo.ping === undefined ? undefined : this.snap.layouts.get(layoutKey(servo.ping));
  }

  layoutErrorFor(servo: Servo): string | undefined {
    return servo.ping === undefined ? undefined : this.snap.layoutErrors.get(layoutKey(servo.ping));
  }

  private loadLayouts(servos: Servo[]): void {
    for (const servo of servos) {
      const { ping } = servo;
      if (ping === undefined) continue;
      const key = layoutKey(ping);
      if (this.snap.layouts.has(key) || this.fetching.has(key)) continue;
      this.fetching.add(key);
      fetchDescriptor(ping.model, ping.fw)
        .then(
          (descriptor) => {
            if (this.snap.layouts.has(key)) {
              descriptor.free();
              return;
            }
            const layouts = new Map(this.snap.layouts);
            layouts.set(key, { descriptor, plan: plan(descriptor.fields()) });
            const layoutErrors = new Map(this.snap.layoutErrors);
            layoutErrors.delete(key);
            this.set({ layouts, layoutErrors });
          },
          (e: unknown) => {
            const layoutErrors = new Map(this.snap.layoutErrors);
            layoutErrors.set(key, message(e));
            this.set({ layoutErrors });
          },
        )
        .finally(() => {
          this.fetching.delete(key);
        });
    }
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
      await this.run(async () => {
        if (rate !== undefined) {
          const ids = [...new Set(this.snap.state.servos.map((s) => s.id))];
          const roster = await client.setBaud(ids, rate);
          this.dispatch({ type: "migrated", roster });
        }
        const baud = await client.findBusBaud();
        const servos = await pingAll(client, await client.discover());
        const rails = await client.rails();
        if (this.snap.client !== client) return;
        this.set({ values: new Map() });
        this.dispatch({ type: "found", servos, baud, rails });
        this.loadLayouts(servos);
      });
      if (this.snap.client === client) this.startPoll(client);
    } catch (e) {
      if (this.snap.client !== client) return;
      this.set({ client: undefined, simulated: false, values: new Map() });
      this.dispatch({ type: "fail", error: message(e) });
      await release(client);
    }
  }

  // Fixed cadence; a tick still queued or running when the next is due is
  // skipped, so a slow bus never piles reads up behind a scan.
  private startPoll(client: OscClient): void {
    const gen = ++this.pollGen;
    const live = () =>
      gen === this.pollGen && this.snap.client === client && this.snap.state.status === "ready";
    let ticking = false;
    const tick = () => {
      if (!live()) {
        clearInterval(timer);
        return;
      }
      if (ticking) return;
      ticking = true;
      this.run((c) => this.readCards(c, live))
        .catch(() => undefined)
        .finally(() => {
          ticking = false;
        });
    };
    const timer = setInterval(tick, POLL_MS);
    tick();
  }

  private async readCards(client: OscClient, live: () => boolean): Promise<void> {
    for (const servo of this.snap.state.servos) {
      if (!live()) return;
      const layout = this.layoutFor(servo);
      if (layout === undefined) continue;
      const values = new Map(this.snap.values);
      try {
        const prior = this.stale.delete(servo.uid)
          ? undefined
          : this.snap.values.get(servo.uid)?.constants;
        values.set(servo.uid, await readCard(client, servo.id, layout.plan, prior));
      } catch {
        values.delete(servo.uid);
      }
      if (live()) this.set({ values });
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

  async setRails(patch: Partial<Rails>): Promise<void> {
    const { client } = this.snap;
    if (client === undefined || this.snap.state.status !== "ready") return;
    // Each toggle merges over the state the previous one acked.
    const rails = await this.run((c) => {
      const cur = this.snap.state.rails ?? { v3v3: false, v5: false };
      return c.setRails(patch.v3v3 ?? cur.v3v3, patch.v5 ?? cur.v5);
    });
    if (this.snap.client === client) this.dispatch({ type: "rails", rails });
  }

  async disconnect(): Promise<void> {
    const { client } = this.snap;
    if (client === undefined) return;
    // Queued behind any command still on the old client; `run` would already
    // see no client, so the release rides the chain directly.
    const done = this.run(() => Promise.resolve()).catch(() => undefined);
    this.set({ client: undefined, simulated: false, values: new Map() });
    this.dispatch({ type: "disconnect" });
    await done;
    await release(client);
  }

  select(id: number | undefined): void {
    if (this.snap.state.status !== "ready") return;
    this.dispatch({ type: "select", id });
    const servo = this.snap.state.servos.find((s) => s.id === id);
    if (servo !== undefined) this.loadLayouts([servo]);
  }
}

function withHealth(servo: Servo, values: CardValues | undefined): Servo {
  if (values === undefined) return servo;
  return {
    ...servo,
    fault: faultText(values.health.faultFlags),
    unsaved: values.health.configDirty,
    calibrated: values.constants.calibrated.valid,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ctl] = useState(() => new Controller());
  const snap = useSyncExternalStore(ctl.subscribe, ctl.snapshot, ctl.snapshot);
  const navigate = useNavigate();

  useEffect(() => {
    if (simRequested()) void ctl.connect();
  }, [ctl]);

  const selected = snap.state.servos.find((s) => s.id === snap.state.selected);
  const value: Session = {
    status: snap.state.status,
    error: snap.state.error,
    baud: snap.state.baud,
    rails: snap.state.rails,
    client: snap.client,
    simulated: snap.simulated,
    servos: snap.state.servos.map((s) => withHealth(s, snap.values.get(s.uid))),
    selected: snap.state.selected,
    missing: snap.state.missing,
    descriptor: selected === undefined ? undefined : ctl.layoutFor(selected)?.descriptor,
    descriptorError: selected === undefined ? undefined : ctl.layoutErrorFor(selected),
    descriptorFor: (servo) => ctl.layoutFor(servo)?.descriptor,
    values: snap.values,
    connect: () => ctl.connect(),
    disconnect: async () => {
      await Promise.all([ctl.disconnect(), navigate({ to: "/", search: true })]);
    },
    discover: () => ctl.discover(),
    setRails: (patch) => ctl.setRails(patch),
    setBaud: (rate) => ctl.setBaud(rate),
    select: (id) => {
      ctl.select(id);
    },
    run: ctl.run,
    refreshConstants: (uid) => {
      ctl.refreshConstants(uid);
    },
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (s === undefined) throw new Error("useSession outside SessionProvider");
  return s;
}
