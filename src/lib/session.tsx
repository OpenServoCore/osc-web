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
import { BusContext, type BusHost } from "./bus/hooks";
import { BusManager, systemClock, type Snapshot } from "./bus/manager";
import {
  CONSTANT_REGISTERS,
  constantsFrom,
  faultText,
  healthFrom,
  HEALTH_REGISTERS,
  liveFrom,
  LIVE_REGISTERS,
  type CardValues,
  type Layout,
} from "./bus/spans";
import { animationFrame, BusStore } from "./bus/store";
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
  /** Per uid, the values the cards subscribe to about once a second. */
  values: ReadonlyMap<string, CardValues>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  discover: () => Promise<void>;
  setRails: (patch: Partial<Rails>) => Promise<void>;
  setBaud: (rate: BaudRate) => Promise<void>;
  select: (id: number | undefined) => void;
  /**
   * The bus manager's control lane under the name the pages still use: a
   * command waits for at most the exchange in flight, and the client's
   * "busy" can never surface.
   */
  run: <T>(fn: (client: OscClient) => Promise<T>) => Promise<T>;
  /** Re-reads a servo's CALIB constants, after a calibration write. */
  refreshConstants: (uid: string) => void;
}

const SessionContext = createContext<Session | undefined>(undefined);

/** One descriptor, shared by every servo of that model and firmware. */
interface Model {
  descriptor: Descriptor;
  layout: Layout;
}

interface Snap {
  state: SessionState;
  client: OscClient | undefined;
  simulated: boolean;
  models: ReadonlyMap<string, Model>;
  layoutErrors: ReadonlyMap<string, string>;
  values: ReadonlyMap<string, CardValues>;
}

const initial: Snap = {
  state: idle,
  client: undefined,
  simulated: false,
  models: new Map(),
  layoutErrors: new Map(),
  values: new Map(),
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Descriptors are published per model and major.minor. */
function modelKey(ping: Ping): string {
  const [major, minor] = unpackVersion(ping.fw);
  return `${ping.model}/${major}.${minor}`;
}

function busLayout(descriptor: Descriptor): Layout {
  return {
    encode: descriptor.encode.bind(descriptor),
    decode: descriptor.decode.bind(descriptor),
    fields: descriptor.fields(),
  };
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

/** Owns the wasm client through the bus manager; `reduce` owns every state change. */
class Controller {
  private snap = initial;
  private readonly bus = new BusManager(systemClock);
  readonly host: BusHost = { manager: this.bus, store: new BusStore(animationFrame) };
  private readonly cards = new Map<string, Partial<CardValues>>();
  private readonly subscriptions = new Map<string, () => void>();
  private readonly reading = new Set<string>();
  private readonly fetching = new Set<string>();
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly snapshot = (): Snap => this.snap;

  private set(patch: Partial<Snap>): void {
    this.snap = { ...this.snap, ...patch };
    for (const listener of this.listeners) listener();
  }

  private dispatch(event: SessionEvent): void {
    this.set({ state: reduce(this.snap.state, event) });
  }

  // Stable so a card's effect can depend on it.
  readonly run = <T,>(fn: (client: OscClient) => Promise<T>): Promise<T> => this.bus.command(fn);

  refreshConstants(uid: string): void {
    const servo = this.snap.state.servos.find((s) => s.uid === uid);
    if (servo === undefined) return;
    const card = this.cards.get(uid);
    if (card !== undefined) card.constants = undefined;
    this.readConstants(servo);
  }

  modelFor(servo: Servo): Model | undefined {
    return servo.ping === undefined ? undefined : this.snap.models.get(modelKey(servo.ping));
  }

  layoutErrorFor(servo: Servo): string | undefined {
    return servo.ping === undefined ? undefined : this.snap.layoutErrors.get(modelKey(servo.ping));
  }

  private readonly layoutById = (id: number): Layout | undefined => {
    const servo = this.snap.state.servos.find((s) => s.id === id);
    return servo === undefined ? undefined : this.modelFor(servo)?.layout;
  };

  private loadModels(servos: Servo[]): void {
    for (const servo of servos) {
      const { ping } = servo;
      if (ping === undefined) continue;
      const key = modelKey(ping);
      if (this.snap.models.has(key) || this.fetching.has(key)) continue;
      this.fetching.add(key);
      fetchDescriptor(ping.model, ping.fw)
        .then(
          (descriptor) => {
            if (this.snap.models.has(key)) {
              descriptor.free();
              return;
            }
            const models = new Map(this.snap.models);
            models.set(key, { descriptor, layout: busLayout(descriptor) });
            const layoutErrors = new Map(this.snap.layoutErrors);
            layoutErrors.delete(key);
            this.set({ models, layoutErrors });
            for (const s of this.snap.state.servos) {
              if (s.ping !== undefined && modelKey(s.ping) === key) this.bus.layoutChanged(s.id);
            }
            this.syncCards();
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
    this.bus.attach(client, this.layoutById);
    await this.scan(client);
  }

  /** With `rate`, migrates the fleet first (servos, then the host, then the reunion sweep). */
  private async scan(client: OscClient, rate?: BaudRate): Promise<void> {
    this.dispatch({ type: "scan" });
    this.clearCards();
    // The whole scan is one exclusive turn: the lanes stay frozen, so on a
    // failure the client is released with nothing else reaching for it.
    const failure = await this.bus
      .exclusive(async (): Promise<unknown> => {
        try {
          if (rate !== undefined) {
            const ids = [...new Set(this.snap.state.servos.map((s) => s.id))];
            const roster = await client.setBaud(ids, rate);
            this.dispatch({ type: "migrated", roster });
          }
          const baud = await client.findBusBaud();
          const servos = await pingAll(client, await client.discover());
          const rails = await client.rails();
          if (this.snap.client !== client) return undefined;
          this.dispatch({ type: "found", servos, baud, rails });
          this.bus.roster([...new Set(servos.map((s) => s.id))]);
          this.loadModels(servos);
          return undefined;
        } catch (e) {
          this.bus.detach(message(e));
          return e;
        }
      })
      .catch((e: unknown) => e);
    if (failure === undefined) {
      this.syncCards();
      return;
    }
    if (this.snap.client !== client) return;
    this.set({ client: undefined, simulated: false });
    this.clearCards();
    this.dispatch({ type: "fail", error: message(failure) });
    await release(client);
  }

  // The fleet cards: one slow subscription per servo over the live sensors and
  // the health block, plus the CALIB constants read once.
  private syncCards(): void {
    const wanted = new Set<string>();
    if (this.snap.state.status === "ready") {
      for (const servo of this.snap.state.servos) {
        if (this.modelFor(servo) === undefined) continue;
        wanted.add(servo.uid);
        if (this.subscriptions.has(servo.uid)) continue;
        this.cards.set(servo.uid, {});
        this.subscriptions.set(
          servo.uid,
          this.bus.subscribe(
            { id: servo.id, registers: [...LIVE_REGISTERS, ...HEALTH_REGISTERS], rate: "slow" },
            (snapshot) => {
              this.onCard(servo.uid, snapshot);
            },
          ),
        );
        this.readConstants(servo);
      }
    }
    for (const [uid, stop] of this.subscriptions) {
      if (wanted.has(uid)) continue;
      stop();
      this.subscriptions.delete(uid);
      this.cards.delete(uid);
    }
    this.publishCards();
  }

  private clearCards(): void {
    for (const stop of this.subscriptions.values()) stop();
    this.subscriptions.clear();
    this.cards.clear();
    this.set({ values: new Map() });
  }

  private readConstants(servo: Servo): void {
    if (this.reading.has(servo.uid)) return;
    this.reading.add(servo.uid);
    void this.bus
      .readOnce(servo.id, CONSTANT_REGISTERS)
      .then(
        (snapshot) => {
          const card = this.cards.get(servo.uid);
          if (card === undefined) return;
          card.constants = constantsFrom(snapshot.read);
          this.publishCards();
        },
        () => undefined,
      )
      .finally(() => this.reading.delete(servo.uid));
  }

  private onCard(uid: string, snapshot: Snapshot): void {
    const card = this.cards.get(uid);
    if (card === undefined) return;
    if (snapshot.stale) {
      card.live = undefined;
      card.health = undefined;
    } else {
      card.live = liveFrom(snapshot.read);
      card.health = healthFrom(snapshot.read);
      // A constants read that failed, or one a calibration write invalidated,
      // is retried on the next card snapshot.
      if (card.constants === undefined) {
        const servo = this.snap.state.servos.find((s) => s.uid === uid);
        if (servo !== undefined) this.readConstants(servo);
      }
    }
    this.publishCards();
  }

  private publishCards(): void {
    const values = new Map<string, CardValues>();
    for (const [uid, card] of this.cards) {
      const { constants, live, health } = card;
      if (constants === undefined || live === undefined || health === undefined) continue;
      values.set(uid, { constants, live, health });
    }
    this.set({ values });
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
    const rails = await this.bus.command((c) => {
      const cur = this.snap.state.rails ?? { v3v3: false, v5: false };
      return c.setRails(patch.v3v3 ?? cur.v3v3, patch.v5 ?? cur.v5);
    });
    if (this.snap.client === client) this.dispatch({ type: "rails", rails });
  }

  async disconnect(): Promise<void> {
    const { client } = this.snap;
    if (client === undefined) return;
    this.set({ client: undefined, simulated: false });
    this.clearCards();
    this.dispatch({ type: "disconnect" });
    // Detaching from inside an exclusive turn: the exchange in flight has
    // settled and the lanes are frozen, so the client is free to release.
    await this.bus
      .exclusive(() => {
        this.bus.detach("disconnected");
        return Promise.resolve();
      })
      .catch(() => undefined);
    await release(client);
  }

  select(id: number | undefined): void {
    if (this.snap.state.status !== "ready") return;
    this.dispatch({ type: "select", id });
    const servo = this.snap.state.servos.find((s) => s.id === id);
    if (servo !== undefined) this.loadModels([servo]);
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
    descriptor: selected === undefined ? undefined : ctl.modelFor(selected)?.descriptor,
    descriptorError: selected === undefined ? undefined : ctl.layoutErrorFor(selected),
    descriptorFor: (servo) => ctl.modelFor(servo)?.descriptor,
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
  return (
    <BusContext.Provider value={ctl.host}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
    </BusContext.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (s === undefined) throw new Error("useSession outside SessionProvider");
  return s;
}
