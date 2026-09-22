import init, { OscClient, requestDevice } from "@openservocore/client";

const ID_MIN = 1;
const ID_MAX = 0xf9;

/** `?sim` alone is a two-servo fleet; `?sim=1,2,3` names the ids. */
export function parseSimIds(search: string): number[] | undefined {
  const raw = new URLSearchParams(search).get("sim");
  if (raw === null) return undefined;
  if (raw === "") return [1, 2];
  const ids = new Set<number>();
  for (const part of raw.split(",")) {
    if (!/^\d+$/.test(part)) continue;
    const id = Number(part);
    if (id >= ID_MIN && id <= ID_MAX) ids.add(id);
  }
  return [...ids];
}

export function simRequested(): boolean {
  return parseSimIds(window.location.search) !== undefined;
}

let wasmReady: Promise<unknown> | undefined;

export async function openClient(): Promise<OscClient> {
  wasmReady ??= init();
  await wasmReady;
  const ids = parseSimIds(window.location.search);
  if (ids !== undefined) return OscClient.fake(ids);
  return OscClient.connect(await requestDevice());
}
