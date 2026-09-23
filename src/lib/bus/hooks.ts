import type { OscClient, Value } from "@openservocore/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSyncExternalStore } from "react";
import type { BusManager, BusStats, Rate, Snapshot } from "./manager";
import type { BusStore } from "./store";

export interface BusHost {
  manager: BusManager;
  store: BusStore;
}

export const BusContext = createContext<BusHost | undefined>(undefined);

export function useBusHost(): BusHost {
  const host = useContext(BusContext);
  if (host === undefined) throw new Error("useBus outside BusContext");
  return host;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A register list stable across renders that pass an equal one. */
function useNames(registers: readonly string[]): readonly string[] {
  const key = registers.join(",");
  return useMemo(() => (key === "" ? [] : key.split(",")), [key]);
}

export function useRegisters(
  id: number,
  registers: readonly string[],
  rate: Rate,
): Snapshot | undefined {
  const { manager, store } = useBusHost();
  const names = useNames(registers);
  const bound = useMemo(
    () => ({
      cell: store.cell<Snapshot | undefined>(undefined),
      sub: { id, registers: names, rate },
    }),
    [store, id, names, rate],
  );
  useEffect(
    () =>
      manager.subscribe(bound.sub, (s) => {
        bound.cell.set(s);
      }),
    [manager, bound],
  );
  return useSyncExternalStore(bound.cell.subscribe, bound.cell.get, bound.cell.get);
}

export function useRing(
  id: number,
  registers: readonly string[],
  rate: Rate,
  windowS: number,
): readonly Snapshot[] {
  const { manager, store } = useBusHost();
  const names = useNames(registers);
  const bound = useMemo(
    () => ({ ring: store.ring(windowS), sub: { id, registers: names, rate } }),
    [store, windowS, id, names, rate],
  );
  useEffect(
    () =>
      manager.subscribe(bound.sub, (s) => {
        bound.ring.push(s);
      }),
    [manager, bound],
  );
  return useSyncExternalStore(bound.ring.subscribe, bound.ring.get, bound.ring.get);
}

export interface ReadOnce {
  snapshot: Snapshot | undefined;
  error: string | undefined;
  reload: () => void;
}

export function useReadOnce(
  id: number,
  registers: readonly string[],
  deps: readonly unknown[] = [],
): ReadOnce {
  const { manager } = useBusHost();
  const names = useNames(registers);
  const key = JSON.stringify(deps);
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<Omit<ReadOnce, "reload">>({
    snapshot: undefined,
    error: undefined,
  });
  useEffect(() => {
    let live = true;
    void manager.readOnce(id, names).then(
      (snapshot) => {
        if (live) setResult({ snapshot, error: undefined });
      },
      (e: unknown) => {
        if (live) setResult({ snapshot: undefined, error: message(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [manager, id, names, key, generation]);
  const reload = useCallback(() => {
    setGeneration((g) => g + 1);
  }, []);
  return { ...result, reload };
}

export interface Bus {
  write: (id: number, register: string, value: Value) => Promise<void>;
  command: <T>(fn: (client: OscClient) => Promise<T>) => Promise<T>;
  exclusive: <T>(fn: (client: OscClient) => Promise<T>) => Promise<T>;
}

export function useBus(): Bus {
  const { manager } = useBusHost();
  return useMemo<Bus>(
    () => ({
      write: (id, register, value) => manager.write(id, register, value),
      command: (fn) => manager.command(fn),
      exclusive: (fn) => manager.exclusive(fn),
    }),
    [manager],
  );
}

export function useBusStats(): BusStats {
  const { manager } = useBusHost();
  const [stats, setStats] = useState(() => manager.stats());
  useEffect(
    () =>
      manager.onStats(() => {
        setStats(manager.stats());
      }),
    [manager],
  );
  return stats;
}
