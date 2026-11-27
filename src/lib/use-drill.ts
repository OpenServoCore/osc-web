import { useEffect, useState } from "react";
import { captureEntries, type CaptureEntry } from "./drill";
import { listFiles, readFile } from "./opfs";
import { gunzip, runAt } from "./report";
import { storage } from "./use-library";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Run files parsed as JSON, by path from the run folder; a file the folder does not hold is absent. */
export type RunFiles = Map<string, unknown>;

export interface Loaded<T> {
  /** Undefined while the storage is read. */
  data: T | undefined;
  error: string | undefined;
}

type Keyed<T> = Loaded<T> & { key: string };

function shown<T>(state: Keyed<T> | undefined, key: string): Loaded<T> {
  return state?.key === key ? state : { data: undefined, error: undefined };
}

export async function readJson(path: string): Promise<unknown> {
  const bytes = await readFile(await storage(), path);
  if (bytes === null) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/** The JSON files at `paths` in one run folder. */
export function useRunFiles(uid: string, utc: string, paths: readonly string[]): Loaded<RunFiles> {
  const key = [runAt(uid, utc), ...paths].join("\n");
  const [state, setState] = useState<Keyed<RunFiles>>();
  useEffect(() => {
    let live = true;
    const [run = "", ...wanted] = key.split("\n");
    void (async () => {
      try {
        const files: RunFiles = new Map();
        for (const p of wanted) {
          const doc = await readJson(`${run}/${p}`);
          if (doc !== undefined) files.set(p, doc);
        }
        if (live) setState({ data: files, error: undefined, key });
      } catch (e) {
        if (live) setState({ data: undefined, error: message(e), key });
      }
    })();
    return () => {
      live = false;
    };
  }, [key]);
  return shown(state, key);
}

export interface ListedCapture extends CaptureEntry {
  metaDoc: unknown;
}

/** The captures in one of a run's capture folders, each with its meta read. */
export function useCaptures(uid: string, utc: string, dir: string): Loaded<ListedCapture[]> {
  const run = runAt(uid, utc);
  const key = `${run}/${dir}`;
  const [state, setState] = useState<Keyed<ListedCapture[]>>();
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const names = await listFiles(await storage(), `${run}/${dir}`);
        const out: ListedCapture[] = [];
        for (const e of captureEntries(dir, names)) {
          const metaDoc = e.meta === undefined ? undefined : await readJson(`${run}/${e.meta}`);
          out.push({ ...e, metaDoc });
        }
        if (live) setState({ data: out, error: undefined, key: `${run}/${dir}` });
      } catch (e) {
        if (live) setState({ data: undefined, error: message(e), key: `${run}/${dir}` });
      }
    })();
    return () => {
      live = false;
    };
  }, [run, dir]);
  return shown(state, key);
}

/** A capture's rows file as stored, and its text. */
export async function readCapture(
  uid: string,
  utc: string,
  rows: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; text: string } | undefined> {
  const bytes = await readFile(await storage(), `${runAt(uid, utc)}/${rows}`);
  if (bytes === null) return undefined;
  const plain = rows.endsWith(".gz") ? await gunzip(bytes) : bytes;
  return { bytes, text: new TextDecoder().decode(plain) };
}
